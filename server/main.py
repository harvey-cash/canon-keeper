# server/main.py

import os       # <-- Add
import sys      # <-- Add
import io
import webbrowser
import threading
import time
import uvicorn

from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import traceback

# Your src imports... make sure PyInstaller finds src too!
from src import video2audio, audio2transcript, transcript2session, session2recap

# --- Helper function to find bundled resource path ---
def resource_path(relative_path):
    """ Get absolute path to resource, works for dev and for PyInstaller """
    try:
        # PyInstaller creates a temp folder and stores path in _MEIPASS
        # The base path is the root of the extracted folder
        base_path = sys._MEIPASS
    except Exception:
        # sys._MEIPASS is not defined, so running in normal Python environment
        # Use the directory of the main script file (.py) as the base
        base_path = os.path.abspath(os.path.dirname(__file__))

    # Join the base path with the relative path provided
    return os.path.join(base_path, relative_path)

# --- FastAPI App Setup ---
# ... (keep FastAPI app creation and CORS middleware as before) ...
app = FastAPI(
    title="Video Recap Generator API & Web",
    description="Processes video and serves the web UI.",
    version="0.2.1", # Bump version
)
origins = [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:5173", # Optional: for dev
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- API Routes ---
# ... (keep your existing API endpoint logic here - @app.post("/process-video/") ...) ...
@app.post("/process-video/")
async def process_video_endpoint(
    # ... params ...
    video: UploadFile = File(...),
    transcript_api_key: str = Form(...),
    llm_api_key: str = Form(...),
    recap_prompt: str = Form(...),
    summary_prompt: str = Form(...),
):
    # ... implementation ...
        print("Received request to process video.")
        audio_stream: io.BytesIO | None = None

        try:
            # 1. Read video data into bytes
            print("Reading video file...")
            video_data: bytes = await video.read()
            if not video_data:
                raise HTTPException(status_code=400, detail="Video file is empty.")

            video_stream = io.BytesIO(video_data)

            video_name_with_ext = video.filename or "uploaded_video"
            video_name = os.path.splitext(video_name_with_ext)[0]
            print(f"Processing video: {video_name_with_ext}")

            # 2. Extract Audio
            print("Extracting audio from video...")
            audio_stream = video2audio.video_to_mp3(video_stream)
            if not audio_stream:
                print("Audio extraction failed.")
                raise HTTPException(status_code=500, detail="Failed to extract audio from video.")
            print("Audio extraction complete.")

            # 3. Transcribe Audio
            print("Starting transcription process...")
            audio_stream.seek(0)
            transcript: dict | None = audio2transcript.audio_to_transcript(audio_stream, transcript_api_key)
            if not transcript:
                print("Transcription failed.")
                raise HTTPException(status_code=500, detail="Failed to transcribe audio.")
            print("Transcription complete.")

            # 4. Generate Session Script
            print("Generating session script...")
            audio_stream.seek(0)
            session_script: str = transcript2session.transcript_to_session(audio_stream, transcript)
            if not session_script:
                print("Session script generation failed or produced empty result.")
                raise HTTPException(status_code=500, detail="Failed to generate session script from transcript (or result was empty).")
            print("Session script generated.")

            # 5. Generate Recap
            print("Generating recap...")
            recap: str = session2recap.session_to_recap(session_script, llm_api_key, recap_prompt)
            if not recap:
                print("Recap generation failed or produced empty result.")
                raise HTTPException(status_code=500, detail="Failed to generate recap (or result was empty).")
            print("Recap generated.")

            # 6. Generate Summary
            print("Generating summary...")
            summary: str = session2recap.recap_to_summary(recap, llm_api_key, summary_prompt)
            if not summary:
                print("Summary generation failed or produced empty result.")
                raise HTTPException(status_code=500, detail="Failed to generate summary (or result was empty).")
            print("Summary generated.")

            print("All tasks completed successfully.")

            # 7. Return results
            return JSONResponse(content={
                "message": "Video processed successfully.",
                "video_name": video_name,
                "session_script": session_script,
                "recap": recap,
                "summary": summary,
            })

        except HTTPException as http_exc:
            raise http_exc
        except Exception as e:
            print(f"An unexpected error occurred: {e}")
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"An internal server error occurred: {str(e)}")
        finally:
            if audio_stream:
               audio_stream.close()



# --- Static Files Hosting ---
# Use the helper function to get the correct paths
assets_path = resource_path("web_content/assets")
index_path = resource_path("web_content/index.html")

# Serve files from the 'assets' sub-directory using the calculated absolute path
app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

# Serve the main index.html for the root path using the calculated absolute path
@app.get("/")
async def serve_index():
    # Check if index.html actually exists at the path before serving
    if not os.path.exists(index_path):
         raise HTTPException(status_code=404, detail=f"Index file not found at {index_path}")
    return FileResponse(index_path)

# --- Main Execution Block ---
# ... (keep your threading and webbrowser logic as before) ...
def run_server():
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info", reload=False)

if __name__ == "__main__":
    print("Starting server...")
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()

    print("Waiting for server to initialize...")
    time.sleep(4) # Maybe increase slightly

    url = "http://127.0.0.1:8000"
    print(f"Opening browser at {url}")
    try:
        if not webbrowser.open(url):
            print(f"Could not automatically open browser. Please manually navigate to {url}")
    except Exception as e:
            print(f"Error opening browser: {e}. Please manually navigate to {url}")

    print("Server is running in the background.")
    input("Press Enter in this console window to stop the server...\n")
    print("Stopping server...")
