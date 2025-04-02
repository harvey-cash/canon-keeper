import io
import os
import tkinter as tk
from tkinter import filedialog

import assemblyai as aai

# --- Helper Function to Format Transcript ---


def _format_transcript(transcript: aai.Transcript) -> str:
    """Formats the transcript with speaker labels."""
    if not transcript.utterances:
        return "No utterances found in the transcript."

    formatted_lines = []
    for utterance in transcript.utterances:
        speaker = utterance.speaker if utterance.speaker else "Unknown"
        formatted_lines.append(f"Speaker {speaker}:")
        formatted_lines.append(utterance.text)
        formatted_lines.append("")  # Add blank line between utterances

    return "\n".join(formatted_lines).strip()


# --- Transcription Function ---


def mp3_to_transcript(audio_data: io.BytesIO, api_key: str) -> str:
    """
    Transcribes MP3 audio data using AssemblyAI.

    Args:
        audio_data: An io.BytesIO object containing the MP3 audio.
        api_key: Your AssemblyAI API key.

    Returns:
        A formatted string transcript with speaker labels, or an error message.
    """
    if not api_key:
        return "Error: API key is missing."

    aai.settings.api_key = api_key
    config = aai.TranscriptionConfig(speaker_labels=True)
    transcriber = aai.Transcriber()

    print("Starting transcription process with AssemblyAI...")

    try:
        # Ensure the BytesIO stream is at the beginning
        audio_data.seek(0)
        # Transcribe using the file-like object
        transcript = transcriber.transcribe(audio_data, config)

    except Exception as e:
        print(f"Error during AssemblyAI transcription call: {e}")
        return f"Error during transcription API call: {e}"

    # Check transcription status
    if transcript.status == aai.TranscriptStatus.error:
        print(f"Transcription failed: {transcript.error}")
        return f"Transcription failed: {transcript.error}"

    # Print the structured API output (utterances) as requested
    print("\n--- AssemblyAI API Utterances Output ---")
    if transcript.utterances:
        # Print each utterance object for inspection
        # Note: This might be verbose for long transcripts
        for i, utterance in enumerate(transcript.utterances):
            print(f"Utterance {i}: {utterance}")
    else:
        print("No utterances returned by API.")
    print("--- End of API Utterances Output ---\n")

    # Format and return the transcript string
    formatted_text = _format_transcript(transcript)
    print("Transcription complete.")
    return formatted_text


# --- Main Execution Block ---

if __name__ == "__main__":
    # This code runs only when the script is executed directly

    # Initialize Tkinter and hide the root window
    root = tk.Tk()
    root.withdraw()

    print("Select the MP3 audio file to transcribe.")
    # Ask user for the MP3 audio file
    audio_path = filedialog.askopenfilename(
        title="Select MP3 Audio File",
        filetypes=[("MP3 audio files", "*.mp3"), ("All files", "*.*")],
    )

    if not audio_path:
        print("No audio file selected. Exiting.")
    else:
        print(f"Audio file selected: {audio_path}")
        print("Select the API key file (.key).")
        # Ask user for the API key file
        key_path = filedialog.askopenfilename(
            title="Select AssemblyAI API Key File (.key)",
            filetypes=[("API Key files", "*.key"), ("All files", "*.*")],
        )

        if not key_path:
            print("No API key file selected. Exiting.")
        else:
            print(f"API key file selected: {key_path}")
            api_key_from_file = None
            audio_data_bytesio = io.BytesIO()

            try:
                # Read the API key (first line of the file)
                with open(key_path) as f_key:
                    api_key_from_file = f_key.readline().strip()

                if not api_key_from_file:
                    raise ValueError("API key file is empty or key is invalid.")

                # Read the audio file into BytesIO
                with open(audio_path, "rb") as f_audio:
                    audio_data_bytesio.write(f_audio.read())
                audio_data_bytesio.seek(0)  # Rewind BytesIO for the function

                # Call the transcription function
                transcript_text = mp3_to_transcript(
                    audio_data_bytesio, api_key_from_file
                )

                # Check if transcription produced usable text
                if (
                    transcript_text
                    and not transcript_text.startswith("Error:")
                    and not transcript_text.startswith("Transcription failed:")
                ):
                    print(
                        "Transcription successful. Select where to save the transcript."
                    )
                    # Ask user where to save the transcript
                    output_path = filedialog.asksaveasfilename(
                        title="Save Transcript As",
                        defaultextension=".txt",
                        filetypes=[("Text files", "*.txt"), ("All files", "*.*")],
                        # Suggest a name based on the audio file
                        initialfile=f"{os.path.splitext(os.path.basename(audio_path))[0]}_transcript.txt",
                    )

                    if output_path:
                        try:
                            # Save the transcript text to the chosen file
                            with open(output_path, "w", encoding="utf-8") as f_out:
                                f_out.write(transcript_text)
                            print(f"Transcript successfully saved to: {output_path}")
                        except Exception as save_err:
                            print(f"Error saving transcript file: {save_err}")
                    else:
                        print("Save operation cancelled.")
                else:
                    # Print the error message returned by the function
                    print(transcript_text)

            except FileNotFoundError as fnf_err:
                print(f"Error: File not found - {fnf_err}")
            except ValueError as val_err:
                print(f"Error: {val_err}")
            except Exception as e:
                print(f"An unexpected error occurred: {e}")

    print("Script finished.")
