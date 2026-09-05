import { NextResponse } from "next/server";
import { kv, keys } from "@/lib/kv";
import { currentUser, newId } from "@/lib/auth";
import { listSummaries, upsertIndex } from "@/lib/projects";
import type { Project } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ projects: await listSummaries(user.id) });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { title?: string };
  const now = Date.now();
  const project: Project = {
    id: newId(),
    userId: user.id,
    title: (body.title ?? "").trim() || "新しい議事録",
    createdAt: now,
    updatedAt: now,
    rawText: "",
    participants: [],
    mru: [],
    hints: [],
    audio: null,
    imported: false,
  };

  await kv.set(keys.project(project.id), project);
  await upsertIndex(project);
  return NextResponse.json({ project });
}
