import io
import typing

import assemblyai as aai

from . import file_io


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
        file_io.prepare_file_dialogs()

        audio_data: io.BytesIO = file_io.load_audio()
        if not audio_data:
            return

        api_key = file_io.load_key("Select AssemblyAI API Key")
        if not api_key:
            return

        transcript_object: aai.Transcript | None = mp3_to_transcript(
            audio_data, api_key
        )
        if not transcript_object:
            return

        transcript_dict = transcript_object.json_response

        file_io.save_file("Transcript", "json", transcript_dict)

    except Exception as e:
        print(f"Exception: {e}")

    print("\nScript finished.")


if __name__ == "__main__":
    main()
