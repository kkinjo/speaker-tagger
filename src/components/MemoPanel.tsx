"use client";

import { useEffect, useRef, useState } from "react";

/**
 * プロジェクト単位のメモ（`Project.memo`）。①話者整理・②整文で共通の部品。
 *
 * 参加者の正式名称・フルネームや、誤変換されやすい語を担当者が参照するためのもの。
 * 人が読むためのもので、整文の AI には渡さない（固有名詞リストとは別物）。
 *
 * - 画面の隅に `position: fixed` で浮かせる。開いても下の表・編集欄は動かさず、上に重ねる
 * - 閉じているときは小さなタブ「メモ」だけを出す
 * - 中身はプレーンテキストの textarea 1つ。解析・整形はせず、打ったものをそのまま渡す
 * - 保存は親（各画面の既存の保存処理）に任せる。ここは値を上げるだけ
 * - 開閉状態だけはこの部品が `UserSettings.memoOpen` へ直接保存する（①②で共通の値）
 */
export default function MemoPanel({
  value,
  onChange,
  initialOpen,
  position,
}: {
  value: string;
  onChange: (value: string) => void;
  /** UserSettings.memoOpen */
  initialOpen: boolean;
  /** ①は右下、②は左下 */
  position: "bottom-right" | "bottom-left";
}) {
  const [open, setOpen] = useState(initialOpen);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const wantFocus = useRef(false);

  // 内容に合わせて伸ばす。上限（画面の 1/3 程度）は CSS の max-height で抑え、
  // 超えた分は textarea の中でスクロールさせる
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value, open]);

  useEffect(() => {
    if (open && wantFocus.current) {
      wantFocus.current = false;
      taRef.current?.focus();
    }
  }, [open]);

  const toggle = (next: boolean) => {
    wantFocus.current = next;
    setOpen(next);
    // 他の設定は送らない。サーバー側で既存の設定に重ねるので、
    // ③専用の設定（exportIncludeTime など）を古い値で上書きしない
    void fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memoOpen: next }),
      keepalive: true,
    });
  };

  const cls = `memo-panel memo-${position}`;

  if (!open) {
    return (
      <div className={cls}>
        <button
          className="btn btn-sm memo-tab"
          onClick={() => toggle(true)}
          aria-expanded={false}
          title="この会議のメモを開く"
        >
          メモ
        </button>
      </div>
    );
  }

  return (
    <section className={`${cls} memo-open`} aria-label="メモ">
      <div className="memo-head">
        <strong>メモ</strong>
        <span className="muted">担当者用。整文の AI には渡しません</span>
        <div className="spacer" />
        <button
          className="btn btn-sm"
          onClick={() => toggle(false)}
          aria-expanded={true}
        >
          閉じる
        </button>
      </div>
      <textarea
        ref={taRef}
        className="memo-text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="参加者の正式名称・フルネーム、誤変換されやすい語など"
        aria-label="メモ"
        rows={6}
        spellCheck={false}
      />
    </section>
  );
}
