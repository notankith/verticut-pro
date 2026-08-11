import mimetypes
import os
import re
import struct

from google import genai
from google.genai import types


def save_binary_file(file_name: str, data: bytes):
    with open(file_name, "wb") as f:
        f.write(data)

    print(f"File saved to: {file_name}")


def generate():
    api_key = os.environ.get("GEMINI_API_KEY")

    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY environment variable is not set."
        )

    client = genai.Client(api_key=api_key)

    model = "gemini-2.5-flash-preview-tts"

    contents = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_text(
                    text="""## Scene:
VERY FAST QUICK pronounciations

## Transcript:
I strongly suspect the fastest diagnostic is to inspect the actual model + voice values being passed from Settings into the Gemini request."""
                )
            ],
        )
    ]

    generate_content_config = types.GenerateContentConfig(
        temperature=1,
        response_modalities=["audio"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name="Orus"
                )
            )
        ),
    )

    audio_chunks = []
    mime_type = None

    print("Generating voice...")
    print(f"Model: {model}")
    print("Voice: Orus")

    try:
        for chunk in client.models.generate_content_stream(
            model=model,
            contents=contents,
            config=generate_content_config,
        ):
            if not chunk.parts:
                continue

            for part in chunk.parts:
                if (
                    part.inline_data
                    and part.inline_data.data
                ):
                    audio_chunks.append(part.inline_data.data)

                    if mime_type is None:
                        mime_type = part.inline_data.mime_type

                elif part.text:
                    print(part.text)

    except Exception as e:
        print(f"Gemini TTS generation failed: {e}")
        raise

    if not audio_chunks:
        raise RuntimeError(
            "Gemini returned no audio data."
        )

    audio_data = b"".join(audio_chunks)

    print(f"Received {len(audio_chunks)} audio chunks")
    print(f"Total audio bytes: {len(audio_data)}")
    print(f"MIME type: {mime_type}")

    # Gemini TTS normally returns raw PCM such as:
    # audio/L16;rate=24000
    if mime_type and mime_type.startswith("audio/L"):
        audio_data = convert_to_wav(
            audio_data,
            mime_type,
        )
        output_file = "gemini_voiceover.wav"
    else:
        extension = (
            mimetypes.guess_extension(mime_type)
            if mime_type
            else None
        )

        if not extension:
            extension = ".wav"

        output_file = f"gemini_voiceover{extension}"

    save_binary_file(
        output_file,
        audio_data,
    )

    print("Voice generation complete.")


def convert_to_wav(
    audio_data: bytes,
    mime_type: str,
) -> bytes:
    parameters = parse_audio_mime_type(mime_type)

    bits_per_sample = parameters["bits_per_sample"]
    sample_rate = parameters["rate"]

    if bits_per_sample is None:
        bits_per_sample = 16

    if sample_rate is None:
        sample_rate = 24000

    num_channels = 1

    data_size = len(audio_data)

    bytes_per_sample = bits_per_sample // 8
    block_align = num_channels * bytes_per_sample
    byte_rate = sample_rate * block_align

    chunk_size = 36 + data_size

    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        chunk_size,
        b"WAVE",
        b"fmt ",
        16,
        1,
        num_channels,
        sample_rate,
        byte_rate,
        block_align,
        bits_per_sample,
        b"data",
        data_size,
    )

    return header + audio_data


def parse_audio_mime_type(
    mime_type: str,
) -> dict[str, int | None]:

    bits_per_sample = 16
    rate = 24000

    parts = mime_type.split(";")

    for param in parts:
        param = param.strip()

        # Example:
        # audio/L16
        if param.lower().startswith("audio/L".lower()):
            try:
                bits_per_sample = int(
                    param.split("L", 1)[1]
                )
            except (ValueError, IndexError):
                pass

        # Example:
        # rate=24000
        elif param.lower().startswith("rate="):
            try:
                rate = int(
                    param.split("=", 1)[1]
                )
            except (ValueError, IndexError):
                pass

    return {
        "bits_per_sample": bits_per_sample,
        "rate": rate,
    }


if __name__ == "__main__":
    generate()