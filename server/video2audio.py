import io
import os
import shutil
import tempfile
import tkinter as tk
import typing
from tkinter import filedialog

import moviepy as mp


def video_to_mp3(video_file: typing.BinaryIO) -> io.BytesIO:
    """
    Extracts audio from a video file object and returns it as an MP3 BytesIO object.

    Requires 'moviepy' library and FFmpeg. Handles temporary files internally.

    Args:
        video_file: A binary file-like object for the input video.

    Returns:
        An io.BytesIO object with MP3 data, or empty if no audio exists.
    """
    temp_video_path = None
    temp_mp3_path = None
    mp3_data = io.BytesIO()
    try:
        # Create a temp file to store input video data for moviepy
        # Using a generic suffix as specific video type isn't known here
        with tempfile.NamedTemporaryFile(
            delete=False, suffix=".tmpvideo"
        ) as temp_video:
            shutil.copyfileobj(video_file, temp_video)
            temp_video_path = temp_video.name

        # Define path for the temporary MP3 output
        temp_dir = tempfile.gettempdir()
        temp_mp3_path = os.path.join(
            temp_dir, next(tempfile._get_candidate_names()) + ".mp3"
        )

        # Process video using moviepy
        clip = mp.VideoFileClip(temp_video_path)
        if clip.audio:
            # Write audio to temp MP3 file, suppressing console logs
            clip.audio.write_audiofile(temp_mp3_path, codec="mp3", logger=None)
            clip.audio.close()
        clip.close()

        # If MP3 was created, read it back into BytesIO object
        if os.path.exists(temp_mp3_path):
            with open(temp_mp3_path, "rb") as f_mp3:
                shutil.copyfileobj(f_mp3, mp3_data)
            mp3_data.seek(0)  # Reset stream position to the beginning
    finally:
        # Clean up temporary files, ignoring errors if files are locked
        if temp_video_path and os.path.exists(temp_video_path):
            try:
                os.remove(temp_video_path)
            except OSError:
                pass  # Ignore cleanup errors
        if temp_mp3_path and os.path.exists(temp_mp3_path):
            try:
                os.remove(temp_mp3_path)
            except OSError:
                pass  # Ignore cleanup errors
    return mp3_data


# --- Main Execution Block ---

if __name__ == "__main__":
    # This code runs only when the script is executed directly

    # Initialize Tkinter and hide the root window
    root = tk.Tk()
    root.withdraw()  # We only want the dialogs, not a full GUI window

    print("Opening file dialog to select video...")

    # Define allowed video file types for the 'Open' dialog
    video_file_types = [
        ("Video files", "*.mp4 *.avi *.mov *.mkv *.wmv *.flv"),
        ("All files", "*.*"),
    ]

    # Ask the user to select an input video file
    input_video_path = filedialog.askopenfilename(
        title="Select Video File to Convert", filetypes=video_file_types
    )

    # Proceed only if the user selected a file (didn't cancel)
    if input_video_path:
        print(f"Selected video: {input_video_path}")
        print("Starting conversion...")
        try:
            # Open the selected video file in binary read mode ('rb')
            # The 'with' statement ensures the file is closed automatically
            with open(input_video_path, "rb") as video_file_object:
                # Call the conversion function, passing the file object
                mp3_data_stream = video_to_mp3(video_file_object)  # Returns io.BytesIO

            # Check if the conversion actually produced any audio data
            mp3_data_stream.seek(0, io.SEEK_END)  # Go to the end to check size
            mp3_size = mp3_data_stream.tell()
            mp3_data_stream.seek(0)  # Rewind stream to the beginning

            if mp3_size > 0:
                print("Conversion successful. Opening file dialog to save MP3...")

                # Suggest a default filename for the MP3 based on the video name
                video_basename = os.path.basename(input_video_path)
                video_name_without_ext = os.path.splitext(video_basename)[0]
                default_mp3_name = f"{video_name_without_ext}.mp3"

                mp3_file_type = [("MP3 audio file", "*.mp3")]

                # Ask the user where to save the resulting MP3 file
                output_mp3_path = filedialog.asksaveasfilename(
                    title="Save MP3 Audio As",
                    initialfile=default_mp3_name,
                    defaultextension=".mp3",
                    filetypes=mp3_file_type,
                )

                # Proceed only if the user chose a save location (didn't cancel)
                if output_mp3_path:
                    try:
                        with open(output_mp3_path, "wb") as output_file:
                            shutil.copyfileobj(mp3_data_stream, output_file)
                        print(f"Successfully saved MP3 to: {output_mp3_path}")
                    except Exception as save_error:
                        print(f"Error saving MP3 file: {save_error}")
                else:
                    print("Save operation cancelled by user.")

            else:
                print("No audio data was found or extracted from the video.")

        except FileNotFoundError:
            print("Error: The selected video file was not found.")
        except Exception as conversion_error:
            print(
                f"An error occurred during the conversion process: {conversion_error}"
            )

    else:
        print("No video file was selected. Operation cancelled.")

    print("Script finished.")
