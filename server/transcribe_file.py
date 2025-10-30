import dotenv
import os
import argparse
import json
import tempfile  # Added for temporary directory
from src.file_io import read_video_file, read_audio_file, copy_stream
from src.video2audio import video_to_mp3
from src.audio2transcript import audio_to_transcript
from src.transcript2snippets import transcript_to_snippets
from src.snippets2speakers import snippets_to_speakers
from src.transcript2session import transcript_to_session

VIDEO_FORMATS = ['mp4', 'mov', 'avi', 'mkv', 'flv', 'wmv']
AUDIO_FORMATS = ['mp3']

def transcribe(file_path, audio_data):
    print(f"Processing file: {file_path}")

    try:
        transcript = audio_to_transcript(audio_data, os.getenv("ASSEMBLY_AI_API_KEY"))
        if not transcript:
            print("Failed to transcribe audio.")
            return None
        
        snippets = transcript_to_snippets(audio_data, transcript.get("utterances"))
        if not snippets:
            print("Failed to extract snippets from transcript.")
            return None
        
        print(f"Generated {len(snippets)} snippets.")

        # Create a temporary directory for all intermediate files
        with tempfile.TemporaryDirectory() as temp_dir:
            print(f"Using temporary directory: {temp_dir}")

            # Save full transcript to temp dir
            json.dump(transcript, open(os.path.join(temp_dir, "transcript.json"), "w"), indent=4)

            # Create truncated snippet text map
            snippets_file_path = os.path.join(temp_dir, "snippets.json")
            label_text_map = { speaker: data["text"] for speaker, data in snippets.items() }
            json.dump(label_text_map, open(snippets_file_path, "w"), indent=4)

            # Save truncated audio snippets to temp dir
            for speaker, speaker_dict in snippets.items():
                save_path = os.path.join(temp_dir, f"speaker_{speaker}_snippet.mp3")
                with open(save_path, "wb") as f_audio:
                    copy_stream(speaker_dict["audio"], f_audio)

            print("Saved snippets and transcript to temporary directory.")
            
            # Process snippets from the temporary directory
            speaker_map = snippets_to_speakers(snippets_file_path, temp_dir)
            print(f"Speaker map: {speaker_map}")

            # Generate the final session transcript
            session_transcript = transcript_to_session(transcript, speaker_map)
        
        # temp_dir and its contents are automatically deleted here

        print("Transcription successful")
        return session_transcript
    
    except Exception as e:
        print(f"Error during video to transcript conversion: {e}")
        return None

if __name__ == "__main__":
    try:
        dotenv.load_dotenv(dotenv.find_dotenv())

        argparser = argparse.ArgumentParser(description="Convert file to transcript.")
        argparser.add_argument("input_file", help="Path to the input file.")
        args = argparser.parse_args()

        input_file = args.input_file

        input_name = os.path.basename(input_file).split('.')[0]
        input_extension = os.path.basename(input_file).split('.')[-1].lower()

        if input_extension not in VIDEO_FORMATS and input_extension not in AUDIO_FORMATS:
            raise ValueError(f"Unsupported file format: {input_extension}")
        
        if input_extension in VIDEO_FORMATS:
            video_data = read_video_file(input_file)
            audio_data = video_to_mp3(video_data)
        else:
            audio_data = read_audio_file(input_file)

        if audio_data is None:
            raise ValueError("Failed to load audio data from the input file.")

        print(f"Transcribing file: {input_file}")

        transcript = transcribe(input_file, audio_data)
        if transcript is None:
            raise ValueError("Transcription failed or returned no data.")
        
        output_file = os.path.join(os.path.dirname(input_file), input_name + "_transcript.txt")
        with open(output_file, "w", encoding="utf-8") as f:
            f.write(transcript)
        
        print(f"Transcript saved to {output_file}")

    except Exception as e:
        print(f"An error occurred: {e}")

    finally:
        # Keep the window open until the user presses Enter
        input("Press Enter to exit...")
