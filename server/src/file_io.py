import io
import json
import tkinter as tk
import typing
from tkinter import filedialog


def prepare_file_dialogs():
    """Initializes the Tkinter root window for file dialogs."""
    root = tk.Tk()
    root.withdraw()  # Hide the root window


def load_text_file(message: str = "Select a text file.") -> str | None:
    """Loads a text file and returns its content as a string."""
    print(message)
    text_path = filedialog.askopenfilename(
        title=message,
        filetypes=[("Text files", "*.txt"), ("All files", "*.*")],
    )
    if not text_path:
        print("No text file selected.")
        return None

    print(f"Text file selected: {text_path}. Reading file...")
    try:
        with open(text_path, encoding="utf-8") as f:
            data = f.read()
        return data
    except Exception as e:
        print(f"Error reading text file: {e}")
        return None


def load_key(message: str = "Select an API key file.") -> str | None:
    """Loads the API key from a file."""
    print(message)
    api_key_path = filedialog.askopenfilename(
        title="Select API Key File",
        filetypes=[("Key files", "*.key"), ("All files", "*.*")],
    )
    if not api_key_path:
        print("No API key file selected.")
        return None

    print(f"API key file selected: {api_key_path}. Reading file...")
    try:
        with open(api_key_path) as f:
            api_key = f.read().strip()
        return api_key
    except Exception as e:
        print(f"Error reading API key file: {e}")
        return None


def load_audio() -> io.BytesIO | None:
    print("Select an MP3 audio file.")
    audio_path = filedialog.askopenfilename(
        title="Select MP3 Audio File",
        filetypes=[("MP3 audio files", "*.mp3"), ("All files", "*.*")],
    )
    if not audio_path:
        print("No audio file selected.")
        return None

    print(f"Audio file selected: {audio_path}. Reading file...")
    return read_audio_file(audio_path)


def read_audio_file(audio_path: str) -> io.BytesIO | None:
    """Reads the audio file from the given path into a BytesIO object."""
    try:
        with open(audio_path, "rb") as f_audio:
            audio_data_bytesio = io.BytesIO(f_audio.read())
        return audio_data_bytesio
    except Exception as e:
        print(f"Error reading audio file: {e}")
        return None


def get_save_directory(file_kind: str) -> str | None:
    """Prompts user to select a directory using tkinter."""
    print(f"Select directory to save {file_kind}...")
    directory = filedialog.askdirectory(title="Select Directory for Speaker Snippets")

    if directory:
        print(f"{file_kind} will be saved in: {directory}")
        return directory
    else:
        print("Directory selection cancelled.")
        return None


def save_file(
    file_kind: str,
    extension: str,
    data: str | dict,
    initial_file: str = "output",
) -> str | None:
    """Opens a save dialog and returns the selected file path."""
    print(f"Select where to save the {file_kind}.")

    save_path = filedialog.asksaveasfilename(
        title=f"Save {file_kind} As",
        defaultextension=f".{extension}",
        initialfile=f"{initial_file}.{extension}",
        filetypes=[(f"{extension} files", f"*.{extension}"), ("All files", "*.*")],
    )

    if not save_path:
        print("No save location selected.")
        return None

    return write_file(save_path, data, mode="w", encoding="utf-8")


def write_file(
    file_path: str,
    data: str | dict,
    mode: str = "w",
    encoding: str = "utf-8",
    indent: int = 4,
) -> str | None:
    """Writes content to a file. If data is a dict, it will be saved as JSON."""
    try:
        if isinstance(data, dict):
            with open(file_path, "w", encoding=encoding) as f:
                json.dump(data, f, ensure_ascii=False, indent=indent)
        else:
            with open(file_path, mode, encoding=encoding) as f:
                f.write(data)
        print(f"File successfully saved to: {file_path}")
        return file_path
    except Exception as e:
        print(f"Error saving file: {e}")
        return None


def load_json(message: str = "Select a JSON file.") -> dict | None:
    """Loads a JSON file and returns its content as a dictionary."""
    print(message)
    json_path = filedialog.askopenfilename(
        title="Select JSON File",
        filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
    )
    if not json_path:
        print("No JSON file selected.")
        return None

    print(f"JSON file selected: {json_path}. Reading file...")
    try:
        with open(json_path, encoding="utf-8") as f:
            data = json.load(f)
        return data
    except Exception as e:
        print(f"Error reading JSON file: {e}")
        return None


def sanitize_filename(label: str) -> str:
    """Creates a safe filename from a speaker label."""
    return "".join(x if x.isalnum() else "_" for x in label)


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
