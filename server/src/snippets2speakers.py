#!/usr/bin/env python3

"""
snippets2speakers.py

A command-line tool to identify and name speakers from audio snippets.

This script takes the output from 'transcript2snippets.py':
1.  A JSON file mapping speaker labels to their longest text utterance.
    (Assumed format: {"A": {"text": "..."}, "B": {"text": "..."}})
2.  A directory containing the corresponding audio snippets, named
    (e.g., "speaker_A_snippet.mp3", "speaker_B_snippet.mp3").

It iterates through each speaker, plays their audio snippet, and prompts
the user to assign a human-readable name. Finally, it prints a JSON
dictionary mapping the original speaker labels to the new names.

This script can also be imported, and its logic called via the
`snippets_to_speakers` function.

Requires the 'playsound' library:
    pip install playsound

Usage:
    python snippets2speakers.py path/to/snippets.json path/to/audio_directory
"""

import argparse
import json
import os
import sys
import typing

try:
    from playsound import playsound
    from playsound import PlaysoundException
except ImportError:
    print(
        "Error: The 'playsound' library is required. Please install it:",
        file=sys.stderr,
    )
    print("    pip install playsound", file=sys.stderr)
    sys.exit(1)


def _load_snippet_data(json_path: str) -> typing.Optional[dict]:
    """Loads the speaker-to-text mapping from the input JSON file."""
    if not os.path.exists(json_path):
        print(f"Error: JSON file not found at: {json_path}", file=sys.stderr)
        return None

    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data
    except json.JSONDecodeError:
        print(f"Error: Could not decode JSON from: {json_path}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"Error reading JSON file: {e}", file=sys.stderr)
        return None


def _play_audio(audio_path: str) -> bool:
    """Plays the specified audio file."""
    if not os.path.exists(audio_path):
        print(f"Error: Audio file not found at: {audio_path}", file=sys.stderr)
        return False

    print("Playing audio...")
    try:
        playsound(audio_path)
        return True
    except PlaysoundException as e:
        print(f"Error playing audio: {e}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"An unexpected error occurred during playback: {e}", file=sys.stderr)
        return False


def _get_user_choice() -> str:
    """Gets the user's next action (Play, Name, Quit)."""
    while True:
        print("\nChoose an action:")
        choice = (
            input("  [P]lay again, [N]ame speaker, [Q]uit program: ")
            .lower()
            .strip()
        )
        if choice and choice[0] in ("p", "n", "q"):
            return choice[0]
        print("Invalid choice. Please enter 'P', 'N', or 'Q'.")


def _get_speaker_name() -> str:
    """Prompts the user to enter a name for the speaker."""
    while True:
        name = input("Enter name for this speaker: ").strip()
        if name:
            return name
        print("Name cannot be empty. Please enter a name.")


def _process_speaker(
    speaker_label: str, utterance_text: str, audio_path: str
) -> typing.Optional[str]:
    """
    Handles the UI loop for a single speaker.
    Returns the chosen name, or None if the user quits.
    """
    print("\n" + "=" * 50)
    print(f"Identifying Speaker: {speaker_label}")
    print("=" * 50)
    print(f'Longest Utterance: "{utterance_text}"')

    _play_audio(audio_path)

    while True:
        choice = _get_user_choice()

        if choice == "p":
            _play_audio(audio_path)
        elif choice == "n":
            return _get_speaker_name()
        elif choice == "q":
            return None


def _parse_arguments() -> argparse.Namespace:
    """Configures and parses command-line arguments."""
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "json_file",
        type=str,
        help="Path to the JSON file containing speaker utterances (e.g., 'snippets.json').",
    )
    parser.add_argument(
        "snippets_dir",
        type=str,
        help="Path to the directory containing the speaker audio snippets (e.g., 'audio_snippets/').",
    )
    return parser.parse_args()


def snippets_to_speakers(json_file_path: str, snippets_dir_path: str) -> dict:
    """
    Interactively prompts user to name speakers based on audio snippets.

    Args:
        json_file_path: Path to the JSON file containing speaker utterances.
        snippets_dir_path: Path to the directory containing audio snippets.

    Returns:
        A dictionary mapping speaker labels (e.g., 'A') to user-provided names.
    """
    snippet_data = _load_snippet_data(json_file_path)
    if not snippet_data:
        return {}  # Return empty map on load error

    speaker_map = {}
    print(
        f"Found {len(snippet_data)} speakers to identify. Press Ctrl+C to exit early."
    )

    try:
        for speaker_label, text in snippet_data.items():
            if not text:
                print(
                    f"Warning: No 'text' found for speaker {speaker_label}. Skipping."
                )
                continue

            # Construct the expected audio filename
            audio_filename = f"speaker_{speaker_label}_snippet.mp3"
            audio_path = os.path.join(snippets_dir_path, audio_filename)

            name = _process_speaker(speaker_label, text, audio_path)

            if name is None:
                print("\nQuitting identification process.")
                break  # Break loop, will return partial map

            print(f"Speaker {speaker_label} identified as: {name}")
            speaker_map[speaker_label] = name

    except KeyboardInterrupt:
        print("\nProcess interrupted by user.")
        # Will proceed to return the partial map
    except Exception as e:
        print(f"\nAn unexpected error occurred: {e}", file=sys.stderr)
        # Will proceed to return the partial map (likely empty)

    return speaker_map


def main():
    """Main execution flow for command-line execution."""
    args = _parse_arguments()

    speaker_map = snippets_to_speakers(args.json_file, args.snippets_dir)

    # This 'finally' logic is now part of the CLI execution
    print("\n" + "=" * 50)
    print("Final Speaker Map")
    print("=" * 50)
    if not speaker_map:
        print("No speakers were named.")
    else:
        print(json.dumps(speaker_map, indent=2))
    print("=" * 50)


if __name__ == "__main__":
    main()

