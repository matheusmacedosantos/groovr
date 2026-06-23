import { NextRequest, NextResponse } from "next/server";
import { inspectUrl, isYouTubeUrl } from "@/lib/ytdlp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const url = body.url?.trim();
  if (!url || !isYouTubeUrl(url)) {
    return NextResponse.json(
      { error: "Please provide a valid YouTube URL." },
      { status: 400 },
    );
  }

  try {
    const info = await inspectUrl(url);
    return NextResponse.json(info);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to inspect URL";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
