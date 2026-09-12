"use client";

import { useState } from "react";
import type { Participant } from "@/lib/types";
import { participantLabel } from "@/editor/parse";

type Props = {
  participants: Participant[];
  onChange: (next: Participant[]) => void;
};

function newParticipantId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** 「●●小/太田」「●●小 太田」「●●小　太田」をまとめて取り込む */
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

/** 参加者リストをテキストへ戻す。parseBulk で読み直すと同じ並びになる */
function toText(participants: Participant[]): string {
  return participants
    .map((p) => (p.org ? `${p.org}/${p.name}` : p.name))
    .join("\n");
}

/**
 * 解析し直した参加者に、元の id を引き継がせる。
 *
 * 直近に使った話者の順（`Project.mru`）は participant の id で紐づいているため、
 * 毎回新しい id を振ると、テキストを触るたびに候補の並びが初期化されてしまう。
 * 所属・氏名が変わっていない人はそのまま同じ人とみなす。
 * 同姓同所属が複数いる場合は、上から順に1つずつ割り当てる。
 */
function keepIds(parsed: Participant[], previous: Participant[]): Participant[] {
  const byLabel = new Map<string, string[]>();
  for (const p of previous) {
    const label = participantLabel(p);
    const ids = byLabel.get(label);
    if (ids) ids.push(p.id);
    else byLabel.set(label, [p.id]);
  }
  return parsed.map((p) => {
    const id = byLabel.get(participantLabel(p))?.shift();
    return id ? { ...p, id } : p;
  });
}

function same(a: Participant[], b: Participant[]): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => p.id === b[i].id && p.org === b[i].org && p.name === b[i].name)
  );
}

/**
 * 参加者の登録。1行1人のテキストエリア1つで、追加も修正も削除も行う。
 *
 * 個別の入力欄を人数分並べる作りだと、30名で縦に伸びてドロワーが
 * 使い物にならなくなる。高さを10行分で固定し、超えた分は中でスクロールさせる。
 */
export default function ParticipantsPanel({ participants, onChange }: Props) {
  const [text, setText] = useState(() => toText(participants));

  /**
   * 入力のたびに解析すると、打ちかけの文字列で参加者が登録されてしまう。
   * フォーカスが外れた時点で確定する。
   *
   * テキストは整形し直さない（「●●小 太田」と打ったものを
   * 「●●小/太田」に書き換えない）。打ったとおりが残るほうが予測しやすい。
   */
  function commit() {
    const next = keepIds(parseBulk(text), participants);
    if (!same(next, participants)) onChange(next);
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>参加者の登録</strong>
        <span className="hint-note">
          ここに登録した人だけが <kbd>@</kbd> の候補に出ます（所属＋氏名で区別）。
        </span>
      </div>

      <textarea
        className="participant-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        rows={10}
        placeholder={"1行に1人。例）\n●●小/太田\n県教委/山田\n●●小 田中"}
        aria-label="参加者（1行に1人）"
      />

      <p className="hint-note participant-note">
        <strong>{participants.length}</strong>名 登録済み
      </p>
      <p className="hint-note participant-note">
        所属・氏名を変更すると、既にその人に割り当てた <kbd>@</kbd> は外れます。
      </p>
    </div>
  );
}
