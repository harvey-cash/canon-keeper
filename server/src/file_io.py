import io
import json
import os
import tkinter as tk
import typing
from tkinter import filedialog

from pydub import AudioSegment


def read_audio_file(audio_path: str) -> io.BytesIO:
    """Reads the audio file from the given path into a BytesIO object."""
    try:
        with open(audio_path, "rb") as f_audio:
            audio_data_bytesio = io.BytesIO(f_audio.read())
        return audio_data_bytesio
    except Exception as e:
        print(f"Error reading audio file: {e}")
        return None


def get_file_path_from_dialog(title: str, filetypes: list) -> str:
    """Opens a file dialog and returns the selected file path."""
    root = tk.Tk()
    root.withdraw()
    file_path = filedialog.askopenfilename(title=title, filetypes=filetypes)
    root.destroy()
    return file_path


def load_audio(audio_data: io.BytesIO) -> AudioSegment:
    """Loads the audio data from a BytesIO object using pydub."""
    try:
        audio_data.seek(0)
        audio = AudioSegment.from_file(audio_data)
        return audio
    except Exception as e:
        print(f"Error loading audio with pydub: {e}")
        return None


def sanitize_filename(label: str) -> str:
    """Creates a safe filename from a speaker label."""
    return "".join(x if x.isalnum() else "_" for x in label)


def create_temporary_file(suffix: str) -> io.BytesIO:
    """Creates a temporary file with the given suffix and returns it."""
    try:
        return io.BytesIO()
    except Exception as e:
        print(f"Error creating temporary file: {e}")
        return None


def cleanup_temporary_file(file_path: str):
    """Removes a temporary file, handling potential errors."""
    try:
        os.remove(file_path)
        print(f"Temporary file removed: {file_path}")
    except Exception as e:
        print(f"Error removing temporary file: {e}")


def copy_stream(input_stream: typing.BinaryIO, output_stream: typing.BinaryIO):
    """Copies data from one stream to another."""
    try:
        input_stream.seek(0)
        while True:
            chunk = input_stream.read(4096)
            if not chunk:
                break
            output_stream.write(chunk)
        output_stream.seek(0)
    except Exception as e:
        print(f"Error copying stream: {e}")


def copy_file_to_stream(input_file: typing.BinaryIO, output_stream: io.BytesIO):
    """Copies the content of a file to a stream."""
    copy_stream(input_file, output_stream)


def copy_stream_to_file(input_stream: io.BytesIO, output_file: typing.BinaryIO):
    """Copies the content of a stream to a file."""
    copy_stream(input_stream, output_file)


def read_file(file_path: str, mode: str = "r", encoding: str = "utf-8") -> str | dict | None:
    """Reads content from a file."""
    try:
        if mode == "json":
            with open(file_path, "r", encoding=encoding) as f:
                return json.load(f)
        else:
            with open(file_path, mode, encoding=encoding) as f:
                return f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        return None


def write_file(file_path: str, data: str | dict, mode: str = "w", encoding: str = "utf-8", indent: int = 4):
    """Writes content to a file. If data is a dict, it will be saved as JSON."""
    try:
        if isinstance(data, dict):
            with open(file_path, "w", encoding=encoding) as f:
                json.dump(data, f, ensure_ascii=False, indent=indent)
        else:
            with open(file_path, mode, encoding=encoding) as f:
                f.write(data)
        print(f"File successfully saved to: {file_path}")
    except Exception as e:
        print(f"Error saving file: {e}")
