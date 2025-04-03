import io
import json
import os
import tempfile
import unittest
from unittest.mock import patch, mock_open

from pydub import AudioSegment

from src.file_io import (
    read_audio_file,
    get_file_path_from_dialog,
    load_audio,
    sanitize_filename,
    create_temporary_file,
    cleanup_temporary_file,
    copy_stream,
    copy_file_to_stream,
    copy_stream_to_file,
    read_file,
    write_file,
)


class TestFileIO(unittest.TestCase):
    @patch("src.file_io.open", new_callable=mock_open, read_data=b"test audio data")
    def test_read_audio_file_success(self, mock_file):
        audio_data = read_audio_file("dummy_path")
        self.assertIsInstance(audio_data, io.BytesIO)
        self.assertEqual(audio_data.getvalue(), b"test audio data")

    @patch("src.file_io.open", side_effect=FileNotFoundError)
    def test_read_audio_file_failure(self, mock_file):
        audio_data = read_audio_file("dummy_path")
        self.assertIsNone(audio_data)

    @patch("src.file_io.filedialog.askopenfilename", return_value="/path/to/file")
    @patch("src.file_io.tk.Tk")
    def test_get_file_path_from_dialog(self, mock_tk, mock_askopenfilename):
        file_path = get_file_path_from_dialog(title="Test", filetypes=[("Test Files", "*.test")])
        self.assertEqual(file_path, "/path/to/file")
        mock_tk.return_value.withdraw.assert_called_once()
        mock_askopenfilename.assert_called_once_with(title="Test", filetypes=[("Test Files", "*.test")])
        mock_tk.return_value.destroy.assert_called_once()

    def test_load_audio_success(self):
        audio_data = io.BytesIO(b"test audio data")
        with patch("src.file_io.AudioSegment.from_file", return_value=AudioSegment.empty()):
            audio = load_audio(audio_data)
            self.assertIsInstance(audio, AudioSegment)

    def test_load_audio_failure(self):
        audio_data = io.BytesIO(b"test audio data")
        with patch("src.file_io.AudioSegment.from_file", side_effect=Exception("Failed to load")):
            audio = load_audio(audio_data)
            self.assertIsNone(audio)

    def test_sanitize_filename(self):
        self.assertEqual(sanitize_filename("My File!@#$%^&*()_+"), "My_File____________")

    def test_create_temporary_file(self):
        temp_file = create_temporary_file(".txt")
        self.assertIsInstance(temp_file, io.BytesIO)

    def test_cleanup_temporary_file_success(self):
        with tempfile.NamedTemporaryFile(delete=False) as tmp_file:
            temp_file_path = tmp_file.name
        with patch("src.file_io.os.remove") as mock_remove:
            cleanup_temporary_file(temp_file_path)
            mock_remove.assert_called_once_with(temp_file_path)

    def test_cleanup_temporary_file_failure(self):
        with patch("src.file_io.os.remove", side_effect=OSError("Failed to remove")):
            cleanup_temporary_file("dummy_path")

    def test_copy_stream_success(self):
        input_stream = io.BytesIO(b"test data")
        output_stream = io.BytesIO()
        copy_stream(input_stream, output_stream)
        self.assertEqual(output_stream.getvalue(), b"test data")

    def test_copy_stream_failure(self):
        input_stream = io.BytesIO(b"test data")
        output_stream = io.BytesIO()
        with patch.object(input_stream, "read", side_effect=Exception("Read error")):
            copy_stream(input_stream, output_stream)

    def test_copy_file_to_stream(self):
        input_file = io.BytesIO(b"test data")
        output_stream = io.BytesIO()
        copy_file_to_stream(input_file, output_stream)
        self.assertEqual(output_stream.getvalue(), b"test data")

    def test_copy_stream_to_file(self):
        input_stream = io.BytesIO(b"test data")
        output_file = io.BytesIO()
        copy_stream_to_file(input_stream, output_file)
        self.assertEqual(output_file.getvalue(), b"test data")

    @patch("src.file_io.open", new_callable=mock_open, read_data='{"key": "value"}')
    def test_read_file_json_success(self, mock_file):
        data = read_file("dummy_path", mode="json")
        self.assertEqual(data, {"key": "value"})

    @patch("src.file_io.open", new_callable=mock_open, read_data="test data")
    def test_read_file_text_success(self, mock_file):
        data = read_file("dummy_path", mode="r")
        self.assertEqual(data, "test data")

    @patch("src.file_io.open", side_effect=FileNotFoundError)
    def test_read_file_failure(self, mock_file):
        data = read_file("dummy_path")
        self.assertIsNone(data)

    @patch("src.file_io.open", new_callable=mock_open)
    def test_write_file_text_success(self, mock_file):
        write_file("dummy_path", "test data", mode="w")
        mock_file.assert_called_once_with("dummy_path", "w", encoding="utf-8")
        mock_file.return_value.write.assert_called_once_with("test data")

    @patch("src.file_io.open", side_effect=Exception("Write error"))
    def test_write_file_failure(self, mock_file):
        write_file("dummy_path", "test data", mode="w")


if __name__ == "__main__":
    unittest.main()