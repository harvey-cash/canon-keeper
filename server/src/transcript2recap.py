import tkinter as tk
from tkinter import filedialog

from google import genai


def _generate_text(api_key: str, model: str, contents: str) -> str:
    try:
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=model,
            contents=contents,
        )
        return response.text
    except Exception as e:
        print(f"Error during GenAI API call: {e}")
        return None


def transcript_to_recap(transcript: str, api_key: str, prompt: str) -> str:
    """ "
    Generates a recap of the provided transcript using GenAI."
    """
    if not transcript:
        print("Error: Transcript is empty.")
        return ""

    if not api_key:
        print("Error: API key is missing.")
        return ""

    if not prompt:
        print("Error: Prompt is empty.")
        return ""

    print("Generating recap with Gemini...")
    contents = transcript + "\n\n---\n\n" + prompt

    return _generate_text(
        api_key=api_key,
        model="gemini-2.5-pro-exp-03-25",
        contents=contents,
    )


def recap_to_summary(recap: str, api_key: str, prompt: str) -> str:
    """
    Generates a summary of the provided recap using GenAI.
    """
    if not recap:
        print("Error: Recap is empty.")
        return ""

    if not api_key:
        print("Error: API key is missing.")
        return ""

    if not prompt:
        print("Error: Prompt is empty.")
        return ""

    print("Generating summary with Gemini...")
    contents = recap + "\n\n---\n\n" + prompt

    return _generate_text(
        api_key=api_key,
        model="gemini-2.5-pro-exp-03-25",
        contents=contents,
    )


def main():
    # Initialize Tkinter and hide the root window
    root = tk.Tk()
    root.withdraw()

    print("Select the transcript (with names) to use for recap generation.")
    transcript_path = filedialog.askopenfilename(
        title="Select Transcript Text File",
        filetypes=[("Text files", "*.txt"), ("All files", "*.*")],
    )

    if not transcript_path:
        print("No transcript file selected. Exiting.")
        return

    transcript = None
    try:
        with open(transcript_path, encoding="utf-8") as f_transcript:
            transcript = f_transcript.read()
    except Exception as e:
        print(f"Error reading transcript file: {e}")
        return

    # Get the API key from the user
    print("Select your API key file (.key).")
    key_path = filedialog.askopenfilename(
        title="Select GenAI API Key File (.key)",
        filetypes=[("API Key files", "*.key"), ("All files", "*.*")],
    )
    api_key = None
    try:
        with open(key_path) as f_key:
            api_key = f_key.readline().strip()
    except Exception as e:
        print(f"Error reading API key file: {e}")
        return

    print("Select your prompt file (.txt).")
    prompt_path = filedialog.askopenfilename(
        title="Select Prompt File (.txt)",
        filetypes=[("Text files", "*.txt"), ("All files", "*.*")],
    )
    prompt = None
    try:
        with open(prompt_path, encoding="utf-8") as f_prompt:
            prompt = f_prompt.read()
    except Exception as e:
        print(f"Error reading prompt file: {e}")
        return

    # Generate the recap
    recap = transcript_to_recap(transcript, api_key, prompt)

    if not recap:
        print("Recap generation failed. Exiting.")
        return

    print("Choose where to save the recap.")
    output_path = filedialog.asksaveasfilename(
        title="Save Recap As",
        defaultextension=".txt",
        filetypes=[("Text files", "*.txt"), ("All files", "*.*")],
    )
    if not output_path:
        print("No save location selected. Exiting.")
        return

    try:
        with open(output_path, "w", encoding="utf-8") as f_output:
            f_output.write(recap)
        print(f"Recap successfully saved to: {output_path}")
    except Exception as e:
        print(f"Error saving recap: {e}")
        return

    print("Recap generation completed successfully.")

    print("Select the prompt file for summary generation.")
    summary_prompt_path = filedialog.askopenfilename(
        title="Select Summary Prompt File (.txt)",
        filetypes=[("Text files", "*.txt"), ("All files", "*.*")],
    )
    summary_prompt = None
    try:
        with open(summary_prompt_path, encoding="utf-8") as f_summary_prompt:
            summary_prompt = f_summary_prompt.read()
    except Exception as e:
        print(f"Error reading summary prompt file: {e}")
        return

    summary = recap_to_summary(recap, api_key, summary_prompt)
    if not summary:
        print("Summary generation failed. Exiting.")
        return

    print("Choose where to save the summary.")
    summary_output_path = filedialog.asksaveasfilename(
        title="Save Summary As",
        defaultextension=".txt",
        filetypes=[("Text files", "*.txt"), ("All files", "*.*")],
    )
    if not summary_output_path:
        print("No save location selected. Exiting.")
        return

    try:
        with open(summary_output_path, "w", encoding="utf-8") as f_summary_output:
            f_summary_output.write(summary)
        print(f"Summary successfully saved to: {summary_output_path}")
    except Exception as e:
        print(f"Error saving summary: {e}")
        return

    print("Summary generation completed successfully.")


if __name__ == "__main__":
    main()
