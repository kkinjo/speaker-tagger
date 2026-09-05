"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "login" | "signup";

export default function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "処理に失敗しました。");
        return;
      }
      router.replace("/projects");
      router.refresh();
    } catch {
      setError("通信に失敗しました。時間をおいて再度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-box card">
        <h1>議事録エディタ</h1>
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}>
          WhisperX の文字起こしを、話者ごとの表に整えるためのエディタです。
          データはログインしたユーザーごとに分かれて保存されます。
        </p>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            onClick={() => {
              setMode("login");
              setError("");
            }}
          >
            ログイン
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signup"}
            onClick={() => {
              setMode("signup");
              setError("");
            }}
          >
            新規登録
          </button>
        </div>

        <form onSubmit={submit}>
          <label>
            ユーザー名
            <input
              type="text"
              value={username}
              autoComplete="username"
              autoFocus
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            パスワード{mode === "signup" ? "（8文字以上）" : ""}
            <input
              type="password"
              value={password}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error ? <div className="error-text">{error}</div> : null}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "処理中…" : mode === "login" ? "ログイン" : "登録してはじめる"}
          </button>
        </form>
      </div>
    </div>
  );
}
