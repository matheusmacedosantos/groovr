import { randomUUID } from "node:crypto";
import { rmJobDir } from "./ytdlp";

export interface JobEntry {
  dir: string;
  file: string;
  mime: string;
  name: string;
  size: number;
  createdAt: number;
}

const jobs = new Map<string, JobEntry>();
const TTL_MS = 10 * 60 * 1000;

let cleanerStarted = false;
function ensureCleaner() {
  if (cleanerStarted) return;
  cleanerStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [id, j] of jobs) {
      if (now - j.createdAt > TTL_MS) {
        jobs.delete(id);
        void rmJobDir(j.dir);
      }
    }
  }, 60_000).unref();
}

export function createJob(entry: Omit<JobEntry, "createdAt">): string {
  ensureCleaner();
  const id = randomUUID();
  jobs.set(id, { ...entry, createdAt: Date.now() });
  return id;
}

export function consumeJob(id: string): JobEntry | undefined {
  const entry = jobs.get(id);
  if (entry) jobs.delete(id);
  return entry;
}
