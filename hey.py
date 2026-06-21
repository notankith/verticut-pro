import yt_dlp
import subprocess
import glob
import os
import re

download_path = r"D:\work stuff\downloads"
ffmpeg_path = r"C:\Users\ankit\Downloads\ffmpeg.exe"

user_input = input("Enter (URL START-END):\n")

try:
    url, time_range = user_input.split()
    start, end = time_range.split("-")
except:
    print("❌ Format: URL 00:07-00:12")
    exit()

# 🧠 Clean filename
def clean_name(name):
    return re.sub(r'[\\/*?:"<>|]', "", name)

# Step 1: Get title + download FULL video
ydl_opts = {
    "format": "bestvideo+bestaudio",
    "outtmpl": download_path + r"\temp.%(ext)s",
    "quiet": False
}

with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    info = ydl.extract_info(url, download=True)
    title = clean_name(info.get("title", "video"))

# Step 2: Find downloaded file
files = glob.glob(download_path + r"\temp.*")
if not files:
    print("❌ Download failed")
    exit()

input_file = files[0]
output_file = os.path.join(download_path, f"{title}.mp4")

# Step 3: CUT + ENCODE using ffmpeg ONLY
cmd = [
    ffmpeg_path,
    "-y",
    "-ss", start,
    "-to", end,
    "-i", input_file,
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-an",
    output_file
]

subprocess.run(cmd)

print(f"✅ Done: {output_file}")