#!/usr/bin/env python3
"""
CLI to download audio from a YouTube video OR full playlist,
as WAV (lossless) or MP3 320 kbps, with metadata and cover art
embedded inside the file. No leftover JPG or JSON files.

Usage:
    python3 download.py                       # interactive
    python3 download.py <URL>                 # asks for format
    python3 download.py <URL> --mp3           # force MP3 320 kbps
    python3 download.py <URL> --wav           # force WAV 24-bit/48kHz
    python3 download.py <URL> --mp3 --yes     # skip playlist confirmation
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

try:
    import yt_dlp
except ImportError:
    print("yt-dlp is not installed. Run: pip install -r requirements.txt")
    sys.exit(1)


OUTPUT_DIR = Path(__file__).parent / "downloads"
OUTPUT_DIR.mkdir(exist_ok=True)

THUMB_EXTS = (".jpg", ".jpeg", ".png", ".webp")


# ---------- CLI helpers ----------

def color(text: str, c: str) -> str:
    palette = {"g": "\033[32m", "y": "\033[33m", "c": "\033[36m",
               "r": "\033[31m", "b": "\033[1m", "x": "\033[0m"}
    return f"{palette.get(c, '')}{text}{palette['x']}"


def ask_choice(prompt: str, options: dict) -> str:
    while True:
        ans = input(prompt).strip().lower()
        if ans in options:
            return options[ans]
        if ans in options.values():
            return ans
        print(color("  Invalid option, try again.\n", "r"))


def confirm(prompt: str) -> bool:
    return input(prompt).strip().lower() in ("", "y", "yes", "s", "sim")


# ---------- link inspection ----------

def inspect(url: str) -> dict:
    opts = {"quiet": True, "extract_flat": "in_playlist", "skip_download": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        return ydl.extract_info(url, download=False)


# ---------- yt-dlp options ----------

def build_options(fmt: str, is_playlist: bool) -> dict:
    if is_playlist:
        template = str(OUTPUT_DIR / "%(playlist_title)s" /
                       "%(playlist_index)03d - %(title)s.%(ext)s")
    else:
        template = str(OUTPUT_DIR / "%(title)s.%(ext)s")

    postprocessors = [
        {
            "key": "FFmpegExtractAudio",
            "preferredcodec": fmt,
            "preferredquality": "320" if fmt == "mp3" else "0",
        },
        {"key": "FFmpegMetadata", "add_metadata": True},
    ]

    # MP3 supports embedded cover natively via ID3v2 APIC.
    # WAV cover is embedded manually below (FFmpeg + ID3v2 chunk).
    if fmt == "mp3":
        postprocessors.append(
            {"key": "EmbedThumbnail", "already_have_thumbnail": False}
        )

    opts = {
        "format": "bestaudio/best",
        "outtmpl": template,
        "writethumbnail": True,    # needed so we can embed the cover
        "writeinfojson": False,    # no leftover .info.json
        "postprocessors": postprocessors,
        "ignoreerrors": True,
        "noplaylist": False,
        "yes_playlist": True,
        "quiet": False,
    }

    if fmt == "mp3":
        opts["postprocessor_args"] = ["-b:a", "320k", "-ar", "48000", "-ac", "2"]
    else:  # wav
        opts["postprocessor_args"] = [
            "-acodec", "pcm_s24le", "-ar", "48000", "-ac", "2",
        ]

    return opts


# ---------- WAV cover embedding + cleanup ----------

def embed_cover_into_wav(wav_path: Path) -> bool:
    """Embed the sibling thumbnail (if any) into the WAV via ID3v2 APIC."""
    thumb = next(
        (wav_path.with_suffix(ext) for ext in THUMB_EXTS
         if wav_path.with_suffix(ext).exists()),
        None,
    )
    if thumb is None:
        return False

    # Convert webp/png to jpg if needed (ID3 APIC is happiest with jpg/png).
    if thumb.suffix.lower() == ".webp":
        jpg = thumb.with_suffix(".jpg")
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(thumb), str(jpg)],
            check=False, capture_output=True,
        )
        thumb.unlink(missing_ok=True)
        thumb = jpg

    tmp_out = wav_path.with_name(wav_path.stem + ".__tmp__.wav")
    result = subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", str(wav_path),
            "-i", str(thumb),
            "-map", "0:a", "-map", "1",
            "-c:a", "copy",
            "-c:v", "mjpeg",
            "-disposition:v", "attached_pic",
            "-metadata:s:v", "title=Album cover",
            "-metadata:s:v", "comment=Cover (front)",
            "-id3v2_version", "3",
            "-write_id3v2", "1",
            str(tmp_out),
        ],
        capture_output=True,
    )

    if result.returncode == 0 and tmp_out.exists():
        tmp_out.replace(wav_path)
        thumb.unlink(missing_ok=True)
        return True

    tmp_out.unlink(missing_ok=True)
    thumb.unlink(missing_ok=True)  # still clean up
    return False


def cleanup_leftovers(root: Path) -> None:
    """Remove any stray thumbnail or info.json files inside output dir."""
    for ext in THUMB_EXTS:
        for f in root.rglob(f"*{ext}"):
            f.unlink(missing_ok=True)
    for f in root.rglob("*.info.json"):
        f.unlink(missing_ok=True)


# ---------- main flow ----------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Download audio from YouTube videos or playlists.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("url", nargs="?", help="YouTube URL (video or playlist)")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--mp3", action="store_true", help="Force MP3 320 kbps")
    group.add_argument("--wav", action="store_true", help="Force WAV 24-bit/48kHz")
    parser.add_argument("-y", "--yes", action="store_true",
                        help="Skip playlist confirmation")
    args = parser.parse_args()

    if not shutil.which("ffmpeg"):
        print(color("ffmpeg not found in PATH. Install it first.", "r"))
        sys.exit(1)

    print(color("\n=== YouTube → Audio ===\n", "b"))

    url = args.url or input(color("Paste the YouTube URL: ", "c")).strip()
    if not url:
        print(color("No URL provided.", "r"))
        sys.exit(1)

    print(color("\nInspecting URL...", "y"))
    try:
        info = inspect(url)
    except Exception as e:
        print(color(f"Failed to read URL: {e}", "r"))
        sys.exit(1)

    is_playlist = info.get("_type") == "playlist" or "entries" in info
    title = info.get("title", "(no title)")

    if is_playlist:
        count = len(list(info.get("entries") or []))
        print(color(f"  Playlist detected: {title}  ({count} items)", "g"))
        if not args.yes and not confirm(
            color(f"\nDownload ALL {count} tracks? [Y/n]: ", "c")
        ):
            print("Cancelled.")
            sys.exit(0)
    else:
        print(color(f"  Video: {title}", "g"))

    if args.mp3:
        fmt = "mp3"
    elif args.wav:
        fmt = "wav"
    else:
        print(color("\nChoose format:", "b"))
        print("  1) MP3 320 kbps  (small, great quality, cover embedded)")
        print("  2) WAV 24-bit / 48 kHz  (lossless, large files)")
        fmt = ask_choice(color("Option [1/2]: ", "c"),
                         {"1": "mp3", "2": "wav"})

    print(color(f"\n→ Format: {fmt.upper()}", "g"))
    print(color(f"→ Output: {OUTPUT_DIR}\n", "g"))

    opts = build_options(fmt, is_playlist)
    with yt_dlp.YoutubeDL(opts) as ydl:
        rc = ydl.download([url])

    if fmt == "wav":
        for wav in OUTPUT_DIR.rglob("*.wav"):
            embed_cover_into_wav(wav)

    cleanup_leftovers(OUTPUT_DIR)

    if rc == 0:
        print(color("\n✔ Done. Files in: " + str(OUTPUT_DIR), "g"))
    else:
        print(color("\n⚠ Finished with some errors (see log above).", "y"))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(color("\n\nInterrupted by user.", "r"))
        sys.exit(130)
