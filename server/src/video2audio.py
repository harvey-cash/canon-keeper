import io
import os
import shutil
import tempfile

import moviepy as mp

from . import file_io


def video_to_mp3(video_data: io.BytesIO) -> io.BytesIO | None:
    """
    Extracts audio from a video file object and returns it as an MP3 BytesIO object.

    Requires 'moviepy' library and FFmpeg. Handles temporary files internally.

    Args:
        video_file: A binary file-like object for the input video.

    Returns:
        An io.BytesIO object with MP3 data, or None if no audio exists.
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
            shutil.copyfileobj(video_data, temp_video)
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

    # Check if the conversion actually produced any audio data
    mp3_data.seek(0, io.SEEK_END)  # Go to the end to check size
    mp3_size = mp3_data.tell()
    mp3_data.seek(0)  # Rewind stream to the beginning

    if mp3_size <= 0:
        print("No audio data found in the video file.")
        return None

    print("Conversion successful")
    return mp3_data


def _main():
    try:
        file_io.prepare_file_dialogs()

        video_data, input_video_path = file_io.load_video()
        if not video_data:
            return

        audio_data = video_to_mp3(video_data)
        if not audio_data:
            return

        video_basename = os.path.basename(input_video_path)
        video_name_without_ext = os.path.splitext(video_basename)[0]
        default_mp3_name = f"{video_name_without_ext}.mp3"

        file_io.save_audio(audio_data, default_mp3_name)

    except Exception as e:
        print(f"{e}")


if __name__ == "__main__":
    _main()
