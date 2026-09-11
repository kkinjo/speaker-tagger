"use client";

import { useState } from "react";
import { GLOBAL_GLOSSARY } from "@/lib/glossary";

type Props = {
  glossary: string[];
  onChange: (next: string[]) => void;
};

const GLOBAL_SET = new Set(GLOBAL_GLOSSARY);

/** 1行1語のテキストをまとめて取り込む。空行と前後の空白は落とす */
function parseTerms(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * 会議固有の固有名詞の登録（第6章）。
 * 左列：この会議だけの語（`Project.glossary`、編集可）
 * 右列：全体リスト（`GLOBAL_GLOSSARY`、参考表示・編集不可）
 */
export default function GlossaryPanel({ glossary, onChange }: Props) {
  const [bulk, setBulk] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);

  function remove(term: string) {
    onChange(glossary.filter((t) => t !== term));
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>固有名詞の登録</strong>
        <span className="hint-note">
          ここに登録した語は、整文で言い回しを調整するときに変更されないよう保護されます。
        </span>
        <div className="spacer" />
        <button className="btn btn-sm" onClick={() => setBulkOpen((v) => !v)}>
          まとめて貼り付け
        </button>
      </div>

      {bulkOpen ? (
        <div style={{ marginTop: 10 }}>
          <textarea
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            rows={5}
            placeholder={"1行に1語。例）\n議案名A\n来賓の所属"}
            style={{
              width: "100%",
              fontFamily: "inherit",
              fontSize: 13,
              padding: 8,
              border: "1px solid var(--border-strong)",
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => {
                const added = parseTerms(bulk);
                if (added.length > 0) {
                  const merged = [...glossary];
                  for (const t of added) if (!merged.includes(t)) merged.push(t);
                  onChange(merged);
                }
                setBulk("");
                setBulkOpen(false);
              }}
            >
              この内容で追加
            </button>
            <button className="btn btn-sm" onClick={() => setBulkOpen(false)}>
              閉じる
            </button>
          </div>
        </div>
      ) : null}

      <div className="glossary-columns">
        <div>
          <div className="glossary-col-title">この会議の固有名詞</div>
          {glossary.length === 0 ? (
            <p className="hint-note" style={{ margin: "6px 0 0" }}>
              まだ登録がありません。「まとめて貼り付け」から登録してください。
            </p>
          ) : (
            <ul className="glossary-list">
              {glossary.map((term) => (
                <li key={term}>
                  <span>{term}</span>
                  {GLOBAL_SET.has(term) ? (
                    <span className="hint-note glossary-dup-note">
                      （全体リストに登録済み）
                    </span>
                  ) : null}
                  <button
                    className="btn btn-sm btn-danger"
                    title="削除"
                    onClick={() => remove(term)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="glossary-col-title">全体リスト（参考表示）</div>
          <p className="hint-note" style={{ margin: "6px 0" }}>
            ここにある語は登録不要です。
          </p>
          <ul className="glossary-list glossary-list-readonly">
            {GLOBAL_GLOSSARY.map((term) => (
              <li key={term}>{term}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
