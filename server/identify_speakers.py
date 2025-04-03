import io
import os
import tkinter as tk
import typing
from tkinter import filedialog

from pydub import AudioSegment
from pydub import exceptions as pydub_exceptions

# --- Helper Functions ---


def _get_save_directory() -> typing.Optional[str]:
    """Prompts user to select a directory using tkinter."""
    print("Select directory to save speaker audio snippets...")
    root = tk.Tk()
    root.withdraw()  # Hide the main tkinter window
    directory = filedialog.askdirectory(title="Select Directory for Speaker Snippets")
    root.destroy()  # Clean up the hidden window
    if directory:
        print(f"Snippets will be saved in: {directory}")
        return directory
    else:
        print("Directory selection cancelled.")
        return None


def _group_utterances_by_speaker(
    utterances: typing.List[typing.Dict[str, typing.Any]],
) -> typing.Dict[str, typing.List[typing.Any]]:
    """Groups utterances by speaker label."""
    grouped = {}
    for utterance in utterances:
        speaker = utterance["speaker"]
        if speaker not in grouped:
            grouped[speaker] = []
        grouped[speaker].append(
            {
                "text": utterance["text"],
                "start": utterance["start"],
                "end": utterance["end"],
            }
        )
    return grouped


def _find_longest_utterance(
    utterances: typing.List[typing.Any],
) -> typing.Optional[typing.Any]:
    """Finds the utterance with the longest text in a list."""
    if not utterances:
        return None
    # Find utterance with max text length, default to None if list is empty
    return max(utterances, key=lambda u: len(getattr(u, "text", "")), default=None)


def _extract_and_save_snippets(
    audio_data: io.BytesIO,
    longest_utterances: typing.Dict[str, typing.Any],
    save_dir: str,
) -> typing.Dict[str, str]:
    """Extracts audio snippets for longest utterances and saves them."""
    speaker_files = {}
    print("Loading full audio for slicing...")
    try:
        audio_data.seek(0)  # Ensure stream is at the beginning
        # Load audio, explicitly stating format if needed (pydub often infers)
        full_audio = AudioSegment.from_file(audio_data, format="mp3")
    except pydub_exceptions.CouldntDecodeError:
        print("Error: Could not decode audio file. Is it a valid MP3?")
        return {}
    except FileNotFoundError:
        # This might indicate ffmpeg/ffprobe is not installed or not in PATH
        print(
            "Error: Could not process audio. Is FFmpeg/FFprobe installed and in PATH?"
        )
        return {}
    except Exception as e:
        print(f"Error loading audio with pydub: {e}")
        return {}

    print("Extracting and saving snippets...")
    for speaker, utterance in longest_utterances.items():
        start_ms = utterance["start"]
        end_ms = utterance["end"]
        text_preview = utterance["text"][:30]  # First 30 chars

        if end_ms <= start_ms:
            print(f"{speaker}: invalid start/end times ({start_ms}-{end_ms}).")
            continue

        try:
            snippet = full_audio[start_ms:end_ms]

            # Sanitize speaker label
            safe_speaker_label = "".join(
                c if c.isalnum() else "_" for c in str(speaker)
            )

            filename = os.path.join(
                save_dir,
                f"speaker_{safe_speaker_label}_utterance_{start_ms}-{end_ms}.mp3",
            )
            print(f"Saving snippet for {speaker} ({text_preview}...)")
            snippet.export(filename, format="mp3")
            speaker_files[speaker] = filename
        except Exception as e:
            print(f"  Error exporting snippet for Speaker {speaker}: {e}")

    return speaker_files


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
                # Prompt user for the name
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


# --- Main Function ---


def identify_speakers(
    audio_data: io.BytesIO, utterances: typing.List[typing.Any]
) -> typing.Dict[str, str]:
    """
    Identifies speakers by extracting longest utterances, saving snippets,
    and prompting the user for names.

    Args:
        audio_data: An io.BytesIO object containing the full MP3 audio.
        utterances: A list of utterance objects/dictionaries from AssemblyAI,
                    each expected to have 'speaker', 'start', 'end', 'text'.

    Returns:
        A dictionary mapping speaker labels (e.g., 'A') to user-provided names.
    """
    save_dir = _get_save_directory()
    if not save_dir:
        return {}  # User cancelled

    grouped_utterances = _group_utterances_by_speaker(utterances)
    if not grouped_utterances:
        print("No speaker utterances found in the transcript data.")
        return {}

    longest_utterances = {
        speaker: _find_longest_utterance(speaker_utterances)
        for speaker, speaker_utterances in grouped_utterances.items()
    }

    longest_utterances = {k: v for k, v in longest_utterances.items() if v is not None}

    if not longest_utterances:
        print("Could not determine longest utterances for any speaker.")
        return {}

    speaker_snippet_files = _extract_and_save_snippets(
        audio_data, longest_utterances, save_dir
    )

    if not speaker_snippet_files:
        print("Failed to create any speaker audio snippets.")
        return {}

    speaker_name_map = _prompt_for_speaker_names(speaker_snippet_files)

    print("\n--- Speaker Identification Summary ---")
    if speaker_name_map:
        for label, name in speaker_name_map.items():
            print(f"  Speaker {label} identified as: {name}")
    else:
        print("  No speakers were identified.")
    print("------------------------------------")

    return speaker_name_map
