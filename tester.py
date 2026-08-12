import os
import wave
import time

from dotenv import load_dotenv
from google import genai
from google.genai import types


load_dotenv()

MODEL = "gemini-3.1-flash-tts-preview"
VOICE = "Orus"
OUTPUT_FILE = "voiceover.wav"


STYLE_PROMPT = """
Audio Profile:
very quick paced sports news voiceover in a sporty tone.

Transcript:
"""


def save_wav(filename, pcm_data):
    with wave.open(filename, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(24000)
        wav.writeframes(pcm_data)


def get_audio(response):
    try:
        for part in response.candidates[0].content.parts:
            if part.inline_data and part.inline_data.data:
                return part.inline_data.data
    except (AttributeError, IndexError, TypeError):
        pass

    return None


def generate_voiceover(client, text, retries=3):
    prompt = STYLE_PROMPT + text.strip()

    for attempt in range(retries):
        try:
            response = client.models.generate_content(
                model=MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=types.SpeechConfig(
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(
                                voice_name=VOICE
                            )
                        )
                    ),
                ),
            )

            audio = get_audio(response)

            if audio:
                return audio

            print("No audio returned, retrying...")

        except Exception as e:
            print(f"TTS error: {e}")

        if attempt < retries - 1:
            time.sleep(2)

    return None


def main():
    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not found in .env")

    client = genai.Client(api_key=api_key)

    print("\nPaste your voiceover script.")
    print("Press Enter on an empty line when finished.\n")

    lines = []

    while True:
        line = input()

        if not line:
            break

        lines.append(line)

    text = "\n".join(lines).strip()

    if not text:
        print("No text entered.")
        return

    print("\nGenerating voiceover...")

    audio = generate_voiceover(client, text)

    if not audio:
        print("Failed to generate voiceover.")
        return

    save_wav(OUTPUT_FILE, audio)

    print(f"\nSaved: {os.path.abspath(OUTPUT_FILE)}")


if __name__ == "__main__":
    main()