#!/usr/bin/env node
/**
 * Downloads yt-dlp and copies the ffmpeg binary into ./bin/ during `npm run build`.
 * Both binaries are then bundled into the Vercel serverless function via
 * experimental.outputFileTracingIncludes in next.config.mjs.
 */
import { createWriteStream, mkdirSync, chmodSync, copyFileSync } from "node:fs";
import { get } from "node:https";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const rootDir = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const binDir = join(rootDir, "bin");
const { platform } = process;

mkdirSync(binDir, { recursive: true });

// ── 1. ffmpeg from ffmpeg-static ────────────────────────────────────────────
// We copy the binary rather than calling require('ffmpeg-static') at runtime,
// which avoids webpack bundling the module inline and hardcoding the build-time
// absolute path into the Lambda function bundle.
if (!process.env.FFMPEG_PATH) {
  try {
    const require = createRequire(import.meta.url);
    const ffmpegSrc = require("ffmpeg-static");
    if (ffmpegSrc) {
      const ffmpegDest = join(binDir, platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
      copyFileSync(ffmpegSrc, ffmpegDest);
      if (platform !== "win32") chmodSync(ffmpegDest, 0o755);
      console.log("[prebuild] ffmpeg copied → bin/ffmpeg");
    }
  } catch (e) {
    console.warn(`[prebuild] ffmpeg-static not available: ${e.message}`);
  }
}

// ── 2. yt-dlp from GitHub releases ─────────────────────────────────────────
if (process.env.YT_DLP_PATH) {
  console.log("[prebuild] YT_DLP_PATH set, skipping yt-dlp download");
  process.exit(0);
}

const BIN_NAME = platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const ASSET =
  platform === "win32"
    ? "yt-dlp.exe"
    : platform === "darwin"
      ? "yt-dlp_macos"
      : "yt-dlp_linux";

const DOWNLOAD_URL =
  `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ASSET}`;
const OUT = join(binDir, BIN_NAME);

console.log(`[prebuild] Downloading ${ASSET} → bin/${BIN_NAME}`);

function httpGet(url, dest) {
  return new Promise((resolve, reject) => {
    function attempt(u, redirects) {
      if (redirects > 5) return reject(new Error("Too many redirects"));
      get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return attempt(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} from ${u}`));
        }
        const file = createWriteStream(dest);
        let mb = 0;
        res.on("data", (c) => {
          mb += c.length;
          process.stdout.write(`\r  ${(mb / 1e6).toFixed(1)} MB`);
        });
        res.pipe(file);
        file.on("finish", () => {
          process.stdout.write("\n");
          file.close(resolve);
        });
        file.on("error", reject);
        res.on("error", reject);
      }).on("error", reject);
    }
    attempt(url, 0);
  });
}

try {
  await httpGet(DOWNLOAD_URL, OUT);
  if (platform !== "win32") chmodSync(OUT, 0o755);
  console.log("[prebuild] yt-dlp ready");
} catch (err) {
  console.error(`[prebuild] yt-dlp download failed: ${err.message}`);
  process.exit(0);
}
