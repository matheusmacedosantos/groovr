import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type Format = "mp3" | "wav";

export interface InspectResult {
  isPlaylist: boolean;
  title: string;
  count: number;
  thumbnail?: string | null;
}

const YT_DLP =
  process.env.YT_DLP_PATH ||
  (process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

const YOUTUBE_RE =
  /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\/.+/i;

export function isYouTubeUrl(input: unknown): input is string {
  return typeof input === "string" && YOUTUBE_RE.test(input.trim());
}

function runCollect(
  bin: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (b) => out.push(b));
    child.stderr.on("data", (b) => err.push(b));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      }),
    );
  });
}

export async function inspectUrl(url: string): Promise<InspectResult> {
  const { code, stdout, stderr } = await runCollect(YT_DLP, [
    "--quiet",
    "--no-warnings",
    "--flat-playlist",
    "--dump-single-json",
    "--skip-download",
    url,
  ]);

  if (code !== 0) {
    throw new Error(
      stderr.split("\n").filter(Boolean).slice(-3).join(" | ") ||
        "yt-dlp failed to inspect the URL",
    );
  }

  const json = JSON.parse(stdout);
  const isPlaylist =
    json?._type === "playlist" || Array.isArray(json?.entries);
  const count = isPlaylist ? (json.entries?.length ?? 0) : 1;
  return {
    isPlaylist,
    title: json.title ?? json.fulltitle ?? "audio",
    count,
    thumbnail: json.thumbnail ?? null,
  };
}

export async function makeJobDir(): Promise<string> {
  const dir = path.join(tmpdir(), `yta-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function rmJobDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    /* noop */
  }
}

interface DownloadOptions {
  url: string;
  format: Format;
  includePlaylist: boolean;
  outDir: string;
  onLog?: (line: string) => void;
}

export async function runYtDlp(opts: DownloadOptions): Promise<void> {
  const { url, format, includePlaylist, outDir, onLog } = opts;

  // Filename templates — never prefix with playlist index. Playlists are
  // grouped into a folder named after the playlist title, single tracks land
  // straight in outDir. yt-dlp auto-deduplicates colliding filenames.
  const template = includePlaylist
    ? path.join(outDir, "%(playlist_title|playlist)s/%(title)s.%(ext)s")
    : path.join(outDir, "%(title)s.%(ext)s");

  const args = [
    "--no-warnings",
    "--newline",
    "--no-playlist-reverse",
    includePlaylist ? "--yes-playlist" : "--no-playlist",
    "-f",
    "bestaudio/best",
    "-x",
    "--audio-format",
    format,
    "--audio-quality",
    "0",
    // Tags: title, artist (uploader), album (playlist), date, etc.
    "--embed-metadata",
    "--add-metadata",
    // Cover: embed when supported (mp3, m4a, ogg, opus, flac) and always
    // write the file to disk — embedCoverIntoWav needs it for WAV.
    "--embed-thumbnail",
    "--write-thumbnail",
    "--convert-thumbnails",
    "jpg",
    // Map fields so the artist/album tags are populated even when the video
    // doesn't carry structured music metadata.
    "--parse-metadata",
    "%(uploader,creator|)s:%(meta_artist)s",
    "--parse-metadata",
    "%(playlist_title,album|)s:%(meta_album)s",
    "--parse-metadata",
    "%(release_year,upload_date>%Y|)s:%(meta_date)s",
    "--no-write-info-json",
    "--no-write-description",
    "--no-write-comments",
    "--no-write-playlist-metafiles",
    "-o",
    template,
    "--ignore-errors",
  ];

  if (format === "mp3") {
    args.push("--postprocessor-args", "ffmpeg:-b:a 320k -ar 48000 -ac 2");
  } else {
    args.push(
      "--postprocessor-args",
      "ffmpeg:-acodec pcm_s24le -ar 48000 -ac 2",
    );
  }

  args.push(url);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(YT_DLP, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const pipeLogs = (stream: NodeJS.ReadableStream) => {
      let buf = "";
      stream.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) onLog?.(line.trim());
        }
      });
    };

    pipeLogs(child.stdout);
    pipeLogs(child.stderr);

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp exited with code ${code}`));
    });
  });
}

const COVER_EXTS = [".jpg", ".jpeg", ".png", ".webp"];

/**
 * For WAV outputs, yt-dlp will not always embed the cover. We attach the cover
 * to the WAV container manually via ffmpeg, matching the Python CLI behaviour.
 */
export async function embedCoverIntoWav(wavPath: string): Promise<void> {
  const base = wavPath.replace(/\.wav$/i, "");
  const cover = (
    await Promise.all(
      COVER_EXTS.map(async (ext) => {
        const p = base + ext;
        try {
          await fs.access(p);
          return p;
        } catch {
          return null;
        }
      }),
    )
  ).find(Boolean);

  if (!cover) return;

  let coverJpg = cover;
  if (cover.toLowerCase().endsWith(".webp")) {
    const jpg = cover.replace(/\.webp$/i, ".jpg");
    await new Promise<void>((resolve) => {
      const c = spawn(FFMPEG, ["-y", "-i", cover, jpg], { stdio: "ignore" });
      c.on("close", () => resolve());
    });
    await fs.unlink(cover).catch(() => {});
    coverJpg = jpg;
  }

  const tmpOut = wavPath.replace(/\.wav$/i, ".__tmp__.wav");
  const ok = await new Promise<boolean>((resolve) => {
    const c = spawn(
      FFMPEG,
      [
        "-y",
        "-i",
        wavPath,
        "-i",
        coverJpg,
        "-map",
        "0:a",
        "-map",
        "1",
        "-c:a",
        "copy",
        "-c:v",
        "mjpeg",
        "-disposition:v",
        "attached_pic",
        "-metadata:s:v",
        "title=Album cover",
        "-metadata:s:v",
        "comment=Cover (front)",
        "-id3v2_version",
        "3",
        "-write_id3v2",
        "1",
        tmpOut,
      ],
      { stdio: "ignore" },
    );
    c.on("close", (code) => resolve(code === 0));
  });

  if (ok) {
    await fs.rename(tmpOut, wavPath);
  } else {
    await fs.unlink(tmpOut).catch(() => {});
  }
  await fs.unlink(coverJpg).catch(() => {});
}

export async function cleanupSidecars(dir: string): Promise<void> {
  const walk = async (root: string): Promise<string[]> => {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const files: string[] = [];
    for (const e of entries) {
      const p = path.join(root, e.name);
      if (e.isDirectory()) files.push(...(await walk(p)));
      else files.push(p);
    }
    return files;
  };
  const files = await walk(dir);
  for (const f of files) {
    const lower = f.toLowerCase();
    if (
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".png") ||
      lower.endsWith(".webp") ||
      lower.endsWith(".info.json")
    ) {
      await fs.unlink(f).catch(() => {});
    }
  }
}

export async function listAudioFiles(
  dir: string,
  format: Format,
): Promise<string[]> {
  const walk = async (root: string): Promise<string[]> => {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const out: string[] = [];
    for (const e of entries) {
      const p = path.join(root, e.name);
      if (e.isDirectory()) out.push(...(await walk(p)));
      else if (e.name.toLowerCase().endsWith("." + format)) out.push(p);
    }
    return out.sort();
  };
  return walk(dir);
}

export function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "audio";
}
