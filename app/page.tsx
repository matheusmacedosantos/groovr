"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

type Format = "mp3" | "wav";

interface InspectInfo {
  isPlaylist: boolean;
  title: string;
  count: number;
}

const YT_RE =
  /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\/.+/i;

const isYouTube = (s: string) => YT_RE.test(s.trim());

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ── Console logging helpers ────────────────────────────────────────────────
const STYLE_TAG =
  "background:#1d1d1f;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600";
const STYLE_OK =
  "background:#34c759;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600";
const STYLE_WARN =
  "background:#ff9f0a;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600";
const STYLE_ERR =
  "background:#d93025;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600";
const STYLE_DIM = "color:#86868b";

function log(tag: string, ...rest: unknown[]) {
  console.log(`%c${tag}`, STYLE_TAG, ...rest);
}
function logOK(tag: string, ...rest: unknown[]) {
  console.log(`%c${tag}`, STYLE_OK, ...rest);
}
function logWarn(tag: string, ...rest: unknown[]) {
  console.log(`%c${tag}`, STYLE_WARN, ...rest);
}
function logErr(tag: string, ...rest: unknown[]) {
  console.log(`%c${tag}`, STYLE_ERR, ...rest);
}
function logDim(...rest: unknown[]) {
  console.log("%c" + rest.join(" "), STYLE_DIM);
}

export default function Page() {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<Format>("mp3");
  const [includePlaylist, setIncludePlaylist] = useState(true);

  const [inspecting, setInspecting] = useState(false);
  const [inspect, setInspect] = useState<InspectInfo | null>(null);
  const [inspectErr, setInspectErr] = useState<string | null>(null);

  const [phase, setPhase] = useState<
    "idle" | "preparing" | "started" | "done" | "error"
  >("idle");
  const [logLine, setLogLine] = useState("Awaiting source.");
  const [statusTitle, setStatusTitle] = useState("Preparing");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const inspectAbortRef = useRef<AbortController | null>(null);
  const prepareAbortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Mount
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    console.log(
      "%cGroovr%c boot · v1.0 · Next.js + yt-dlp + ffmpeg",
      STYLE_TAG,
      STYLE_DIM,
    );
    logDim("UI ready. Paste a YouTube URL to begin.");
  }, []);

  // Debounced inspect on URL change
  useEffect(() => {
    setInspectErr(null);
    setInspect(null);
    inspectAbortRef.current?.abort();

    const trimmed = url.trim();
    if (!trimmed) return;
    if (!isYouTube(trimmed)) {
      logWarn("URL", "not a YouTube link — inspect skipped");
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const ctrl = new AbortController();
      inspectAbortRef.current = ctrl;
      setInspecting(true);
      log("INSPECT", "→", trimmed);
      try {
        const res = await fetch("/api/inspect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: trimmed }),
          signal: ctrl.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Failed to inspect URL");
        setInspect(data as InspectInfo);
        logOK("INSPECT", data);
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          logDim("INSPECT aborted");
          return;
        }
        setInspectErr((e as Error).message);
        logErr("INSPECT", (e as Error).message);
      } finally {
        setInspecting(false);
      }
    }, 450);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [url]);

  const formatHint = useMemo(
    () => (format === "mp3" ? "320 kbps · cover" : "24-bit · lossless"),
    [format],
  );
  const qualityHint = useMemo(
    () => (format === "mp3" ? "48 kHz · stereo" : "48 kHz · 24-bit · PCM"),
    [format],
  );

  const busy = phase === "preparing";
  const canSubmit = isYouTube(url) && !busy;

  const onPaste = useCallback(async () => {
    try {
      const txt = await navigator.clipboard.readText();
      if (txt) {
        setUrl(txt.trim());
        inputRef.current?.focus();
        logDim("PASTE", txt.trim());
      }
    } catch {
      inputRef.current?.focus();
      logWarn("PASTE", "clipboard read denied");
    }
  }, []);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit) return;

    console.groupCollapsed(
      "%cDOWNLOAD%c " + url.trim(),
      STYLE_TAG,
      STYLE_DIM,
    );
    log("REQUEST", { format, playlist: includePlaylist, url: url.trim() });
    if (inspect) logDim("source", JSON.stringify(inspect));
    console.groupEnd();

    setPhase("preparing");
    setStatusTitle(
      inspect?.isPlaylist && includePlaylist
        ? `Preparing ${inspect.count} tracks`
        : "Preparing",
    );
    setLogLine("> running yt-dlp + ffmpeg on the server · 0s");
    setErrorMsg(null);

    // Elapsed-time ticker so the user can see things are alive while the
    // server processes (yt-dlp + ffmpeg can take minutes for big playlists).
    const startedAt = Date.now();
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      const time =
        s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
      setLogLine(
        inspect?.isPlaylist && includePlaylist
          ? `> packing ${inspect.count} tracks · ${time} elapsed`
          : `> running yt-dlp + ffmpeg on the server · ${time}`,
      );
    }, 1000);

    const ctrl = new AbortController();
    prepareAbortRef.current = ctrl;

    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          format,
          playlist: includePlaylist,
        }),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Server error");

      const { jobId, name, size, count } = data as {
        jobId: string;
        name: string;
        size: number;
        count: number;
      };

      logOK("PREPARE", { jobId, name, size, count });

      // Trigger native browser download via hidden iframe → /api/download?job=<id>
      let iframe = iframeRef.current;
      if (!iframe) {
        iframe = document.createElement("iframe");
        iframe.style.display = "none";
        iframe.setAttribute("aria-hidden", "true");
        document.body.appendChild(iframe);
        iframeRef.current = iframe;
      }
      iframe.src = `/api/download?job=${encodeURIComponent(jobId)}`;

      setPhase("started");
      setStatusTitle("Download started");
      setLogLine(
        `> ${name} · ${formatBytes(size)}${count > 1 ? ` · ${count} tracks` : ""}`,
      );
      logOK("DOWNLOAD", `${name} (${formatBytes(size)}) — handed to browser`);
    } catch (err) {
      const message =
        (err as Error).name === "AbortError"
          ? "Cancelled."
          : (err as Error).message;
      setPhase("error");
      setStatusTitle("Something went wrong");
      setLogLine(`> ${message}`);
      setErrorMsg(message);
      logErr("DOWNLOAD", message);
    } finally {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      prepareAbortRef.current = null;
    }
  };

  const onCancel = () => {
    prepareAbortRef.current?.abort();
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      iframeRef.current?.remove();
    };
  }, []);

  return (
    <>
      <div className="backdrop" aria-hidden="true">
        <div className="orb a" />
        <div className="orb b" />
        <div className="grain" />
      </div>

      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <span>Groovr</span>
        </div>
        <nav className="topnav" aria-label="formats">
          <span className="spec-pill">MP3 · 320 kbps</span>
          <span className="spec-pill">WAV · 24-bit / 48 kHz</span>
        </nav>
      </header>

      <main>
        <section className="hero">
          <span className="eyebrow">Free YouTube audio downloader</span>
          <h1>
            Your crates,
            <br />
            <em>always ready.</em>
          </h1>
          <p className="lede">
            Paste any YouTube link. Download as MP3 320 kbps or lossless WAV
            24-bit — cover art and metadata embedded, straight to your
            Downloads. Free, no signup.
          </p>
        </section>

        <form
          className="console"
          onSubmit={onSubmit}
          autoComplete="off"
          noValidate
        >
          <div className="url-row">
            <span className="leading">
              <svg
                className="link-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 1 0-7.07-7.07L11.5 4.5" />
                <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 1 0 7.07 7.07L12.5 19.5" />
              </svg>
              <span className="leading-label">URL</span>
            </span>
            <input
              ref={inputRef}
              type="url"
              inputMode="url"
              spellCheck={false}
              placeholder="https://youtube.com/watch?v=…"
              aria-label="YouTube URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button type="button" className="paste-btn" onClick={onPaste}>
              Paste
            </button>
          </div>

          {(inspecting || inspect || inspectErr) && (
            <div className={`inspect ${inspectErr ? "error" : ""}`}>
              <span className="dot-blue" />
              {inspecting && <span>Inspecting source…</span>}
              {!inspecting && inspect && (
                <span>
                  {inspect.isPlaylist
                    ? `Playlist · ${inspect.count} tracks · ${inspect.title}`
                    : `Track · ${inspect.title}`}
                  {inspect.isPlaylist &&
                    includePlaylist &&
                    inspect.count > 30 && (
                      <strong style={{ marginLeft: 8, fontWeight: 500 }}>
                        — large batch, may take several minutes
                      </strong>
                    )}
                </span>
              )}
              {!inspecting && inspectErr && <span>{inspectErr}</span>}
            </div>
          )}

          <div className="settings" role="group" aria-label="Output settings">
            <div className="field">
              <div className="field-head">
                <span className="field-label">Format</span>
                <span className="field-hint">{formatHint}</span>
              </div>
              <div className="segmented" data-value={format}>
                <span className="indicator" aria-hidden="true" />
                <input
                  type="radio"
                  name="format"
                  id="fmt-mp3"
                  value="mp3"
                  checked={format === "mp3"}
                  onChange={() => {
                    setFormat("mp3");
                    logDim("FORMAT mp3");
                  }}
                />
                <label htmlFor="fmt-mp3">MP3</label>
                <input
                  type="radio"
                  name="format"
                  id="fmt-wav"
                  value="wav"
                  checked={format === "wav"}
                  onChange={() => {
                    setFormat("wav");
                    logDim("FORMAT wav");
                  }}
                />
                <label htmlFor="fmt-wav">WAV</label>
              </div>
            </div>

            <div className="field">
              <div className="field-head">
                <span className="field-label">Playlist</span>
                <span className="field-hint">
                  {inspect?.isPlaylist
                    ? `${inspect.count} items`
                    : "Auto detect"}
                </span>
              </div>
              <div className="toggle-row">
                <span>Download every track</span>
                <button
                  type="button"
                  className={`switch ${includePlaylist ? "on" : ""}`}
                  role="switch"
                  aria-checked={includePlaylist}
                  aria-label="Download whole playlist"
                  onClick={() => {
                    setIncludePlaylist((v) => {
                      const next = !v;
                      logDim("PLAYLIST", next ? "on" : "off");
                      return next;
                    });
                  }}
                />
              </div>
            </div>
          </div>

          <div className="action">
            <div className="meta">
              <span className="pill">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <path d="M7 10l5 5 5-5" />
                  <path d="M12 15V3" />
                </svg>
                Saves to browser
              </span>
              <span className="pill">{qualityHint}</span>
            </div>

            {busy ? (
              <button
                type="button"
                className="submit"
                onClick={onCancel}
                style={{ background: "#1d1d1f", boxShadow: "none" }}
              >
                Cancel
              </button>
            ) : (
              <button type="submit" className="submit" disabled={!canSubmit}>
                <span>
                  {phase === "started" || phase === "done"
                    ? "Download another"
                    : "Download"}
                </span>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 12h14" />
                  <path d="M13 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </div>

          <div
            className={`status ${phase !== "idle" ? "open" : ""}`}
            aria-live="polite"
          >
            <div className="status-inner">
              <div className="status-head">
                <div
                  className={`status-title ${
                    phase === "started"
                      ? "done"
                      : phase === "error"
                        ? "failed"
                        : ""
                  }`}
                >
                  <span className="ring" />
                  <span>{statusTitle}</span>
                </div>
                <div className="status-percent">
                  {phase === "preparing"
                    ? "Working…"
                    : phase === "started"
                      ? "Sent"
                      : phase === "error"
                        ? "Failed"
                        : ""}
                </div>
              </div>
              <div
                className={`bar ${
                  phase === "preparing" ? "indeterminate" : ""
                }`}
              >
                <i
                  style={{ width: phase === "started" ? "100%" : undefined }}
                />
              </div>
              <div className="status-log">{errorMsg ?? logLine}</div>
            </div>
          </div>
        </form>

        <Wave />
      </main>

      <footer>
        <span>Saved straight to your Downloads</span>
        <span className="kbd">
          Press <b>⏎</b> to start
        </span>
      </footer>
    </>
  );
}

function Wave() {
  const bars = 64;
  return (
    <div className="wave" aria-hidden="true">
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          style={{
            animationDelay: `${i * 28}ms`,
            animationDuration: `${1400 + (i % 5) * 180}ms`,
          }}
        />
      ))}
    </div>
  );
}
