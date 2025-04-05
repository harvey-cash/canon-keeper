import os

from . import file_io
from .audio2transcript import audio_to_transcript
from .session2recap import recap_to_summary, session_to_recap
from .transcript2session import _prompt_for_speaker_names, transcript_to_session
from .transcript2snippets import transcript_to_snippets
from .video2audio import video_to_mp3


def _main():
    try:
        file_io.prepare_file_dialogs()

        video_data, video_path = file_io.load_video()
        if not video_data:
            return

        video_name_with_ext = os.path.basename(video_path)
        video_name = os.path.splitext(video_name_with_ext)[0]

        transcript_api_key = file_io.load_key("Select AssemblyAI API Key...")
        if not transcript_api_key:
            return

        llm_api_key = file_io.load_key("Select Google Gemini API Key...")
        if not llm_api_key:
            return

        recap_prompt = file_io.load_text_file("Select Recap Prompt File...")
        if not recap_prompt:
            return

        summary_prompt = file_io.load_text_file("Select Summary Prompt File...")
        if not summary_prompt:
            return

        save_dir_path = file_io.get_save_directory("Select Save Directory...")
        if not save_dir_path:
            return

        print("Selections complete. Extracting audio from video...")

        audio_data = video_to_mp3(video_data)
        if not audio_data:
            return

        print("Audio extraction complete. Starting transcription process...")

        transcript = audio_to_transcript(audio_data, transcript_api_key)
        if not transcript:
            return

        transcript_path = file_io.write_file(
            file_path=f"{save_dir_path}/{video_name}_transcript.json", data=transcript
        )

        print(f"Transcription complete. Raw JSON saved to {transcript_path}.")

        print("Generating speaker snippets...")
        speaker_snippets_dict = transcript_to_snippets(
            audio_data, transcript["utterances"]
        )
        if not speaker_snippets_dict:
            return

        speaker_files = {}
        for speaker, speaker_dict in speaker_snippets_dict.items():
            file_name = file_io.save_audio(
                audio_data=speaker_dict["audio"],
                initial_file=f"speaker_{speaker}_snippet.mp3",
            )
            if file_name:
                speaker_files[speaker] = file_name

        speaker_name_map = _prompt_for_speaker_names(speaker_files)
        if not speaker_name_map:
            return

        print("Generating session script...")
        session_script = transcript_to_session(transcript, speaker_name_map)
        if not session_script:
            return

        session_path = file_io.write_file(
            file_path=f"{save_dir_path}/{video_name}_session_script.txt",
            data=session_script,
        )

        print(f"Session script saved to {session_path}.")
        print("Generating recap...")

        recap = session_to_recap(session_script, llm_api_key, recap_prompt)
        if not recap:
            return

        recap_path = file_io.write_file(
            file_path=f"{save_dir_path}/{video_name}_recap.txt", data=recap
        )

        print(f"Recap saved to {recap_path}.")
        print("Generating summary...")

        summary = recap_to_summary(recap, llm_api_key, summary_prompt)
        if not summary:
            return

        summary_path = file_io.write_file(
            file_path=f"{save_dir_path}/{video_name}_summary.txt", data=summary
        )

        print(f"Summary saved to {summary_path}.")
        print("All tasks completed successfully.")

    except Exception as e:
        print(f"Exception: {e}")


if __name__ == "__main__":
    _main()
