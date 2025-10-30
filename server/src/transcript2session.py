import io
import os
import typing

import assemblyai as aai

from . import file_io
from .transcript2snippets import transcript_to_snippets


def transcript_to_session(
    transcript: aai.Transcript, speaker_name_map: typing.Dict[str, str]
) -> str:
    """Formats the transcript, replacing speaker labels with names from the map."""
    if not transcript["utterances"]:
        return "No utterances found in the transcript."
    
    has_multiple_speakers = not (speaker_name_map is None or not speaker_name_map)

    formatted_lines = []
    for utterance in transcript["utterances"]:
        original_label = utterance["speaker"] if utterance["speaker"] else "Unknown"
        # Use identified name if available, otherwise use original label
        display_speaker = speaker_name_map.get(original_label, f"Speaker {original_label}")

        if has_multiple_speakers:
            formatted_lines.append(f"{display_speaker}:")
        
        formatted_lines.append(utterance["text"])
        formatted_lines.append("")  # Add blank line between utterances

    return "\n".join(formatted_lines).strip()


def _prompt_for_speaker_names(
    speaker_files: typing.Dict[str, str],
) -> typing.Dict[str, str]:
    """Prompts user to identify speakers based on saved snippets."""
    speaker_name_map = {}
    print("\nPlease listen to the saved audio snippets to identify speakers.")

    for speaker, filename in speaker_files.items():
        print(f"\nSnippet for Speaker {speaker} saved as: {os.path.basename(filename)}")
        while True:
            try:
                name = input(f"Enter the name for Speaker {speaker}: ").strip()
                if name:  # Ensure some name is entered
                    speaker_name_map[speaker] = name
                    break
                else:
                    print("Please enter a name.")

            except EOFError:
                print("\nInput interrupted. Exiting identification.")
                return speaker_name_map
            except KeyboardInterrupt:
                print("\nIdentification cancelled by user.")
                return speaker_name_map

    # Delete the audio snippets after use
    for filename in speaker_files.values():
        try:
            os.remove(filename)
            print(f"Deleted snippet file: {filename}")
        except Exception as e:
            print(f"Error deleting snippet file {filename}: {e}")

    return speaker_name_map


def _main():
    try:
        file_io.prepare_file_dialogs()

        audio_data: io.BytesIO = file_io.load_audio()
        if not audio_data:
            return

        transcript = file_io.load_json("Select AssemblyAI Transcript JSON")
        if not transcript:
            return

        speaker_snippets_dict = transcript_to_snippets(
            audio_data, transcript["utterances"]
        )
        if not speaker_snippets_dict:
            return

        speaker_files = {}
        for speaker, speaker_dict in speaker_snippets_dict.items():
            file_name = file_io.save_audio(
                audio_data=speaker_dict["audio"],
                initial_file=f"speaker_{speaker}_snippet.mp3",
            )
            if file_name:
                speaker_files[speaker] = file_name

        speaker_name_map = _prompt_for_speaker_names(speaker_files)
        if not speaker_name_map:
            return

        final_transcript_text = transcript_to_session(transcript, speaker_name_map)

        file_io.save_file("Transcript", "txt", final_transcript_text)

    except Exception as e:
        print(f"Exception: {e}")


if __name__ == "__main__":
    _main()
