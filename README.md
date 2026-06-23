# yt-audio

Web app that extracts the audio track from any YouTube video or full playlist
as **MP3 320 kbps** or **lossless WAV (24-bit / 48 kHz)**, with metadata and
cover art embedded directly into the file. The downloaded file is streamed
straight to the user's browser — nothing is kept on the server.

Built with **Next.js 14 (App Router) + TypeScript**, backed by **yt-dlp** and
**ffmpeg**.

---

## Local development

Prerequisites on `PATH`:

- Node.js 20+
- [`ffmpeg`](https://ffmpeg.org/)
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp)

```bash
npm install
npm run dev
# → http://localhost:3000
```

Optional overrides (for non-standard install paths):

```bash
YT_DLP_PATH=/usr/local/bin/yt-dlp FFMPEG_PATH=/opt/homebrew/bin/ffmpeg npm run dev
```

## Production build

```bash
npm run build
npm run start
```

## Deploy with Docker

The included `Dockerfile` builds a minimal Debian image with `ffmpeg`,
`python3` and the latest `yt-dlp` baked in. Works on any container host
(Fly.io, Railway, Render, Cloud Run, your own VPS, etc.).

```bash
docker build -t yt-audio .
docker run --rm -p 3000:3000 yt-audio
```

> Vercel's default serverless runtime does **not** include `ffmpeg` /
> `yt-dlp`, so deploy to a Node-server platform (Railway, Fly, Render,
> Docker, etc.) instead.

## API

- `POST /api/inspect` — `{ url }` → `{ isPlaylist, title, count }`
- `POST /api/download` — `{ url, format: "mp3" | "wav", playlist: boolean }`
  → streams the produced audio file (or a `.zip` for playlists) with
  `Content-Disposition: attachment`.

## CLI (legacy)

The original Python CLI (`download.py`) is still available for terminal use:

```bash
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python3 download.py "https://www.youtube.com/watch?v=…" --mp3
```

## Notes

YouTube only serves compressed audio (Opus/AAC ~128–256 kbps). WAV does not
create quality out of nowhere — it guarantees zero additional loss from what
YouTube provides. Use WAV for editing or transcription work, MP3 for casual
listening.
