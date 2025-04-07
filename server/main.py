import io
import os
import threading
import traceback
import webbrowser
import uuid
import json
from pathlib import Path
from enum import Enum
import typing
import re # Import regex for sanitization
import urllib.parse # For potential URL encoding/decoding if needed

import uvicorn
# Add Request import for debugging form data
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, status, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

# Assuming src module is structured correctly relative to main.py
from src import (
    file_io,
    video2audio,
    audio2transcript,
    transcript2snippets,
    transcript2session,
    session2recap,
)

# --- Constants and Configuration ---

RESOURCE_BASE_DIR = Path(file_io.get_application_path()) / "resources"
FILENAME_SEPARATOR = "__" # Separator between UUID and original name hint

class ResourceType(Enum):
    VIDEO = "video"
    AUDIO = "audio"
    SNIPPET = "snippet" # For speaker identification audio snippets
    JSON_TRANSCRIPT = "json_transcript"
    JSON_SPEAKER_MAP = "json_speaker_map"
    TEXT_SESSION = "text_session"
    TEXT_RECAP = "text_recap"
    TEXT_SUMMARY = "text_summary"
    TEXT_PROMPT = "text_prompt" # For recap/summary prompts

# Ensure base resource directory and subdirectories exist
for resource_type in ResourceType:
    (RESOURCE_BASE_DIR / resource_type.value).mkdir(parents=True, exist_ok=True)

# --- Helper Functions ---

def _sanitize_filename_part(name_part: str) -> str:
    """Removes potentially problematic characters for embedding in filename."""
    # Remove typical path characters and control characters
    name_part = re.sub(r'[\\/*?:"<>|\x00-\x1f]', '', name_part)
    # Replace whitespace with underscores
    name_part = re.sub(r'\s+', '_', name_part)
    # Ensure it doesn't contain our separator
    name_part = name_part.replace(FILENAME_SEPARATOR, '_')
    # Limit length to avoid excessively long filenames
    return name_part[:100] # Limit embedded part length

def _get_resource_dir(resource_type: ResourceType) -> Path:
    """Gets the directory for a given resource type."""
    return RESOURCE_BASE_DIR / resource_type.value

def _generate_resource_id() -> str:
    """Generates a unique resource identifier."""
    return str(uuid.uuid4())

def _get_resource_path_and_name(resource_id: str, resource_type: ResourceType) -> tuple[Path, str]:
    """Finds the resource file path and extracts the original name hint."""
    if ".." in resource_id or "/" in resource_id or "\\" in resource_id:
        raise ValueError("Invalid resource ID format.")

    resource_dir = _get_resource_dir(resource_type)
    # Use glob to find the file starting with the UUID and separator
    matches = list(resource_dir.glob(f"{resource_id}{FILENAME_SEPARATOR}*.*"))

    if not matches:
        # Fallback: Check if a file exists with *just* the UUID (old format?)
        # This shouldn't happen with new saves, but handles potential migration
        fallback_matches = list(resource_dir.glob(f"{resource_id}.*"))
        if fallback_matches:
             print(f"Warning: Found resource {resource_id} in old format. Using fallback.")
             file_path = fallback_matches[0]
             original_name_hint = file_path.name # Best guess is the filename itself
             return file_path, original_name_hint
        raise FileNotFoundError(f"Resource {resource_id} of type {resource_type.value} not found.")

    if len(matches) > 1:
        print(f"Warning: Multiple files found for resource ID {resource_id}. Using first match: {matches[0]}")

    file_path = matches[0]
    filename = file_path.name
    # Extract original name hint
    parts = filename.split(FILENAME_SEPARATOR, 1)
    original_name_hint = filename # Default if separator not found (shouldn't happen)
    if len(parts) > 1:
        original_name_hint = parts[1]

    return file_path, original_name_hint

# Wrapper for convenience, only returns path
def _get_resource_path(resource_id: str, resource_type: ResourceType) -> Path:
     path, _ = _get_resource_path_and_name(resource_id, resource_type)
     return path

def _create_resource_metadata(
    resource_id: str,
    original_name: str, # This should now be the *actual* original name
    resource_type: ResourceType,
    stored_filename: str # The filename on disk (e.g., uuid__name.ext)
) -> dict:
    """Creates a standard dictionary representing a resource."""
    return {
        "id": resource_id, # The UUID part
        "original_name": original_name, # The intended user-facing name
        "type": resource_type.value,
        "filename": stored_filename, # The actual name on disk
    }

async def _save_file_resource(
    file: UploadFile,
    resource_type: ResourceType,
) -> dict:
    """Saves an uploaded file as a resource and returns its metadata."""
    resource_id = _generate_resource_id()
    # Use the actual uploaded filename as the original name
    original_name = file.filename or f"upload_{resource_id}"
    sanitized_part = _sanitize_filename_part(Path(original_name).stem)
    extension = Path(original_name).suffix # Includes dot, e.g. '.mp4'

    # Construct the filename stored on disk
    stored_filename = f"{resource_id}{FILENAME_SEPARATOR}{sanitized_part}{extension}"
    file_path = _get_resource_dir(resource_type) / stored_filename

    try:
        content = await file.read()
        with open(file_path, "wb") as buffer:
            buffer.write(content)
    except Exception as e:
        print(f"Error saving file {original_name} as {stored_filename}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to save uploaded file.")
    finally:
        await file.close()

    # Return metadata with the actual original_name
    return _create_resource_metadata(resource_id, original_name, resource_type, stored_filename)

def _save_data_resource(
    data: bytes | str | dict | io.BytesIO, # Added io.BytesIO
    resource_type: ResourceType,
    input_original_name: str, # Original name of the file this was derived from
    output_suffix: str, # Suffix to add (e.g., "_audio", "_transcript")
    extension: str, # e.g., "mp3", "json" (without dot)
) -> dict:
    """Saves generated data (bytes, string, or dict) as a resource."""
    resource_id = _generate_resource_id()
    base_name = Path(input_original_name).stem # Get base name from the input file
    # Construct the user-facing "original name" for this generated file
    original_name = f"{base_name}{output_suffix}.{extension}"

    sanitized_part = _sanitize_filename_part(f"{base_name}{output_suffix}")
    full_extension = f".{extension.lstrip('.')}"

    # Construct the filename stored on disk
    stored_filename = f"{resource_id}{FILENAME_SEPARATOR}{sanitized_part}{full_extension}"
    file_path = _get_resource_dir(resource_type) / stored_filename

    try:
        mode = "w" if isinstance(data, (str, dict)) else "wb"
        encoding = "utf-8" if mode == "w" else None

        with open(file_path, mode, encoding=encoding) as f:
            if isinstance(data, dict):
                json.dump(data, f, indent=4) # Save formatted JSON
            elif isinstance(data, str):
                f.write(data)
            elif isinstance(data, bytes):
                f.write(data)
            elif isinstance(data, io.BytesIO):
                 f.write(data.getvalue())
            else:
                 raise TypeError(f"Unsupported data type for saving: {type(data)}")

    except Exception as e:
        print(f"Error saving data resource {original_name} as {stored_filename}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to save generated resource.")

    # Return metadata with the derived original_name
    return _create_resource_metadata(resource_id, original_name, resource_type, stored_filename)

# --- Load Resource Helpers (No change needed in function signature/return) ---
# (Keep _load_resource_bytes, _load_resource_text, _load_resource_json using _get_resource_path)

# ... (Keep _load_resource_bytes, _load_resource_text, _load_resource_json) ...
def _load_resource_bytes(resource_id: str, resource_type: ResourceType) -> io.BytesIO:
    """Loads resource content as BytesIO."""
    try:
        file_path = _get_resource_path(resource_id, resource_type)
        with open(file_path, "rb") as f:
            return io.BytesIO(f.read())
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Resource {resource_id} ({resource_type.value}) not found.")
    except ValueError as e: # Invalid ID format
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        print(f"Error loading resource {resource_id} ({resource_type.value}): {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to load resource.")

def _load_resource_text(resource_id: str, resource_type: ResourceType) -> str:
    """Loads resource content as text."""
    try:
        file_path = _get_resource_path(resource_id, resource_type)
        with open(file_path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Resource {resource_id} ({resource_type.value}) not found.")
    except ValueError as e: # Invalid ID format
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        print(f"Error loading resource {resource_id} ({resource_type.value}): {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to load resource.")

def _load_resource_json(resource_id: str, resource_type: ResourceType) -> dict:
    """Loads resource content as JSON (dict)."""
    try:
        file_path = _get_resource_path(resource_id, resource_type)
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Resource {resource_id} ({resource_type.value}) not found.")
    except json.JSONDecodeError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Resource {resource_id} is not valid JSON.")
    except ValueError as e: # Invalid ID format
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        print(f"Error loading resource {resource_id} ({resource_type.value}): {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to load resource.")


def _delete_resource_file(resource_id: str, resource_type: ResourceType) -> None:
    """Deletes the physical file for a resource."""
    try:
        # Find the specific file path to delete
        file_path, _ = _get_resource_path_and_name(resource_id, resource_type)
        file_path.unlink() # Remove the file
        print(f"Deleted resource file: {file_path}")
    except FileNotFoundError:
         raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Resource {resource_id} ({resource_type.value}) not found for deletion.")
    except ValueError as e: # Invalid ID format
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        print(f"Error deleting resource {resource_id} ({resource_type.value}) file {file_path}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to delete resource file.")

# Removed _get_original_name_base as it's no longer needed with the new approach

# --- FastAPI App Creation (No changes needed) ---
# ... (Keep create_server function) ...
def create_server() -> FastAPI:
    app = FastAPI(
        title="Canon Keeper API & Web",
        description="Processes TTRPG video/audio recordings and serves the web UI.",
        version="0.4.0", # Incremented version
    )
    origins = [
        "http://localhost:8000",    # Backend default
        "http://127.0.0.1:8000",   # Backend explicit
        "http://localhost:5173",    # Default Vite dev server
        # Add other origins if needed (e.g., production frontend URL)
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # Serve static assets for the web UI (if built)
    assets_path = file_io.resource_path("web_content/assets")
    if os.path.exists(assets_path):
         app.mount("/assets", StaticFiles(directory=assets_path), name="assets")
    else:
        print(f"Warning: Assets directory not found at {assets_path}. Frontend assets might not load.")

    return app

app = create_server()


# --- API Endpoints ---

# --- Resource Management Endpoints ---

# POST /upload/{resource_type_str} (No change needed in signature)
# Uses the updated _save_file_resource which handles naming
@app.post("/upload/{resource_type_str}", status_code=status.HTTP_201_CREATED)
async def upload_resource(resource_type_str: str, file: UploadFile = File(...)):
    """Uploads a file resource (video, audio, json, text)."""
    try:
        resource_type = ResourceType(resource_type_str)
    except ValueError:
        valid_types = [rt.value for rt in ResourceType if rt != ResourceType.SNIPPET] # Don't allow direct snippet upload
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid resource type for upload. Valid types are: {valid_types}"
        )

    content_type = file.content_type or "application/octet-stream"
    # Add more specific checks if desired
    print(f"Attempting upload: filename='{file.filename}', content_type='{content_type}', resource_type='{resource_type.value}'")

    try:
        resource_metadata = await _save_file_resource(file, resource_type)
        return resource_metadata
    except HTTPException as e:
        raise e # Re-raise client/server errors during save
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"An unexpected error occurred during upload: {e}")


@app.get("/resources")
async def list_resources():
    """Lists all available resources on the server."""
    all_resources = []
    for resource_type in ResourceType:
        resource_dir = _get_resource_dir(resource_type)
        try:
            for file_path in resource_dir.iterdir():
                if file_path.is_file() and FILENAME_SEPARATOR in file_path.name:
                    try:
                        filename = file_path.name
                        # Parse filename: uuid__original_hint.ext
                        id_part, name_part = filename.split(FILENAME_SEPARATOR, 1)

                        # Basic check if id_part looks like a UUID (optional but good)
                        try:
                            uuid.UUID(id_part)
                        except ValueError:
                             print(f"Skipping file with invalid UUID format: {filename}")
                             continue

                        # The name_part is the original name hint
                        metadata = _create_resource_metadata(
                            resource_id=id_part,
                            original_name=name_part, # Use the parsed name hint as original_name
                            resource_type=resource_type,
                            stored_filename=filename
                        )
                        all_resources.append(metadata)
                    except Exception as parse_err:
                        print(f"Error parsing resource file {file_path}: {parse_err}")
                elif file_path.is_file():
                     print(f"Skipping file with unexpected format: {file_path.name}")


        except Exception as e:
            print(f"Error listing resources in {resource_dir}: {e}")
            # Continue listing other types even if one fails
    # Sort resources perhaps by name or type
    all_resources.sort(key=lambda x: x['original_name'])
    return all_resources


@app.get("/download/{resource_type_str}/{resource_id}")
async def download_resource(resource_type_str: str, resource_id: str):
    """Downloads a specific resource file."""
    try:
        resource_type = ResourceType(resource_type_str)
        # Find the file and get the original name hint for the download filename
        file_path, original_name_hint = _get_resource_path_and_name(resource_id, resource_type)
        # Use original name hint for the download attribute
        return FileResponse(path=file_path, filename=original_name_hint)
    except (FileNotFoundError, ValueError) as e:
        status_code = status.HTTP_404_NOT_FOUND if isinstance(e, FileNotFoundError) else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=str(e))
    except HTTPException as e:
        raise e
    except Exception as e:
        traceback.print_exc()
        # Don't log benign connection reset errors from media streaming
        if isinstance(e, ConnectionResetError):
             print(f"Info: Connection reset during download for {resource_id}. Client likely closed connection.")
             # Return minimal response or re-raise differently if needed, but often can be ignored
             # raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Connection reset by client during download.") from None
             return Response(status_code=200) # Or just let it fail silently on server if frontend handles it
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to prepare file for download: {e}")


# DELETE /resource/{resource_type_str}/{resource_id}
# Uses updated _delete_resource_file which uses _get_resource_path_and_name
@app.delete("/resource/{resource_type_str}/{resource_id}", status_code=status.HTTP_200_OK)
async def delete_resource(resource_type_str: str, resource_id: str):
     """Deletes a specific resource."""
     try:
         resource_type = ResourceType(resource_type_str)
         _delete_resource_file(resource_id, resource_type) # This now finds the correct uuid__name.ext file
         return {"message": f"Resource {resource_id} ({resource_type.value}) deleted successfully."}
     except HTTPException as e:
         raise e # Propagate errors from helper
     except Exception as e:
         traceback.print_exc()
         raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="An unexpected error occurred during deletion.")


# --- Processing Pipeline Endpoints ---

# Modify processing endpoints to use the new _save_data_resource signature

@app.post("/process/video_to_audio", status_code=status.HTTP_201_CREATED)
async def process_video_to_audio(video_id: str = Form(...)):
    """Extracts audio from an uploaded video resource."""
    try:
        video_data = _load_resource_bytes(video_id, ResourceType.VIDEO)
        _, input_original_name = _get_resource_path_and_name(video_id, ResourceType.VIDEO)

        print(f"Extracting audio from video ID: {video_id} (Original: {input_original_name})")
        audio_data: io.BytesIO | None = video2audio.video_to_mp3(video_data)

        if not audio_data:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Audio extraction failed (returned None).")

        print("Audio extraction complete. Saving resource...")
        audio_metadata = _save_data_resource(
            data=audio_data,
            resource_type=ResourceType.AUDIO,
            input_original_name=input_original_name, # Pass original name of input video
            output_suffix="_audio",
            extension="mp3"
        )
        return audio_metadata

    except HTTPException as e:
        raise e
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Audio extraction process failed: {e}")

@app.post("/process/audio_to_transcript", status_code=status.HTTP_201_CREATED)
async def process_audio_to_transcript(
    # Add request object for debugging
    request: Request,
    # Keep original Form definitions for validation
    audio_id: str = Form(...),
    assemblyai_api_key: str = Form(...)
):
    """Generates a transcript JSON from an audio resource using AssemblyAI."""
    # --- Debugging 422 ---
    # Log exactly what FastAPI received
    form_data = await request.form()
    received_audio_id = form_data.get("audio_id")
    received_key = form_data.get("assemblyai_api_key")
    print(f"--- Transcription Request ---")
    print(f"Received Form Data: {form_data}")
    print(f"Parsed audio_id: {received_audio_id} (Type: {type(received_audio_id)})")
    print(f"Parsed assemblyai_api_key: {'***' if received_key else 'None'} (Type: {type(received_key)})")
    print(f"Endpoint expected audio_id: {audio_id}")
    print(f"Endpoint expected assemblyai_api_key: {'***' if assemblyai_api_key else 'None'}")
    print(f"--- End Transcription Request ---")
    # FastAPI performs validation *after* this point if using Form(...) in signature.
    # If the above logs show the correct data, the 422 is likely subtle validation fail.

    if not assemblyai_api_key: # Redundant check, Form(...) should handle it, but safe
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="AssemblyAI API Key is required.")
    if not audio_id: # Redundant check
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Audio ID is required.")

    try:
        audio_data = _load_resource_bytes(audio_id, ResourceType.AUDIO)
        _, input_original_name = _get_resource_path_and_name(audio_id, ResourceType.AUDIO)

        print(f"Starting transcription for audio ID: {audio_id} (Original: {input_original_name})")
        transcript: dict | None = audio2transcript.audio_to_transcript(audio_data, assemblyai_api_key)

        if transcript is None: # Check for None explicitly
            # Try to provide more specific feedback if possible
            # Did AssemblyAI return an error in the transcript dict?
            print(f"Transcription call returned None for audio_id: {audio_id}")
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Transcription failed. Check AssemblyAI key, audio format/length, and AssemblyAI status.")
        if transcript.get("error"):
             print(f"AssemblyAI Error for {audio_id}: {transcript['error']}")
             raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Transcription Error from AssemblyAI: {transcript['error']}")
        if not transcript.get("utterances"): # Check essential output
             print(f"Transcription for {audio_id} completed but missing 'utterances'. Result: {transcript}")
             raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Transcription completed but output format is unexpected (missing 'utterances').")


        print("Transcription complete. Saving resource...")
        transcript_metadata = _save_data_resource(
            data=transcript,
            resource_type=ResourceType.JSON_TRANSCRIPT,
            input_original_name=input_original_name,
            output_suffix="_transcript",
            extension="json"
        )
        return transcript_metadata

    except HTTPException as e:
        # Log HTTPException details before re-raising
        print(f"HTTPException during transcription for {audio_id}: Status={e.status_code}, Detail={e.detail}")
        raise e
    except Exception as e:
        traceback.print_exc()
        # Provide more context in the error detail if possible
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Transcription process failed unexpectedly: {e}")


@app.post("/process/transcript_to_snippets", status_code=status.HTTP_201_CREATED)
async def process_transcript_to_snippets(
    audio_id: str = Form(...),
    transcript_id: str = Form(...)
):
    """Generates audio snippets for each speaker identified in the transcript."""
    try:
        audio_data = _load_resource_bytes(audio_id, ResourceType.AUDIO)
        transcript_data = _load_resource_json(transcript_id, ResourceType.JSON_TRANSCRIPT)
        _, audio_original_name = _get_resource_path_and_name(audio_id, ResourceType.AUDIO)

        utterances = transcript_data.get("utterances")
        if utterances is None or not isinstance(utterances, list):
             raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Transcript JSON is missing or has invalid 'utterances'.")

        print(f"Generating speaker snippets for transcript ID: {transcript_id} (Audio: {audio_original_name})")
        speaker_snippets_dict: dict[str, dict[str, typing.Any]] = transcript2snippets.transcript_to_snippets(
            audio_data, utterances
        )

        if not speaker_snippets_dict:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Snippet generation failed (returned empty dict). Ensure transcript has speaker labels.")

        print("Snippet generation complete. Saving resources...")
        saved_snippets_metadata = {}
        # Use audio base name for snippet naming
        input_base_name = Path(audio_original_name).stem

        for speaker_label, snippet_data in speaker_snippets_dict.items():
            snippet_audio = snippet_data.get("audio")
            if not isinstance(snippet_audio, io.BytesIO):
                print(f"Warning: Invalid audio data for speaker {speaker_label}. Skipping.")
                continue

            snippet_metadata = _save_data_resource(
                data=snippet_audio,
                resource_type=ResourceType.SNIPPET,
                input_original_name=f"{input_base_name}_speaker_{speaker_label}", # Base for output name
                output_suffix="_snippet", # Appended to the base above
                extension="mp3"
            )
            saved_snippets_metadata[speaker_label] = snippet_metadata

        return saved_snippets_metadata

    except HTTPException as e:
        raise e
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Snippet generation process failed: {e}")


@app.post("/process/transcript_to_session", status_code=status.HTTP_201_CREATED)
async def process_transcript_to_session(
    transcript_id: str = Form(...),
    speaker_map_id: str = Form(...) # ID of the uploaded JSON speaker map
):
    """Generates a formatted session script from a transcript and speaker map."""
    try:
        transcript_data = _load_resource_json(transcript_id, ResourceType.JSON_TRANSCRIPT)
        speaker_name_map = _load_resource_json(speaker_map_id, ResourceType.JSON_SPEAKER_MAP)
        _, transcript_original_name = _get_resource_path_and_name(transcript_id, ResourceType.JSON_TRANSCRIPT)

        if not isinstance(speaker_name_map, dict):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Speaker map must be a JSON object.")

        print(f"Generating session script from transcript ID: {transcript_id} (Original: {transcript_original_name})")
        session_script: str = transcript2session.transcript_to_session(transcript_data, speaker_name_map)

        if not session_script:
             raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Session script generation failed (returned empty).")

        print("Session script generation complete. Saving resource...")
        session_metadata = _save_data_resource(
            data=session_script,
            resource_type=ResourceType.TEXT_SESSION,
            input_original_name=transcript_original_name, # Use transcript name as base
            output_suffix="_session_script",
            extension="txt"
        )
        return session_metadata

    except HTTPException as e:
        raise e
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Session script generation process failed: {e}")


@app.post("/process/session_to_recap", status_code=status.HTTP_201_CREATED)
async def process_session_to_recap(
    text_session_id: str = Form(...), # Changed from session_id for clarity
    prompt_id: str = Form(...),       # Explicitly named prompt_id
    google_gemini_api_key: str = Form(...)
):
    """Generates a recap from a session script using an LLM."""
    if not google_gemini_api_key:
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="LLM API Key is required.")

    try:
        session_script = _load_resource_text(text_session_id, ResourceType.TEXT_SESSION)
        recap_prompt = _load_resource_text(prompt_id, ResourceType.TEXT_PROMPT)
        _, session_original_name = _get_resource_path_and_name(text_session_id, ResourceType.TEXT_SESSION)

        print(f"Generating recap for session ID: {text_session_id} (Original: {session_original_name})")
        recap: str | None = session2recap.session_to_recap(session_script, google_gemini_api_key, recap_prompt)

        if not recap:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Recap generation failed (returned None). Check API key, prompts, and LLM status.")

        print("Recap generation complete. Saving resource...")
        recap_metadata = _save_data_resource(
            data=recap,
            resource_type=ResourceType.TEXT_RECAP,
            input_original_name=session_original_name,
            output_suffix="_recap",
            extension="txt"
        )
        return recap_metadata

    except HTTPException as e:
        raise e
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Recap generation process failed: {e}")


@app.post("/process/recap_to_summary", status_code=status.HTTP_201_CREATED)
async def process_recap_to_summary(
    text_recap_id: str = Form(...), # Changed from recap_id
    prompt_id: str = Form(...),
    google_gemini_api_key: str = Form(...)
):
    """Generates a summary from a recap using an LLM."""
    if not google_gemini_api_key:
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="LLM API Key is required.")

    try:
        recap_text = _load_resource_text(text_recap_id, ResourceType.TEXT_RECAP)
        summary_prompt = _load_resource_text(prompt_id, ResourceType.TEXT_PROMPT)
        _, recap_original_name = _get_resource_path_and_name(text_recap_id, ResourceType.TEXT_RECAP)

        print(f"Generating summary for recap ID: {text_recap_id} (Original: {recap_original_name})")
        summary: str | None = session2recap.recap_to_summary(recap_text, google_gemini_api_key, summary_prompt)

        if not summary:
             raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Summary generation failed (returned None). Check API key, prompts, and LLM status.")

        print("Summary generation complete. Saving resource...")
        summary_metadata = _save_data_resource(
            data=summary,
            resource_type=ResourceType.TEXT_SUMMARY,
            input_original_name=recap_original_name,
            output_suffix="_summary",
            extension="txt"
        )
        return summary_metadata

    except HTTPException as e:
        raise e
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Summary generation process failed: {e}")


# --- Root Endpoint and Server Runner (No changes needed) ---
# ... (Keep @app.get("/"), run_server, launch_client, if __name__ == "__main__":) ...
@app.get("/")
async def serve_index():
    """Serves the main index.html for the web UI."""
    index_path_str = file_io.resource_path("web_content/index.html")
    index_path = Path(index_path_str)
    if not index_path.exists():
         # Fallback or provide a simple API info page if index.html is missing
         print(f"Warning: index.html not found at {index_path_str}")
         return JSONResponse(
             content={
                 "message": "Canon Keeper API is running.",
                 "docs": "/docs",
                 "available_resource_types": [rt.value for rt in ResourceType],
             },
             status_code=status.HTTP_200_OK
         )
    return FileResponse(index_path)


@app.get("/favicon.ico")
async def serve_favicon():
    """Serves the favicon for the web UI."""
    favicon_path_str = file_io.resource_path("web_content/favicon.ico")
    favicon_path = Path(favicon_path_str)
    if not favicon_path.exists():
         print(f"Warning: favicon.ico not found at {favicon_path_str}")
         raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Favicon not found.")
    return FileResponse(favicon_path)


def run_server():
    """Starts the Uvicorn server."""
    uvicorn.run(app=app, host="127.0.0.1", port=8000, log_level="info", reload=False) # Use reload=True for dev


def launch_client():
    """Attempts to open the web browser to the running server."""
    url = "http://127.0.0.1:8000"
    print(f"Attempting to open browser at {url}")
    try:
        webbrowser.open(url)
    except Exception as e:
        print(f"Could not automatically open browser: {e}. Please manually navigate to {url}")


if __name__ == "__main__":
    print("Initializing Canon Keeper Server...")
    
    # Ensure resource directories exist on startup
    for resource_type in ResourceType:
        _get_resource_dir(resource_type).mkdir(parents=True, exist_ok=True)
    print(f"Resource directory base: {RESOURCE_BASE_DIR}")

    # Server on background thread so that we can keep the main thread alive by waiting for input
    server_thread = threading.Thread(target=run_server, daemon=True, name="CanonKeeperServer") # thread will exit when main exits
    server_thread.start()

    launch_client()

    try:
        input("Server is running. Press Enter in this console window to stop...\n")
    except KeyboardInterrupt:
        print("\nCtrl+C detected.")
    finally:
        print("Stopping server...")
