import io
import typing

import assemblyai as aai

from . import file_io
from .identify_speakers import identify_speakers


def _format_transcript_with_names(
    transcript: aai.Transcript, speaker_name_map: typing.Dict[str, str]
) -> str:
    """Formats the transcript, replacing speaker labels with names from the map."""
    if not transcript["utterances"]:
        return "No utterances found in the transcript."

    formatted_lines = []
    for utterance in transcript["utterances"]:
        original_label = utterance["speaker"] if utterance["speaker"] else "Unknown"
        # Use identified name if available, otherwise use original label
        display_speaker = speaker_name_map.get(
            original_label, f"Speaker {original_label}"
        )
        formatted_lines.append(f"{display_speaker}:")
        formatted_lines.append(utterance["text"])
        formatted_lines.append("")  # Add blank line between utterances

    return "\n".join(formatted_lines).strip()


# --- Main Execution Block ---


def main():
    try:
        file_io.prepare_file_dialogs()

        audio_data: io.BytesIO = file_io.load_audio()
        if not audio_data:
            return

        transcript = file_io.load_json("Select AssemblyAI Transcript JSON")
        if not transcript:
            return

        print("\n--- Starting Speaker Identification ---")
        speaker_map: dict = identify_speakers(audio_data, transcript["utterances"])
        print("--- Speaker Identification Finished ---")

        final_transcript_text = _format_transcript_with_names(transcript, speaker_map)

        file_io.save_file("Transcript", "txt", final_transcript_text)

    except Exception as e:
        print(f"Exception: {e}")


if __name__ == "__main__":
    main()
