# main.py

import io
import os
import threading
import traceback
import webbrowser
import typing
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, status, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

# Refactored imports
from config import RESOURCE_BASE_DIR
from resource_model import (
    ResourceType, ResourceMetadata,
    ResourceError, ResourceNotFoundError, ResourceSaveError,
    InvalidResourceIdError, InvalidResourceTypeError
)
from resource_manager import ResourceManager

# Import processing modules
from src import (
    file_io, # Still needed for resource_path in static files/favicon
    video2audio,
    audio2transcript,
    transcript2snippets,
    transcript2session,
    session2recap,
)

# --- Initialize Resource Manager ---
# This ensures resource directories are checked/created on startup via ResourceManager.__init__
resource_mgr = ResourceManager(base_dir=RESOURCE_BASE_DIR)

# --- FastAPI App Creation ---
def create_server() -> FastAPI:
    app = FastAPI(
        title="Canon Keeper API & Web",
        description="Processes TTRPG video/audio recordings and serves the web UI.",
        version="0.5.0", # Version bumped post-refactor
    )
    origins = [
        "http://localhost:8000",    # Backend default
        "http://127.0.0.1:8000",   # Backend explicit
        "http://localhost:5173",    # Default Vite dev server
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # Serve static assets for the web UI (if built)
    # Use file_io helper to find path relative to executable/script
    assets_path_str = file_io.resource_path("web_content/assets")
    assets_path = Path(assets_path_str)
    if assets_path.exists() and assets_path.is_dir():
          app.mount("/assets", StaticFiles(directory=assets_path), name="assets")
    else:
        print(f"Warning: Assets directory not found or not a directory at {assets_path_str}. Frontend assets might not load.")

    return app

app = create_server()

# --- Helper to Map Resource Errors to HTTP Exceptions ---
def handle_resource_error(exc: ResourceError):
    if isinstance(exc, ResourceNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    elif isinstance(exc, (InvalidResourceIdError, InvalidResourceTypeError)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    elif isinstance(exc, ResourceSaveError):
        # Internal server error for save/delete failures
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))
    else:
        # Fallback for any other ResourceError or unexpected types
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"An unexpected resource error occurred: {exc}")

# --- API Endpoints ---

# --- Resource Management Endpoints ---

@app.post("/upload/{resource_type_str}", status_code=status.HTTP_201_CREATED, response_model=ResourceMetadata)
async def upload_resource(resource_type_str: str, file: UploadFile = File(...)):
    """Uploads a file resource (video, audio, json, text)."""

    try:
        # Validate ResourceType enum
        resource_type = ResourceType(resource_type_str)
        # Disallow direct snippet upload via this endpoint for clarity
        if resource_type == ResourceType.SNIPPET:
            raise InvalidResourceTypeError("Direct upload of 'snippet' type is not allowed.")
    except ValueError:
        valid_types = [rt.value for rt in ResourceType if rt != ResourceType.SNIPPET]
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid resource type '{resource_type_str}'. Valid types are: {valid_types}"
        )

    print(f"Attempting upload: filename='{file.filename}', content_type='{file.content_type or 'N/A'}', resource_type='{resource_type_str}'")

    try:
        resource_metadata = await resource_mgr.save_uploaded_file(file, resource_type)
        return resource_metadata
    except ResourceError as e:
        handle_resource_error(e)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"An unexpected error occurred during upload: {e}")


@app.get("/resources", response_model=list[ResourceMetadata])
async def list_resources():
    """Lists all available resources on the server."""
    try:
        return resource_mgr.list_resources()
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to list resources: {e}")


@app.get("/download/{resource_type_str}/{resource_id}")
async def download_resource(resource_type_str: str, resource_id: str):
    """Downloads a specific resource file."""
    try:
        resource_type = ResourceType(resource_type_str)
        # Get metadata first to have the original filename for the download
        metadata = resource_mgr.get_resource_metadata(resource_id, resource_type)
        file_path = resource_mgr.get_resource_path(resource_id, resource_type)
        # Use original_name from metadata for the download 'filename' attribute
        return FileResponse(path=file_path, filename=metadata.original_name)
    except ResourceError as e:
         handle_resource_error(e)
    except ValueError: # Catch invalid ResourceType enum string
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid resource type: {resource_type_str}")
    except Exception as e:
        # Handle benign errors like client closing connection during streaming
        if isinstance(e, ConnectionAbortedError) or isinstance(e, ConnectionResetError):
             print(f"Info: Connection closed by client during download for {resource_id}.")
             # Return an empty response or minimal success to avoid server noise
             return Response(status_code=200) # Or raise specific code if frontend needs it
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to prepare file for download: {e}")


@app.delete("/resource/{resource_type_str}/{resource_id}", status_code=status.HTTP_200_OK)
async def delete_resource(resource_type_str: str, resource_id: str):
    """Deletes a specific resource."""
    try:
        resource_type = ResourceType(resource_type_str)
        resource_mgr.delete_resource(resource_id, resource_type)
        return {"message": f"Resource {resource_id} ({resource_type.value}) deleted successfully."}
    except ResourceError as e:
        handle_resource_error(e)
    except ValueError: # Catch invalid ResourceType enum string
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid resource type: {resource_type_str}")
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"An unexpected error occurred during deletion: {e}")


# --- Processing Pipeline Endpoints ---

@app.post("/process/video_to_audio", status_code=status.HTTP_201_CREATED, response_model=ResourceMetadata)
async def process_video_to_audio(video_id: str = Form(...)):
    """Extracts audio from an uploaded video resource."""
    try:
        # Get original name for deriving output name
        input_metadata = resource_mgr.get_resource_metadata(video_id, ResourceType.VIDEO)
        video_data = resource_mgr.load_bytes(video_id, ResourceType.VIDEO)

        print(f"Extracting audio from video ID: {video_id} (Original: {input_metadata.original_name})")
        # Run the processing (can raise its own errors)
        audio_data: io.BytesIO | None = video2audio.video_to_mp3(video_data)

        if not audio_data:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Audio extraction failed (video2audio returned None).")

        print("Audio extraction complete. Saving resource...")
        # Save the result using ResourceManager
        audio_metadata = resource_mgr.save_generated_data(
            data=audio_data,
            resource_type=ResourceType.AUDIO,
            input_original_name=input_metadata.original_name,
            output_suffix="_audio",
            extension="mp3"
        )
        return audio_metadata
    except ResourceError as e:
        handle_resource_error(e)
    except HTTPException as e: # Re-raise HTTP exceptions from this function
         raise e
    except Exception as e: # Catch errors from video2audio or other unexpected issues
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Audio extraction process failed: {e}")


@app.post("/process/audio_to_transcript", status_code=status.HTTP_201_CREATED, response_model=ResourceMetadata)
async def process_audio_to_transcript(
    # Keep Request for potential debugging, but don't rely on it for core logic
    request: Request,
    audio_id: str = Form(...),
    assemblyai_api_key: str = Form(...)
):
    """Generates a transcript JSON from an audio resource using AssemblyAI."""
    if not assemblyai_api_key:
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="AssemblyAI API Key is required.")
    if not audio_id:
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Audio ID is required.")

    # Optional: Log form data for debugging 422s if they persist
    # form_data = await request.form()
    # print(f"Transcription Request Form Data: {form_data}")

    try:
        input_metadata = resource_mgr.get_resource_metadata(audio_id, ResourceType.AUDIO)
        audio_data = resource_mgr.load_bytes(audio_id, ResourceType.AUDIO)

        print(f"Starting transcription for audio ID: {audio_id} (Original: {input_metadata.original_name})")
        # Run the processing
        transcript: dict | None = audio2transcript.audio_to_transcript(audio_data, assemblyai_api_key)

        # Validate transcript result
        if transcript is None:
            print(f"Transcription call returned None for audio_id: {audio_id}")
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Transcription failed. Check AssemblyAI key, audio format/length, and AssemblyAI status.")
        if transcript.get("error"):
            print(f"AssemblyAI Error for {audio_id}: {transcript['error']}")
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Transcription Error from AssemblyAI: {transcript['error']}")
        if not transcript.get("utterances"): # Basic check for expected structure
            print(f"Transcription for {audio_id} completed but missing 'utterances'. Result: {transcript}")
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Transcription completed but output format is unexpected (missing 'utterances').")

        print("Transcription complete. Saving resource...")
        transcript_metadata = resource_mgr.save_generated_data(
            data=transcript,
            resource_type=ResourceType.JSON_TRANSCRIPT,
            input_original_name=input_metadata.original_name,
            output_suffix="_transcript",
            extension="json"
        )
        return transcript_metadata
    except ResourceError as e:
        handle_resource_error(e)
    except HTTPException as e:
         raise e
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Transcription process failed unexpectedly: {e}")


@app.post("/process/transcript_to_snippets", status_code=status.HTTP_201_CREATED, response_model=dict[str, ResourceMetadata])
async def process_transcript_to_snippets(
    audio_id: str = Form(...),
    transcript_id: str = Form(...)
):
    """Generates audio snippets for each speaker identified in the transcript."""
    try:
        audio_metadata = resource_mgr.get_resource_metadata(audio_id, ResourceType.AUDIO)
        audio_data = resource_mgr.load_bytes(audio_id, ResourceType.AUDIO)
        transcript_data = resource_mgr.load_json(transcript_id, ResourceType.JSON_TRANSCRIPT)

        utterances = transcript_data.get("utterances")
        if utterances is None or not isinstance(utterances, list):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Transcript JSON is missing or has invalid 'utterances'.")

        print(f"Generating speaker snippets for transcript ID: {transcript_id} (Audio: {audio_metadata.original_name})")
        # Run processing
        speaker_snippets_dict: dict[str, dict[str, typing.Any]] = transcript2snippets.transcript_to_snippets(
            audio_data, utterances
        )

        if not speaker_snippets_dict:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Snippet generation failed (returned empty dict). Ensure transcript has speaker labels and audio matches.")

        print("Snippet generation complete. Saving resources...")
        saved_snippets_metadata = {}
        input_base_name = Path(audio_metadata.original_name).stem # Use audio base name for snippets

        for speaker_label, snippet_data in speaker_snippets_dict.items():
            snippet_audio = snippet_data.get("audio")
            if not isinstance(snippet_audio, io.BytesIO):
                print(f"Warning: Invalid or missing audio data for speaker '{speaker_label}'. Skipping.")
                continue

            try:
                 # Define a base name for this specific snippet's output
                 snippet_input_name = f"{input_base_name}_speaker_{speaker_label}"
                 snippet_metadata = resource_mgr.save_generated_data(
                     data=snippet_audio,
                     resource_type=ResourceType.SNIPPET,
                     input_original_name=snippet_input_name, # Base for derived name
                     output_suffix="_snippet", # Added to the base above
                     extension="mp3"
                 )
                 saved_snippets_metadata[speaker_label] = snippet_metadata
            except ResourceError as e:
                 # Log error for specific snippet and continue if possible
                 print(f"Error saving snippet for speaker '{speaker_label}': {e}")
                 # Optionally re-raise if one failure should stop the whole process
                 # handle_resource_error(e)
            except Exception as e:
                 print(f"Unexpected error saving snippet for speaker '{speaker_label}': {e}")
                 # Optionally re-raise

        if not saved_snippets_metadata:
            raise HTTPException(status_code=500, detail="Snippet generation ran but failed to save any valid snippet files.")

        return saved_snippets_metadata
    except ResourceError as e:
        handle_resource_error(e)
    except HTTPException as e:
         raise e
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Snippet generation process failed: {e}")


@app.post("/process/transcript_to_session", status_code=status.HTTP_201_CREATED, response_model=ResourceMetadata)
async def process_transcript_to_session(
    transcript_id: str = Form(...),
    speaker_map_id: str = Form(...) # ID of the uploaded JSON speaker map
):
    """Generates a formatted session script from a transcript and speaker map."""
    try:
        transcript_metadata = resource_mgr.get_resource_metadata(transcript_id, ResourceType.JSON_TRANSCRIPT)
        transcript_data = resource_mgr.load_json(transcript_id, ResourceType.JSON_TRANSCRIPT)
        speaker_name_map = resource_mgr.load_json(speaker_map_id, ResourceType.JSON_SPEAKER_MAP)

        if not isinstance(speaker_name_map, dict):
            # Ensure loaded speaker map is actually a dictionary
            raise InvalidResourceTypeError(f"Speaker map resource '{speaker_map_id}' is not a valid JSON object.")

        print(f"Generating session script from transcript ID: {transcript_id} (Original: {transcript_metadata.original_name})")
        # Run processing
        session_script: str = transcript2session.transcript_to_session(transcript_data, speaker_name_map)

        if not session_script: # Check if result is empty or None
             raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Session script generation failed (returned empty or None).")

        print("Session script generation complete. Saving resource...")
        session_metadata = resource_mgr.save_generated_data(
            data=session_script,
            resource_type=ResourceType.TEXT_SESSION,
            input_original_name=transcript_metadata.original_name, # Use transcript name as base
            output_suffix="_session_script",
            extension="txt"
        )
        return session_metadata
    except ResourceError as e:
        handle_resource_error(e)
    except HTTPException as e:
         raise e
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Session script generation process failed: {e}")


@app.post("/process/session_to_recap", status_code=status.HTTP_201_CREATED, response_model=ResourceMetadata)
async def process_session_to_recap(
    text_session_id: str = Form(...),
    prompt_id: str = Form(...),
    google_gemini_api_key: str = Form(...)
):
    """Generates a recap from a session script using an LLM."""
    if not google_gemini_api_key:
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google Gemini API Key is required.")

    try:
        session_metadata = resource_mgr.get_resource_metadata(text_session_id, ResourceType.TEXT_SESSION)
        session_script = resource_mgr.load_text(text_session_id, ResourceType.TEXT_SESSION)
        recap_prompt = resource_mgr.load_text(prompt_id, ResourceType.TEXT_PROMPT)

        print(f"Generating recap for session ID: {text_session_id} (Original: {session_metadata.original_name})")
        # Run processing
        recap: str | None = session2recap.session_to_recap(session_script, google_gemini_api_key, recap_prompt)

        if not recap:
             raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Recap generation failed (returned None). Check API key, prompts, and LLM status.")

        print("Recap generation complete. Saving resource...")
        recap_metadata = resource_mgr.save_generated_data(
            data=recap,
            resource_type=ResourceType.TEXT_RECAP,
            input_original_name=session_metadata.original_name,
            output_suffix="_recap",
            extension="txt"
        )
        return recap_metadata
    except ResourceError as e:
        handle_resource_error(e)
    except HTTPException as e:
         raise e
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Recap generation process failed: {e}")


@app.post("/process/recap_to_summary", status_code=status.HTTP_201_CREATED, response_model=ResourceMetadata)
async def process_recap_to_summary(
    text_recap_id: str = Form(...),
    prompt_id: str = Form(...),
    google_gemini_api_key: str = Form(...)
):
    """Generates a summary from a recap using an LLM."""
    if not google_gemini_api_key:
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google Gemini API Key is required.")

    try:
        recap_metadata = resource_mgr.get_resource_metadata(text_recap_id, ResourceType.TEXT_RECAP)
        recap_text = resource_mgr.load_text(text_recap_id, ResourceType.TEXT_RECAP)
        summary_prompt = resource_mgr.load_text(prompt_id, ResourceType.TEXT_PROMPT)

        print(f"Generating summary for recap ID: {text_recap_id} (Original: {recap_metadata.original_name})")
        # Run processing
        summary: str | None = session2recap.recap_to_summary(recap_text, google_gemini_api_key, summary_prompt)

        if not summary:
             raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Summary generation failed (returned None). Check API key, prompts, and LLM status.")

        print("Summary generation complete. Saving resource...")
        summary_metadata = resource_mgr.save_generated_data(
            data=summary,
            resource_type=ResourceType.TEXT_SUMMARY,
            input_original_name=recap_metadata.original_name,
            output_suffix="_summary",
            extension="txt"
        )
        return summary_metadata
    except ResourceError as e:
        handle_resource_error(e)
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
    if not index_path.is_file():
        print(f"Warning: index.html not found at {index_path_str}")
        # Provide a simple API info page if index.html is missing
        return JSONResponse(
            content={
                "message": "Canon Keeper API is running.",
                "docs_url": "/docs",
                "available_resource_types": [rt.value for rt in ResourceType],
                "resource_base_directory": str(RESOURCE_BASE_DIR),
            },
            status_code=status.HTTP_200_OK
        )
    return FileResponse(index_path)


@app.get("/favicon.ico", include_in_schema=False)
async def serve_favicon():
    """Serves the favicon.ico for the web UI."""
    favicon_path_str = file_io.resource_path("web_content/favicon.ico")
    favicon_path = Path(favicon_path_str)
    if not favicon_path.is_file():
         # Don't raise 404, just return No Content if missing
         return Response(status_code=status.HTTP_204_NO_CONTENT)
    return FileResponse(favicon_path)


def run_server():
    """Starts the Uvicorn server."""
    # Consider making host/port configurable (e.g., via config.py or env vars)
    uvicorn.run(app=app, host="127.0.0.1", port=8000, log_level="info", reload=False)


def launch_client():
    """Attempts to open the web browser to the running server."""
    url = "http://127.0.0.1:8000"
    print(f"Attempting to open browser at {url}")
    # Run webbrowser.open in a separate thread to avoid blocking server start
    thread = threading.Thread(target=webbrowser.open, args=(url,), daemon=True)
    thread.start()


if __name__ == "__main__":
    print("Initializing Canon Keeper Server...")
    # ResourceManager.__init__ already ensures directories exist

    # Server on background thread allows main thread to wait for input
    server_thread = threading.Thread(target=run_server, daemon=True, name="CanonKeeperServer")
    server_thread.start()

    launch_client()

    try:
        # Keep main thread alive until user presses Enter or Ctrl+C
        input("Server is running. Press Enter in this console window to stop...\n")
    except KeyboardInterrupt:
        print("\nCtrl+C detected.")
    finally:
        print("Stopping server...")
        # Uvicorn running in a daemon thread will exit automatically when the main thread ends.
        # If more complex cleanup is needed, implement graceful shutdown logic here.