import { NextRequest } from "next/server";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import archiver from "archiver";

import {
  type Format,
  cleanupSidecars,
  embedCoverIntoWav,
  isYouTubeUrl,
  listAudioFiles,
  makeJobDir,
  rmJobDir,
  runYtDlp,
  sanitizeFilename,
} from "@/lib/ytdlp";
import { consumeJob, createJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]+/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(
    filename,
  )}`;
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface PrepareBody {
  url?: string;
  format?: Format;
  playlist?: boolean;
}

/**
 * POST → prepares the audio file on disk and returns a jobId.
 * The actual file transfer to the browser happens via GET /api/download?job=<id>.
 */
export async function POST(req: NextRequest) {
  let body: PrepareBody;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const url = (body.url ?? "").trim();
  const format: Format = body.format === "wav" ? "wav" : "mp3";
  const includePlaylist = Boolean(body.playlist);

  if (!isYouTubeUrl(url)) {
    return jsonError(400, "Please provide a valid YouTube URL.");
  }

  const jobDir = await makeJobDir();

  try {
    await runYtDlp({ url, format, includePlaylist, outDir: jobDir });

    if (format === "wav") {
      const wavs = await listAudioFiles(jobDir, "wav");
      for (const w of wavs) await embedCoverIntoWav(w);
    }
    await cleanupSidecars(jobDir);

    const files = await listAudioFiles(jobDir, format);
    if (files.length === 0) {
      await rmJobDir(jobDir);
      return jsonError(
        502,
        "No audio files were produced. The URL may be unavailable or restricted.",
      );
    }

    // Single file: store path directly
    if (files.length === 1) {
      const file = files[0];
      const st = await stat(file);
      const name = sanitizeFilename(path.basename(file));
      const jobId = createJob({
        dir: jobDir,
        file,
        mime: format === "mp3" ? "audio/mpeg" : "audio/wav",
        name,
        size: st.size,
      });
      return Response.json({ jobId, name, size: st.size, count: 1 });
    }

    // Multiple files: build a zip up-front so GET can stream from disk and we
    // can report a real Content-Length.
    const zipName =
      sanitizeFilename(
        path.basename(path.dirname(files[0])) === path.basename(jobDir)
          ? "playlist"
          : path.basename(path.dirname(files[0])),
      ) + ".zip";
    const zipPath = path.join(jobDir, zipName);

    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 0 } });
      output.on("close", () => resolve());
      output.on("error", reject);
      archive.on("error", reject);
      archive.pipe(output);
      const folder = zipName.replace(/\.zip$/, "");
      for (const f of files) {
        archive.file(f, { name: `${folder}/${path.basename(f)}` });
      }
      void archive.finalize();
    });

    const st = await stat(zipPath);
    const jobId = createJob({
      dir: jobDir,
      file: zipPath,
      mime: "application/zip",
      name: zipName,
      size: st.size,
    });
    return Response.json({ jobId, name: zipName, size: st.size, count: files.length });
  } catch (err) {
    await rmJobDir(jobDir);
    const message = err instanceof Error ? err.message : "Download failed";
    return jsonError(500, message);
  }
}

/**
 * GET → streams the prepared file to the browser as an attachment, then
 * cleans up the temp dir.
 */
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("job");
  if (!jobId) {
    return jsonError(400, "Missing job parameter");
  }

  const entry = consumeJob(jobId);
  if (!entry) {
    return jsonError(404, "Job not found or expired. Prepare it again.");
  }

  const nodeStream = createReadStream(entry.file);
  const cleanup = () => void rmJobDir(entry.dir);
  nodeStream.on("close", cleanup);
  nodeStream.on("error", cleanup);

  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  return new Response(webStream, {
    headers: {
      "Content-Type": entry.mime,
      "Content-Length": String(entry.size),
      "Content-Disposition": contentDisposition(entry.name),
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
