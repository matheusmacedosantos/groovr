#!/usr/bin/env node
/**
 * Downloads the platform-appropriate yt-dlp binary into ./bin/ during `npm run build`.
 * Skipped if YT_DLP_PATH is already set (dev override via .env.local).
 */
import { createWriteStream, mkdirSync, chmodSync } from "node:fs";
import { get } from "node:https";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.YT_DLP_PATH) {
  console.log("[prebuild] YT_DLP_PATH set, skipping yt-dlp download");
  process.exit(0);
}

const rootDir = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const binDir = join(rootDir, "bin");
const { platform } = process;

const BIN_NAME = platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const ASSET =
  platform === "win32"
    ? "yt-dlp.exe"
    : platform === "darwin"
      ? "yt-dlp_macos"
      : "yt-dlp_linux"; // Vercel runs on Linux x64

const DOWNLOAD_URL =
  `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ASSET}`;
const OUT = join(binDir, BIN_NAME);

mkdirSync(binDir, { recursive: true });
console.log(`[prebuild] Downloading ${ASSET} → bin/${BIN_NAME}`);

function fetch(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);

    const request = (u) =>
      get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          // recreate the stream after redirect
          const file2 = createWriteStream(dest);
          get(res.headers.location, (res2) => {
            res2.pipe(file2);
            file2.on("finish", () => file2.close(resolve));
          }).on("error", reject);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
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
      }).on("error", reject);

    request(url);
    file.on("error", reject);
  });
}

try {
  await fetch(DOWNLOAD_URL, OUT);
  if (platform !== "win32") chmodSync(OUT, 0o755);
  console.log("[prebuild] yt-dlp ready");
} catch (err) {
  console.error(`[prebuild] yt-dlp download failed: ${err.message}`);
  // Non-fatal: app can still run if yt-dlp is on PATH or via YT_DLP_PATH
  process.exit(0);
}
