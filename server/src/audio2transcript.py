import io
import json
import os
import tkinter as tk
import typing
from tkinter import filedialog

import assemblyai as aai


def mp3_to_transcript(
    audio_data: io.BytesIO, api_key: str
) -> typing.Optional[aai.Transcript]:
    """
    Transcribes MP3 audio data using AssemblyAI.

    Args:
        audio_data: An io.BytesIO object containing the MP3 audio.
        api_key: Your AssemblyAI API key.

    Returns:
        The AssemblyAI Transcript object on success, None on failure.
    """
    if not api_key:
        print("Error: API key is missing.")
        return None

    aai.settings.api_key = api_key
    config = aai.TranscriptionConfig(speaker_labels=True)
    transcriber = aai.Transcriber()

    print("Starting transcription process with AssemblyAI...")

    try:
        audio_data.seek(0)  # Ensure the BytesIO stream is at the beginning
        transcript = transcriber.transcribe(audio_data, config)

    except Exception as e:
        print(f"Error during AssemblyAI transcription call: {e}")
        return None

    if transcript.status == aai.TranscriptStatus.error:
        print(f"Transcription failed: {transcript.error}")
        return None

    print("Transcription API call successful.")
    return transcript


def main():
    try:
        # Initialize Tkinter and hide the root window
        root = tk.Tk()
        root.withdraw()

        print("Select the MP3 audio file to transcribe.")
        audio_path = filedialog.askopenfilename(
            title="Select MP3 Audio File",
            filetypes=[("MP3 audio files", "*.mp3"), ("All files", "*.*")],
        )

        if not audio_path:
            print("No audio file selected. Exiting.")
            return

        print(f"Audio file selected: {audio_path}")
        print("Select the API key file (.key).")
        key_path = filedialog.askopenfilename(
            title="Select AssemblyAI API Key File (.key)",
            filetypes=[("API Key files", "*.key"), ("All files", "*.*")],
        )

        if not key_path:
            print("No API key file selected. Exiting.")
            return

        print(f"API key file selected: {key_path}")
        api_key_from_file = None
        audio_data_bytesio = io.BytesIO()
        transcript_object: typing.Optional[aai.Transcript] = None

        with open(key_path) as f_key:
            api_key_from_file = f_key.readline().strip()
        if not api_key_from_file:
            print("API key file is empty or key is invalid.")
            return

        print("Reading audio file...")
        with open(audio_path, "rb") as f_audio:
            audio_data_bytesio.write(f_audio.read())

        transcript_object = mp3_to_transcript(audio_data_bytesio, api_key_from_file)

        if not transcript_object:
            print("Transcription failed. Exiting.")
            return

        print("Transcription successful.")

        print("\nSelect where to save the final transcript.")
        output_path = filedialog.asksaveasfilename(
            title="Save Transcript As",
            defaultextension=".json",
            filetypes=[("Text files", "*.json"), ("All files", "*.*")],
            initialfile=f"{os.path.splitext(os.path.basename(audio_path))[0]}_transcript.json",
        )

        if not output_path:
            print("No output file selected. Exiting.")
            return

        transcript_json = transcript_object.json_response

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(transcript_json, f, ensure_ascii=False, indent=4)

        print(f"Transcript successfully saved to: {output_path}")

    except Exception as e:
        print(f"Exception: {e}")

    print("\nScript finished.")


if __name__ == "__main__":
    main()
