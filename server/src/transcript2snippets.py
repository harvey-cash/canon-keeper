import io
import typing

from pydub import AudioSegment
from pydub import exceptions as pydub_exceptions

from . import file_io

MAX_SNIPPET_LEN_SECS = 5
WORDS_PER_SECOND = 3

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
    return max(utterances, key=lambda u: len(u["text"]), default=None)


def _extract_snippets(
    audio_data: io.BytesIO,
    longest_utterances: typing.Dict[str, typing.Any],
) -> typing.Dict[str, typing.Dict[str, typing.Any]]:
    """Extracts audio snippets for longest utterances and saves them."""
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

    speaker_snippets = {}

    print("Extracting and saving snippets...")
    for speaker, utterance in longest_utterances.items():
        start_ms = utterance["start"]
        end_ms = utterance["end"]

        if end_ms <= start_ms:
            print(f"{speaker}: invalid start/end times ({start_ms}-{end_ms}).")
            continue

        text = utterance["text"]

        if end_ms - start_ms > MAX_SNIPPET_LEN_SECS * 1000:
            print(f"Truncating snippet for Speaker {speaker} to {MAX_SNIPPET_LEN_SECS} seconds.")
            end_ms = start_ms + MAX_SNIPPET_LEN_SECS * 1000
            text_words = text.split(" ")
            max_words = MAX_SNIPPET_LEN_SECS * WORDS_PER_SECOND
            text = " ".join(text_words[:max_words])

        try:
            snippet = full_audio[start_ms:end_ms]
            buffer = io.BytesIO()
            snippet.export(buffer, format="mp3")
            buffer.seek(0)
            speaker_snippets[speaker] = {"text": text, "audio": buffer}

        except Exception as e:
            print(f"  Error exporting snippet for Speaker {speaker}: {e}")

    return speaker_snippets


# --- Main Function ---


def transcript_to_snippets(
    audio_data: io.BytesIO, utterances: typing.List[typing.Any]
) -> typing.Dict[str, typing.Dict[str, typing.Any]]:
    """
    Gets audio snippets for the longest utterances of each speaker in the transcript.

    Args:
        audio_data: An io.BytesIO object containing the full MP3 audio.
        utterances: A list of utterance objects/dictionaries from AssemblyAI,
                    each expected to have 'speaker', 'start', 'end', 'text'.

    Returns:
        A dictionary mapping speaker labels (e.g., 'A') to their longest utterance
        and the corresponding audio snippet.
    """
    print("Grouping utterances by speaker...")
    grouped_utterances = _group_utterances_by_speaker(utterances)
    if not grouped_utterances:
        print("No speaker utterances found in the transcript data.")
        return {}

    print("Finding longest utterances...")
    longest_utterances = {
        speaker: _find_longest_utterance(speaker_utterances)
        for speaker, speaker_utterances in grouped_utterances.items()
    }

    longest_utterances = {k: v for k, v in longest_utterances.items() if v is not None}

    if not longest_utterances:
        print("Could not determine longest utterances for any speaker.")
        return {}

    return _extract_snippets(audio_data, longest_utterances)


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

        print(speaker_snippets_dict)

        for speaker, speaker_dict in speaker_snippets_dict.items():
            file_io.save_audio(
                audio_data=speaker_dict["audio"],
                initial_file=f"speaker_{speaker}_snippet.mp3",
            )

    except Exception as e:
        print(f"Exception: {e}")


if __name__ == "__main__":
    _main()
