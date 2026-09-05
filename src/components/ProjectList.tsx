"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectSummary } from "@/lib/types";
import { deleteAudio } from "@/editor/audioStore";

function formatDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

export default function ProjectList({
  username,
  initial,
}: {
  username: string;
  initial: ProjectSummary[];
}) {
  const router = useRouter();
  const [projects, setProjects] = useState(initial);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const body = (await res.json()) as { project?: ProjectSummary };
      if (body.project) router.push(`/projects/${body.project.id}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: ProjectSummary) {
    if (!confirm(`「${p.title}」を削除します。よろしいですか？`)) return;
    const res = await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
    if (res.ok) {
      await deleteAudio(p.id);
      setProjects((list) => list.filter((x) => x.id !== p.id));
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <header className="topbar">
        <h1>議事録エディタ</h1>
        <div className="spacer" />
        <span className="muted">{username}</span>
        <button className="btn btn-sm" onClick={logout}>
          ログアウト
        </button>
      </header>

      <main className="page">
        <div className="card">
          <strong style={{ fontSize: 15 }}>新しい議事録をつくる</strong>
          <p className="hint-note" style={{ margin: "6px 0 0" }}>
            会議ごとに1つ作成します。作成後、WhisperX の JSON
            と（あれば）音声ファイルを取り込みます。
          </p>
          <form
            onSubmit={create}
            style={{ display: "flex", gap: 8, marginTop: 12 }}
          >
            <input
              type="text"
              value={title}
              placeholder="例）6月 校内研修 打合せ"
              onChange={(e) => setTitle(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary" disabled={busy}>
              作成する
            </button>
          </form>
        </div>

        <h2 style={{ fontSize: 14, marginTop: 28, marginBottom: 0 }}>
          保存されている議事録（{projects.length}件）
        </h2>

        {projects.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            まだありません。上のフォームから作成してください。
          </p>
        ) : (
          <div className="project-list">
            {projects.map((p) => (
              <div className="project-row" key={p.id}>
                <a className="title" href={`/projects/${p.id}`}>
                  {p.title}
                </a>
                {p.hasAudio ? <span className="badge">音声あり</span> : null}
                <div className="spacer" />
                <span className="muted" style={{ fontSize: 12 }}>
                  更新 {formatDate(p.updatedAt)}
                </span>
                <button className="btn btn-sm btn-danger" onClick={() => remove(p)}>
                  削除
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
