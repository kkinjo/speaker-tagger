import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { loadOwned } from "@/lib/projects";
import { refine, RefineError } from "@/lib/refine";

export const dynamic = "force-dynamic";

/**
 * POST /api/refine
 *
 * 1発言を整文して返す。
 * 認証と所有者チェックを必ず通し、他人のプロジェクトを整文できないようにする（第5.1章）。
 *
 * 固有名詞・参加者・プリセットはリクエストで受け取らず、サーバー側で
 * 読み直したプロジェクトから取る。クライアントから差し替えられないようにするため。
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: {
    projectId?: string;
    body?: string;
    prevBody?: string;
    nextBody?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { projectId, body, prevBody, nextBody } = payload;

  if (typeof projectId !== "string" || typeof body !== "string" || !body.trim()) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const project = await loadOwned(projectId, user.id);
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // 参加者は「所属/氏名」の形でプロンプトへ渡す（第5.3章）。
  // Participant.org は空文字のことがあるので、その場合は氏名だけにする
  const participants = project.participants.map((p) =>
    p.org ? `${p.org}/${p.name}` : p.name,
  );

  try {
    const text = await refine({
      body,
      prevBody: typeof prevBody === "string" ? prevBody : undefined,
      nextBody: typeof nextBody === "string" ? nextBody : undefined,
      participants,
      projectGlossary: project.glossary,
      presetId: project.promptPresetId,
    });
    return NextResponse.json({ text });
  } catch (e) {
    if (e instanceof RefineError && e.status) {
      // 429 はクライアント側でループを停止させる。リトライはしない（第5.5章）
      // 5xx はクライアント側で1回だけリトライする
      // 422 は max_tokens で打ち切られた場合。リトライしても再発しやすいため、
      // クライアント側では1回で「失敗」にして次の行へ進む
      console.error("[refine]", e.message);
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[refine]", e);
    return NextResponse.json(
      { error: e instanceof RefineError ? e.message : "refine failed" },
      { status: 500 },
    );
  }
}
