import io
import os
import threading
import traceback
import webbrowser
import uuid
import json
from pathlib import Path
from enum import Enum
import typing # Use typing instead of types for broader compatibility

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, status
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

def _get_resource_dir(resource_type: ResourceType) -> Path:
    """Gets the directory for a given resource type."""
    return RESOURCE_BASE_DIR / resource_type.value

def _generate_resource_id() -> str:
    """Generates a unique resource identifier."""
    return str(uuid.uuid4())

def _get_resource_path(resource_id: str, resource_type: ResourceType) -> Path:
    """Constructs the full path for a resource given its ID and type."""
    # Basic sanitization to prevent path traversal
    if ".." in resource_id or "/" in resource_id or "\\" in resource_id:
        raise ValueError("Invalid resource ID format.")
    # Look for file with any extension - simple approach for now
    resource_dir = _get_resource_dir(resource_type)
    matches = list(resource_dir.glob(f"{resource_id}.*"))
    if not matches:
        raise FileNotFoundError(f"Resource {resource_id} of type {resource_type.value} not found.")
    if len(matches) > 1:
        # This shouldn't happen with UUIDs unless there's manual file tampering
        print(f"Warning: Multiple files found for resource ID {resource_id}. Using first match: {matches[0]}")
    return matches[0]

def _create_resource_metadata(
    resource_id: str,
    original_name: str,
    resource_type: ResourceType,
    file_path: Path
) -> dict:
    """Creates a standard dictionary representing a resource."""
    return {
        "id": resource_id,
        "original_name": original_name,
        "type": resource_type.value,
        "filename": file_path.name, # e.g., "uuid.mp4"
    }

async def _save_file_resource(
    file: UploadFile,
    resource_type: ResourceType,
) -> dict:
    """Saves an uploaded file as a resource and returns its metadata."""
    resource_id = _generate_resource_id()
    original_name = file.filename or f"upload_{resource_id}"
    _, extension = os.path.splitext(original_name)
    file_path = _get_resource_dir(resource_type) / f"{resource_id}{extension}"

    try:
        # Use async file writing if available/needed, otherwise sync is ok for FastAPI
        # For simplicity with current file_io, using sync write within thread
        content = await file.read()
        with open(file_path, "wb") as buffer:
            buffer.write(content)
    except Exception as e:
        print(f"Error saving file {original_name}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to save uploaded file.")
    finally:
        await file.close()

    return _create_resource_metadata(resource_id, original_name, resource_type, file_path)

def _save_data_resource(
    data: bytes | str | dict,
    resource_type: ResourceType,
    original_name_base: str, # e.g., "video_name_transcript"
    extension: str, # e.g., ".json"
) -> dict:
    """Saves generated data (bytes, string, or dict) as a resource."""
    resource_id = _generate_resource_id()
    full_extension = f".{extension.lstrip('.')}"
    original_name = f"{original_name_base}{full_extension}"
    file_path = _get_resource_dir(resource_type) / f"{resource_id}{full_extension}"

    try:
        if isinstance(data, dict):
            file_io.write_file(str(file_path), data) # Assumes write_file handles JSON dicts
        elif isinstance(data, str):
            file_io.write_file(str(file_path), data) # Assumes write_file handles strings
        elif isinstance(data, bytes):
            with open(file_path, "wb") as f:
                f.write(data)
        elif isinstance(data, io.BytesIO):
             with open(file_path, "wb") as f:
                f.write(data.getvalue())
        else:
             raise TypeError(f"Unsupported data type for saving: {type(data)}")

    except Exception as e:
        print(f"Error saving data resource {original_name}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to save generated resource.")

    return _create_resource_metadata(resource_id, original_name, resource_type, file_path)

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
        file_path = _get_resource_path(resource_id, resource_type)
        file_path.unlink() # Remove the file
    except FileNotFoundError:
         raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Resource {resource_id} ({resource_type.value}) not found for deletion.")
    except ValueError as e: # Invalid ID format
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        print(f"Error deleting resource {resource_id} ({resource_type.value}): {e}")
        # Don't necessarily raise 500, maybe just log that cleanup failed
        # For now, let's report failure.
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to delete resource file.")

def _get_original_name_base(resource_id: str, resource_type: ResourceType) -> str:
    """Attempts to find the original filename base (without extension) for a resource."""
    try:
        path = _get_resource_path(resource_id, resource_type)
        # A robust way requires storing metadata. Simplest: check common extensions.
        # Or list resources and find match (inefficient).
        # For now, just use the ID as base if original name isn't easily found.
        # This part needs a better metadata system for accuracy.
        # Let's return the ID for now, processing functions can override this.
        return resource_id
    except (FileNotFoundError, ValueError):
        return resource_id # Fallback

# --- FastAPI App Creation ---

def create_server() -> FastAPI:
    app = FastAPI(
        title="Canon Keeper API & Web",
        description="Processes TTRPG video/audio recordings and serves the web UI.",
        version="0.3.0", # Incremented version
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

@app.post("/upload/{resource_type_str}", status_code=status.HTTP_201_CREATED)
async def upload_resource(resource_type_str: str, file: UploadFile = File(...)):
    """Uploads a file resource (video, audio, json, text)."""
    try:
        resource_type = ResourceType(resource_type_str)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid resource type. Valid types are: {[rt.value for rt in ResourceType]}"
        )

    # Validate based on type - crude check, could be more robust
    content_type = file.content_type
    if resource_type == ResourceType.VIDEO and not content_type.startswith("video/"):
         print(f"Warning: Uploaded file for type '{resource_type.value}' has Content-Type '{content_type}'")
         # Allow upload but warn
         # raise HTTPException(status_code=400, detail="Invalid content type for video.")
    if resource_type == ResourceType.AUDIO and not content_type.startswith("audio/"):
         print(f"Warning: Uploaded file for type '{resource_type.value}' has Content-Type '{content_type}'")
    if resource_type in [ResourceType.JSON_TRANSCRIPT, ResourceType.JSON_SPEAKER_MAP] and content_type != "application/json":
         print(f"Warning: Uploaded file for type '{resource_type.value}' has Content-Type '{content_type}'")
    if resource_type == ResourceType.TEXT_PROMPT and not content_type.startswith("text/"):
         print(f"Warning: Uploaded file for type '{resource_type.value}' has Content-Type '{content_type}'")

    try:
        resource_metadata = await _save_file_resource(file, resource_type)
        return resource_metadata
    except HTTPException as e:
        raise e # Re-raise client/server errors during save
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"An unexpected error occurred: {e}")


@app.get("/resources")
async def list_resources():
    """Lists all available resources on the server."""
    all_resources = []
    for resource_type in ResourceType:
        resource_dir = _get_resource_dir(resource_type)
        try:
            for file_path in resource_dir.iterdir():
                if file_path.is_file():
                    resource_id = file_path.stem # UUID without extension
                    # Getting original name reliably needs metadata storage.
                    # For now, use the filename as original_name placeholder.
                    metadata = _create_resource_metadata(
                        resource_id, file_path.name, resource_type, file_path
                    )
                    all_resources.append(metadata)
        except Exception as e:
            print(f"Error listing resources in {resource_dir}: {e}")
            # Continue listing other types even if one fails
    return all_resources

@app.get("/download/{resource_type_str}/{resource_id}")
async def download_resource(resource_type_str: str, resource_id: str):
    """Downloads a specific resource file."""
    try:
        resource_type = ResourceType(resource_type_str)
        file_path = _get_resource_path(resource_id, resource_type)
        # Use original name if possible/stored, otherwise use filename
        # This still lacks proper original name tracking without metadata db
        download_name = file_path.name
        return FileResponse(path=file_path, filename=download_name)
    except (FileNotFoundError, ValueError) as e:
        status_code = status.HTTP_404_NOT_FOUND if isinstance(e, FileNotFoundError) else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=str(e))
    except HTTPException as e:
        raise e
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to prepare file for download.")


@app.delete("/resource/{resource_type_str}/{resource_id}", status_code=status.HTTP_200_OK)
async def delete_resource(resource_type_str: str, resource_id: str):
    """Deletes a specific resource."""
    try:
        resource_type = ResourceType(resource_type_str)
        _delete_resource_file(resource_id, resource_type)
        return {"message": f"Resource {resource_id} ({resource_type.value}) deleted successfully."}
    except HTTPException as e:
        raise e # Propagate errors from helper
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="An unexpected error occurred during deletion.")

# --- Processing Pipeline Endpoints ---

@app.post("/process/video_to_audio", status_code=status.HTTP_201_CREATED)
async def process_video_to_audio(video_id: str = Form(...)):
    """Extracts audio from an uploaded video resource."""
    try:
        video_data = _load_resource_bytes(video_id, ResourceType.VIDEO)
        # Find original name for better output naming
        video_path = _get_resource_path(video_id, ResourceType.VIDEO)
        original_name_base = video_path.stem # Name without extension

        print(f"Extracting audio from video ID: {video_id}")
        audio_data: io.BytesIO | None = video2audio.video_to_mp3(video_data)

        if not audio_data:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Audio extraction failed (returned None).")

        print("Audio extraction complete. Saving resource...")
        audio_metadata = _save_data_resource(
            data=audio_data,
            resource_type=ResourceType.AUDIO,
            original_name_base=f"{original_name_base}_audio",
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
    audio_id: str = Form(...),
    assemblyai_api_key: str = Form(...)
):
    """Generates a transcript JSON from an audio resource using AssemblyAI."""
    if not assemblyai_api_key:
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="AssemblyAI API Key is required.")

    try:
        audio_data = _load_resource_bytes(audio_id, ResourceType.AUDIO)
        audio_path = _get_resource_path(audio_id, ResourceType.AUDIO)
        original_name_base = audio_path.stem

        print(f"Starting transcription for audio ID: {audio_id}")
        # Assuming audio_to_transcript expects BytesIO and API key
        transcript: dict | None = audio2transcript.audio_to_transcript(audio_data, assemblyai_api_key)

        if not transcript:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Transcription failed (returned None). Check API key and audio format.")

        print("Transcription complete. Saving resource...")
        transcript_metadata = _save_data_resource(
            data=transcript,
            resource_type=ResourceType.JSON_TRANSCRIPT,
            original_name_base=f"{original_name_base}_transcript",
            extension="json"
        )
        return transcript_metadata

    except HTTPException as e:
        raise e
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Transcription process failed: {e}")

@app.post("/process/transcript_to_snippets", status_code=status.HTTP_201_CREATED)
async def process_transcript_to_snippets(
    audio_id: str = Form(...),
    transcript_id: str = Form(...)
):
    """Generates audio snippets for each speaker identified in the transcript."""
    try:
        audio_data = _load_resource_bytes(audio_id, ResourceType.AUDIO)
        transcript_data = _load_resource_json(transcript_id, ResourceType.JSON_TRANSCRIPT)
        transcript_path = _get_resource_path(transcript_id, ResourceType.JSON_TRANSCRIPT)
        original_name_base = transcript_path.stem # e.g., video_name_transcript

        utterances = transcript_data.get("utterances")
        if utterances is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Transcript JSON does not contain 'utterances' key.")
        if not isinstance(utterances, list):
             raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="'utterances' key is not a list.")

        print(f"Generating speaker snippets for transcript ID: {transcript_id}")
        speaker_snippets_dict: dict[str, dict[str, typing.Any]] = transcript2snippets.transcript_to_snippets(
            audio_data, utterances
        )

        if not speaker_snippets_dict:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Snippet generation failed (returned empty dict).")

        print("Snippet generation complete. Saving resources...")
        saved_snippets_metadata = {}
        for speaker_label, snippet_data in speaker_snippets_dict.items():
            snippet_audio = snippet_data.get("audio")
            if not snippet_audio or not isinstance(snippet_audio, io.BytesIO):
                print(f"Warning: Invalid or missing audio data for speaker {speaker_label}. Skipping.")
                continue

            snippet_metadata = _save_data_resource(
                data=snippet_audio,
                resource_type=ResourceType.SNIPPET,
                original_name_base=f"{original_name_base}_speaker_{speaker_label}_snippet",
                extension="mp3" # Assuming snippets are MP3
            )
            saved_snippets_metadata[speaker_label] = snippet_metadata

        # Return a map from speaker label (A, B, ...) to their saved snippet metadata
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
        transcript_path = _get_resource_path(transcript_id, ResourceType.JSON_TRANSCRIPT)
        original_name_base = transcript_path.stem.replace("_transcript", "") # Try to get base name

        # Validate speaker_name_map format (simple check)
        if not isinstance(speaker_name_map, dict):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Speaker map must be a JSON object (dict).")
        # Could add checks for key/value types if needed

        print(f"Generating session script from transcript ID: {transcript_id}")
        session_script: str = transcript2session.transcript_to_session(transcript_data, speaker_name_map)

        if not session_script: # Assuming empty string means failure or no content
             raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Session script generation failed (returned empty).")

        print("Session script generation complete. Saving resource...")
        session_metadata = _save_data_resource(
            data=session_script,
            resource_type=ResourceType.TEXT_SESSION,
            original_name_base=f"{original_name_base}_session_script",
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
    session_id: str = Form(...),
    recap_prompt_id: str = Form(...),
    google_gemini_api_key: str = Form(...) # Or other LLM key
):
    """Generates a recap from a session script using an LLM."""
    if not google_gemini_api_key:
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="LLM API Key is required.")

    try:
        session_script = _load_resource_text(session_id, ResourceType.TEXT_SESSION)
        recap_prompt = _load_resource_text(recap_prompt_id, ResourceType.TEXT_PROMPT)
        session_path = _get_resource_path(session_id, ResourceType.TEXT_SESSION)
        original_name_base = session_path.stem.replace("_session_script", "")

        print(f"Generating recap for session ID: {session_id}")
        # Assuming session_to_recap takes script, key, prompt
        recap: str | None = session2recap.session_to_recap(session_script, google_gemini_api_key, recap_prompt)

        if not recap:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Recap generation failed (returned None). Check API key and prompts.")

        print("Recap generation complete. Saving resource...")
        recap_metadata = _save_data_resource(
            data=recap,
            resource_type=ResourceType.TEXT_RECAP,
            original_name_base=f"{original_name_base}_recap",
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
    recap_id: str = Form(...),
    summary_prompt_id: str = Form(...),
    google_gemini_api_key: str = Form(...) # Or other LLM key
):
    """Generates a summary from a recap using an LLM."""
    if not google_gemini_api_key:
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="LLM API Key is required.")

    try:
        recap_text = _load_resource_text(recap_id, ResourceType.TEXT_RECAP)
        summary_prompt = _load_resource_text(summary_prompt_id, ResourceType.TEXT_PROMPT)
        recap_path = _get_resource_path(recap_id, ResourceType.TEXT_RECAP)
        original_name_base = recap_path.stem.replace("_recap", "")

        print(f"Generating summary for recap ID: {recap_id}")
        # Assuming recap_to_summary exists and takes recap, key, prompt
        # Assuming recap_to_summary function exists in session2recap or similar module
        summary: str | None = session2recap.recap_to_summary(recap_text, google_gemini_api_key, summary_prompt)

        if not summary:
             raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Summary generation failed (returned None). Check API key and prompts.")

        print("Summary generation complete. Saving resource...")
        summary_metadata = _save_data_resource(
            data=summary,
            resource_type=ResourceType.TEXT_SUMMARY,
            original_name_base=f"{original_name_base}_summary",
            extension="txt"
        )
        return summary_metadata

    except HTTPException as e:
        raise e
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Summary generation process failed: {e}")


# --- Root Endpoint and Server Runner ---

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
         # Alternatively raise 404:
         # raise HTTPException(
         #     status_code=404, detail=f"Index file not found at {index_path}"
         # )
    return FileResponse(index_path)


def run_server():
    """Starts the Uvicorn server."""
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info", reload=False) # reload=False for production/build


def launch_client():
    """Attempts to open the web browser to the running server."""
    url = "http://127.0.0.1:8000"
    print(f"Attempting to open browser at {url}")
    try:
        # Give server a moment to start
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    except Exception as e:
        print(f"Could not automatically open browser: {e}. Please manually navigate to {url}")


if __name__ == "__main__":
    print("Initializing Canon Keeper Server...")
    # Ensure resource directories exist on startup
    for resource_type in ResourceType:
        _get_resource_dir(resource_type).mkdir(parents=True, exist_ok=True)
    print(f"Resource directory base: {RESOURCE_BASE_DIR}")

    # Start server in a background thread
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()

    # Launch client browser
    launch_client()

    # Keep main thread alive to allow server thread to run and wait for user input
    try:
        input("Server is running. Press Enter in this console window to stop...\n")
    except KeyboardInterrupt:
        print("\nCtrl+C detected.")
    finally:
        print("Stopping server...")
        # Uvicorn running in a daemon thread should exit when the main thread exits.
        # No explicit stop needed here for uvicorn.run in a thread.
        print("Server stopped.")
