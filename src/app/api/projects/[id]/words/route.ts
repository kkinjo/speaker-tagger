import { NextResponse } from "next/server";
import { kv, keys } from "@/lib/kv";
import { currentUser } from "@/lib/auth";
import { loadOwned, upsertIndex } from "@/lib/projects";
import type { ProjectWords } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const project = await loadOwned(id, user.id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  const data = await kv.get<ProjectWords>(keys.projectWords(id));
  return NextResponse.json({ data });
}

/** WhisperX JSON 取り込み。単語列は量が多いので本体とは別レコードに保存する */
export async function PUT(req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const project = await loadOwned(id, user.id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json()) as {
    data?: ProjectWords;
    rawText?: string;
    hints?: number[];
    title?: string;
  };
  if (!body.data || !Array.isArray(body.data.words)) {
    return NextResponse.json({ error: "単語データがありません。" }, { status: 400 });
  }

  await kv.set(keys.projectWords(id), body.data);

  const next = {
    ...project,
    rawText: typeof body.rawText === "string" ? body.rawText : project.rawText,
    hints: Array.isArray(body.hints) ? body.hints : [],
    title: (body.title ?? "").trim() || project.title,
    imported: true,
    updatedAt: Date.now(),
  };
  await kv.set(keys.project(id), next);
  await upsertIndex(next);

  return NextResponse.json({ project: next });
}
