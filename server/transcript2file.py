import io
import json
import os
import tkinter as tk
import typing
from tkinter import filedialog

import assemblyai as aai

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

    audio_data_bytesio = io.BytesIO()
    print("Reading audio file...")
    with open(audio_path, "rb") as f_audio:
        audio_data_bytesio.write(f_audio.read())

    print("Select the transcript JSON to use for speaker identification.")
    transcript_path = filedialog.askopenfilename(
        title="Select Transcript JSON File",
        filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
    )

    if not transcript_path:
        print("No transcript file selected. Exiting.")
        return

    transcript = None
    try:
        with open(transcript_path, encoding="utf-8") as f_transcript:
            transcript = json.load(f_transcript)
    except Exception as e:
        print(f"Error reading transcript file: {e}")
        return

    speaker_map = {}  # Initialize empty map

    print("\n--- Starting Speaker Identification ---")
    # Rewind audio data before passing to identify_speakers
    audio_data_bytesio.seek(0)
    speaker_map = identify_speakers(audio_data_bytesio, transcript["utterances"])
    print("--- Speaker Identification Finished ---")

    # --- Format transcript using identified names (or labels) ---
    final_transcript_text = _format_transcript_with_names(transcript, speaker_map)

    # --- Save the final transcript ---
    print("\nSelect where to save the final transcript.")
    output_path = filedialog.asksaveasfilename(
        title="Save Final Transcript As",
        defaultextension=".txt",
        filetypes=[("Text files", "*.txt"), ("All files", "*.*")],
        initialfile=f"{os.path.splitext(os.path.basename(audio_path))[0]}_transcript_named.txt",
    )

    if not output_path:
        print("No save location selected. Exiting.")
        return

    try:
        with open(output_path, "w", encoding="utf-8") as f_out:
            f_out.write(final_transcript_text)
        print(f"Final transcript successfully saved to: {output_path}")
    except Exception as save_err:
        print(f"Error saving final transcript file: {save_err}")


if __name__ == "__main__":
    main()
