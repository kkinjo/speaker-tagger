import type { Participant } from "@/lib/types";

export type BlockKind = "utterance" | "heading";

/** rawText 内の @メンションの範囲 (`@` を含む) */
export type MentionRange = {
  start: number;
  end: number;
  label: string;
  /** 事前登録済みの参加者と一致したか */
  known: boolean;
};

export type Block = {
  index: number;
  kind: BlockKind;
  /** rawText 内の範囲 (区切り線は含まない) */
  start: number;
  end: number;
  /** 見出しブロックの表示文字列 */
  heading: string;
  /** 割り当てられた話者ラベル。重なり発言では複数入りうる */
  speakers: string[];
  /** @メンションを除いた本文 (改行は保持する) */
  body: string;
  mentions: MentionRange[];
};

export type ParsedDoc = {
  blocks: Block[];
  /** 全発言ブロック本文を連結し空白を除いた文字列 */
  norm: string;
  /** norm の各文字の rawText 内オフセット */
  normOffsets: number[];
  /** norm の各文字が属するブロック番号 */
  normBlock: number[];
};

export const SEPARATOR = "--";
const SEP_RE = /^[ \t　]*-{2,}[ \t　]*$/;
const HEADING_RE = /^[ \t　]*#+[ \t　]*/;

export function isSeparatorLine(line: string): boolean {
  return SEP_RE.test(line);
}

export function isHeadingLine(line: string): boolean {
  return HEADING_RE.test(line);
}

export function participantLabel(p: Participant): string {
  return p.org ? `${p.org}/${p.name}` : p.name;
}

/** 空白として無視する文字 (半角/全角スペース、改行、タブ) */
function isSkippable(ch: string): boolean {
  return (
    ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "　"
  );
}

export type LineInfo = { text: string; start: number; end: number };

export function splitLines(raw: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let start = 0;
  for (let i = 0; i <= raw.length; i++) {
    if (i === raw.length || raw[i] === "\n") {
      lines.push({ text: raw.slice(start, i), start, end: i });
      start = i + 1;
    }
  }
  return lines;
}

/**
 * 生テキストをブロックへ分解する。
 *
 * - `--` だけの行は発言の区切り
 * - `#` で始まる行は議題見出し (話者を持たない単独ブロック)
 * - `@所属/氏名` は事前登録済み参加者との一致で話者として解釈する
 */
export function parseDoc(raw: string, participants: Participant[]): ParsedDoc {
  // 長いラベルから試すことで「宮崎小/河野」と「河野」の取り違えを防ぐ
  const labels = participants
    .map(participantLabel)
    .filter((l) => l.length > 0)
    .sort((a, b) => b.length - a.length);

  const lines = splitLines(raw);
  const blocks: Block[] = [];
  const norm: string[] = [];
  const normOffsets: number[] = [];
  const normBlock: number[] = [];

  let pendingStart = 0;
  let pendingEnd = 0;
  let hasPending = false;

  const flush = () => {
    if (!hasPending) return;
    hasPending = false;
    if (raw.slice(pendingStart, pendingEnd).trim().length === 0) return;
    const index = blocks.length;
    const extracted = extractBlock(
      raw,
      pendingStart,
      pendingEnd,
      labels,
      index,
      norm,
      normOffsets,
      normBlock
    );
    blocks.push({
      index,
      kind: "utterance",
      start: pendingStart,
      end: pendingEnd,
      heading: "",
      ...extracted,
    });
  };

  for (const line of lines) {
    if (isSeparatorLine(line.text)) {
      flush();
      continue;
    }
    if (isHeadingLine(line.text)) {
      flush();
      blocks.push({
        index: blocks.length,
        kind: "heading",
        start: line.start,
        end: line.end,
        heading: line.text.replace(HEADING_RE, "").trim(),
        speakers: [],
        body: "",
        mentions: [],
      });
      continue;
    }
    if (!hasPending) {
      hasPending = true;
      pendingStart = line.start;
    }
    pendingEnd = line.end;
  }
  flush();

  return { blocks, norm: norm.join(""), normOffsets, normBlock };
}

/** 1 ブロック分の範囲から話者メンションと本文を取り出す */
function extractBlock(
  raw: string,
  start: number,
  end: number,
  labels: string[],
  blockIndex: number,
  norm: string[],
  normOffsets: number[],
  normBlock: number[]
): { speakers: string[]; body: string; mentions: MentionRange[] } {
  const speakers: string[] = [];
  const mentions: MentionRange[] = [];
  const bodyChars: string[] = [];

  let i = start;
  while (i < end) {
    if (raw[i] === "@") {
      const label = matchMention(raw, i, end, labels);
      if (label) {
        if (!speakers.includes(label)) speakers.push(label);
        mentions.push({ start: i, end: i + 1 + label.length, label, known: true });
        i += label.length + 1;
        // メンション直後の空白1つは表示上の区切りなので本文から落とす
        if (i < end && (raw[i] === " " || raw[i] === "　")) i++;
        continue;
      }
      // 登録されていない `@` は話者にしない。日本語は語の切れ目に空白が
      // 無いため、当てずっぽうに拾うと一文まるごと氏名になってしまう。
      // 印だけ付けて本文として残し、打ち間違いに気づけるようにする。
      mentions.push({ start: i, end: i + 1, label: "", known: false });
    }
    const ch = raw[i];
    bodyChars.push(ch);
    if (!isSkippable(ch)) {
      norm.push(ch);
      normOffsets.push(i);
      normBlock.push(blockIndex);
    }
    i++;
  }

  return {
    speakers,
    body: bodyChars.join("").replace(/^[\s　]+|[\s　]+$/g, ""),
    mentions,
  };
}

/** `@` の直後が事前登録した参加者と一致するかを見る */
function matchMention(
  raw: string,
  at: number,
  end: number,
  labels: string[]
): string | null {
  for (const label of labels) {
    if (at + 1 + label.length <= end && raw.startsWith(label, at + 1)) {
      return label;
    }
  }
  return null;
}

/** rawText 内のオフセットが属するブロックを返す */
export function blockAtOffset(doc: ParsedDoc, offset: number): Block | null {
  for (const b of doc.blocks) {
    if (offset >= b.start && offset <= b.end) return b;
  }
  return null;
}

/** 話者未割り当ての発言ブロック */
export function unassignedBlocks(doc: ParsedDoc): Block[] {
  return doc.blocks.filter(
    (b) => b.kind === "utterance" && b.speakers.length === 0
  );
}
