import io

import assemblyai as aai

from . import file_io


def audio_to_transcript(audio_data: io.BytesIO, api_key: str) -> dict | None:
    """
    Transcribes MP3 audio data using AssemblyAI.

    Args:
        audio_data: An io.BytesIO object containing the MP3 audio.
        api_key: Your AssemblyAI API key.

    Returns:
        The AssemblyAI Transcript object on success, None on failure.
    """
    if api_key == "mock":
        print("Mocking AssemblyAI API call for testing.")
        return { "utterances": [ {
            "text": "This is a short audio file. Its only purpose is to test the transcription function.",
            "start": 480,
            "end": 6140,
            "confidence": 0.93380934,
            "speaker": "A",
        }] }

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
    return transcript.json_response


def main():
    try:
        file_io.prepare_file_dialogs()

        audio_data: io.BytesIO = file_io.load_audio()
        if not audio_data:
            return

        api_key = file_io.load_key("Select AssemblyAI API Key")
        if not api_key:
            return

        transcript = audio_to_transcript(audio_data, api_key)
        if not transcript:
            return

        file_io.save_file("Transcript", "json", transcript)

    except Exception as e:
        print(f"Exception: {e}")

    print("\nScript finished.")


if __name__ == "__main__":
    main()
