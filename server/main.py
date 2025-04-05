# Video Recap Generator API

import os
import io
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import traceback # Keep for error logging

from src import video2audio
from src import audio2transcript
from src import transcript2session
from src import session2recap

app = FastAPI(
    title="Video Recap Generator API",
    description="Upload a video and get text recap and summary.",
    version="0.1.2", # Bump version
)

origins = [
    "http://localhost:5173", # Vite default dev server
    # You might add other origins here if needed, e.g., deployed frontend URL
    # "http://localhost:3000", # Common React dev server port
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,  # List of origins allowed to make requests
    allow_credentials=True, # Allow cookies/authorization headers (good practice)
    allow_methods=["*"],    # Allow all standard methods (GET, POST, etc.)
    allow_headers=["*"],    # Allow all headers
)

@app.post("/process-video/")
async def process_video_endpoint(
    video: UploadFile = File(..., description="Video file to process."),
    transcript_api_key: str = Form(..., description="AssemblyAI API Key for transcription."),
    llm_api_key: str = Form(..., description="Google Gemini API Key for recap/summary."),
    recap_prompt: str = Form(..., description="Text prompt for generating the recap."),
    summary_prompt: str = Form(..., description="Text prompt for generating the summary."),
):
    """
    Processes an uploaded video file to generate a transcript, session script,
    recap, and summary.
    """
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


@app.get("/")
async def root():
    return {"message": "Video Recap Generator API is running."}

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)