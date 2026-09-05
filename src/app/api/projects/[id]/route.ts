import { NextResponse } from "next/server";
import { kv, keys } from "@/lib/kv";
import { currentUser } from "@/lib/auth";
import { loadOwned, removeFromIndex, upsertIndex } from "@/lib/projects";
import type { Participant, Project } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const project = await loadOwned(id, user.id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ project, settings: user.settings });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const project = await loadOwned(id, user.id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const patch = (await req.json()) as Partial<Project>;
  const next: Project = { ...project };

  if (typeof patch.title === "string") next.title = patch.title.trim() || next.title;
  if (typeof patch.rawText === "string") next.rawText = patch.rawText;
  if (Array.isArray(patch.participants)) {
    next.participants = patch.participants
      .filter((p): p is Participant => Boolean(p && typeof p.id === "string"))
      .map((p) => ({
        id: p.id,
        org: String(p.org ?? "").trim(),
        name: String(p.name ?? "").trim(),
      }))
      .filter((p) => p.name.length > 0 || p.org.length > 0);
  }
  if (Array.isArray(patch.mru)) next.mru = patch.mru.filter((m) => typeof m === "string");
  if (patch.audio === null || (patch.audio && typeof patch.audio === "object")) {
    next.audio = patch.audio;
  }
  next.updatedAt = Date.now();

  await kv.set(keys.project(next.id), next);
  await upsertIndex(next);
  return NextResponse.json({ savedAt: next.updatedAt });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const project = await loadOwned(id, user.id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  await kv.del(keys.projectWords(id));
  await kv.del(keys.project(id));
  await removeFromIndex(user.id, id);
  return NextResponse.json({ ok: true });
}
