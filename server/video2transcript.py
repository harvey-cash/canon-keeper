import dotenv
import os
import argparse
import json

from src.file_io import prepare_file_dialogs, read_video_file, save_audio
from src.video2audio import video_to_mp3
from src.audio2transcript import audio_to_transcript
from src.transcript2snippets import transcript_to_snippets
from src.snippets2speakers import snippets_to_speakers
from src.transcript2session import transcript_to_session

def video_to_transcript(file_path):
    print(f"Processing video file: {file_path}")
    dir_name = os.path.dirname(file_path)

    try:
        video_data = read_video_file(file_path)

        audio_data = video_to_mp3(video_data)
        if not audio_data:
            print("Failed to extract audio from video.")
            return None

        transcript = audio_to_transcript(audio_data, os.getenv("ASSEMBLY_AI_API_KEY"))
        if not transcript:
            print("Failed to transcribe audio.")
            return None
        
        snippets = transcript_to_snippets(audio_data, transcript.get("utterances"))
        if not snippets:
            print("Failed to extract snippets from transcript.")
            return None
        
        print(snippets)

        json.dump(transcript, open(os.path.join(dir_name, "transcript.json"), "w"), indent=4)

        snippets_file_path = os.path.join(dir_name, "snippets.json")
        label_text_map = {speaker: data["text"] for speaker, data in snippets.items()}
        json.dump(label_text_map, open(snippets_file_path, "w"), indent=4)

        for speaker, speaker_dict in snippets.items():
            save_audio(
                audio_data=speaker_dict["audio"],
                initial_file=os.path.join(dir_name, f"speaker_{speaker}_snippet.mp3"),
            )
        
        speaker_map = snippets_to_speakers(snippets_file_path, dir_name)
        print(speaker_map)

        session_transcript = transcript_to_session(transcript, speaker_map)
        
        print("Transcription successful")
        return session_transcript
    
    except Exception as e:
        print(f"Error during video to transcript conversion: {e}")
        return None

if __name__ == "__main__":
    try:
        dotenv.load_dotenv(dotenv.find_dotenv())
        prepare_file_dialogs()

        argparser = argparse.ArgumentParser(description="Convert video file to transcript.")
        argparser.add_argument("video_file", help="Path to the input video file.")
        args = argparser.parse_args()

        input_file = args.video_file

        input_name = os.path.basename(input_file).split('.')[0]
        input_extension = os.path.basename(input_file).split('.')[-1].lower()

        if input_extension not in ['mp4', 'mov', 'avi', 'mkv', 'flv', 'wmv']:
            raise ValueError(f"Unsupported video format: {input_extension}")

        print(f"Transcribing video file: {input_file}")

        transcript = video_to_transcript(input_file)
        if transcript is None:
            raise ValueError("Transcription failed or returned no data.")
            
        output_file = os.path.join(os.path.dirname(input_file), input_name, "_transcript.txt")
        with open(output_file, "w", encoding="utf-8") as f:
            f.write(transcript)
        
        print(f"Transcript saved to {output_file}")

    except Exception as e:
        print(f"An error occurred: {e}")

    finally:
        input("Press Enter to exit...")

