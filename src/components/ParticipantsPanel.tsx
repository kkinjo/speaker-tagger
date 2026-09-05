"use client";

import { useState } from "react";
import type { Participant } from "@/lib/types";

type Props = {
  participants: Participant[];
  onChange: (next: Participant[]) => void;
};

function newParticipantId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** 「宮崎小/河野」「宮崎小 河野」「宮崎小　河野」をまとめて取り込む */
function parseBulk(text: string): Participant[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[/／\t 　]+/).filter(Boolean);
      const name = parts.length > 1 ? parts.slice(1).join(" ") : parts[0];
      const org = parts.length > 1 ? parts[0] : "";
      return { id: newParticipantId(), org, name };
    });
}

export default function ParticipantsPanel({ participants, onChange }: Props) {
  const [bulk, setBulk] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);

  function update(id: string, patch: Partial<Participant>) {
    onChange(participants.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>参加者の登録</strong>
        <span className="hint-note">
          ここに登録した人だけが <kbd>@</kbd> の候補に出ます（所属＋氏名で区別）。
        </span>
        <div className="spacer" />
        <button
          className="btn btn-sm"
          onClick={() =>
            onChange([...participants, { id: newParticipantId(), org: "", name: "" }])
          }
        >
          ＋ 1人追加
        </button>
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
            placeholder={"1行に1人。例）\n宮崎小/河野\n県教委/山田\n宮崎小 田中"}
            style={{
              width: "100%",
              fontFamily: "inherit",
              fontSize: 13,
              padding: 8,
              border: "1px solid var(--border-strong)",
              borderRadius: 8,
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => {
                const added = parseBulk(bulk);
                if (added.length > 0) onChange([...participants, ...added]);
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

      {participants.length === 0 ? (
        <p className="hint-note" style={{ margin: "10px 0 0" }}>
          まだ登録がありません。「＋ 1人追加」または「まとめて貼り付け」から登録してください。
        </p>
      ) : (
        <div className="participant-grid">
          {participants.map((p) => (
            <div className="participant-row" key={p.id}>
              <input
                type="text"
                value={p.org}
                placeholder="所属"
                onChange={(e) => update(p.id, { org: e.target.value })}
              />
              <span className="muted">/</span>
              <input
                type="text"
                value={p.name}
                placeholder="氏名"
                onChange={(e) => update(p.id, { name: e.target.value })}
              />
              <button
                className="btn btn-sm btn-danger"
                title="削除"
                onClick={() => onChange(participants.filter((x) => x.id !== p.id))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
