from google import genai

from . import file_io


def _generate_text(api_key: str, model: str, contents: str) -> str:
    try:
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(model=model, contents=contents)
        return response.text
    except Exception as e:
        print(f"Error during GenAI API call: {e}")
        return None


def session_to_recap(transcript: str, api_key: str, prompt: str) -> str:
    """Generates a recap of the provided transcript using GenAI."""
    print("Generating recap with Gemini...")
    contents = transcript + "\n\n---\n\n" + prompt
    return _generate_text(api_key, "gemini-2.5-pro-exp-03-25", contents)


def recap_to_summary(recap: str, api_key: str, prompt: str) -> str:
    """Generates a summary of the provided recap using GenAI."""
    print("Generating summary with Gemini...")
    contents = recap + "\n\n---\n\n" + prompt
    return _generate_text(api_key, "gemini-2.5-pro-exp-03-25", contents)


def main():
    try:
        file_io.prepare_file_dialogs()

        transcript = file_io.load_text_file(
            "Select Transcript File (with named speakers)"
        )
        if not transcript:
            return

        api_key = file_io.load_key("Select GenAI API Key")
        if not api_key:
            return

        recap_prompt = file_io.load_text_file("Select Transcript2Recap Prompt")
        if not recap_prompt:
            return

        recap = session_to_recap(transcript, api_key, recap_prompt)
        if not recap:
            return

        output_path = file_io.save_file("Recap", "txt", recap, initial_file="Recap")
        if not output_path:
            return

        summary_prompt = file_io.load_text_file("Select Recap2Summary Prompt")
        if not summary_prompt:
            return

        summary = recap_to_summary(recap, api_key, summary_prompt)
        if not summary:
            return

        file_io.save_file("Summary", "txt", summary, initial_file="Summary")

    except Exception as e:
        print(f"Exception: {e}")


if __name__ == "__main__":
    main()
