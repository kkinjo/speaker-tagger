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
  /**
   * このブロックが何秒の発言か (秒)。直前の区切り記号 `--@12.3` に
   * 書かれている値をそのまま使う。時刻の無い区切り (`--`) や、
   * 先頭ブロックのように前に区切りが無い場合は null。
   *
   * 本文の編集では変わらない。単語データから引き直すと、編集のたびに
   * 対応が崩れて連動位置が飛ぶため、区切り記号に焼き付けている。
   */
  time: number | null;
};

export type ParsedDoc = {
  blocks: Block[];
  /** 全発言ブロック本文を連結し空白を除いた文字列 */
  norm: string;
  /** norm の各文字の rawText 内オフセット */
  normOffsets: number[];
};

export const SEPARATOR = "--";
/** `--` / `----` / `--@12.3` のいずれも区切りとして扱う */
const SEP_RE = /^[ \t　]*-{2,}[ \t　]*(?:@[ \t　]*(\d+(?:\.\d+)?))?[ \t　]*$/;
const HEADING_RE = /^[ \t　]*#+[ \t　]*/;

export function isSeparatorLine(line: string): boolean {
  return SEP_RE.test(line);
}

/** 区切り行に書かれた時刻 (秒)。`--` だけなら null */
export function separatorTime(line: string): number | null {
  const m = SEP_RE.exec(line);
  if (!m || m[1] === undefined) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

/** 時刻付きの区切り行を作る。時刻が分からないときは `--` のまま */
export function separatorLine(time: number | null): string {
  if (time == null || !Number.isFinite(time) || time < 0) return SEPARATOR;
  // 10ms より細かい桁は音声の頭出しに使わないので落とす
  return `${SEPARATOR}@${Math.round(time * 100) / 100}`;
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
  // 長いラベルから試すことで「●●小/太田」と「太田」の取り違えを防ぐ
  const labels = participants
    .map(participantLabel)
    .filter((l) => l.length > 0)
    .sort((a, b) => b.length - a.length);

  const lines = splitLines(raw);
  const blocks: Block[] = [];
  const norm: string[] = [];
  const normOffsets: number[] = [];

  let pendingStart = 0;
  let pendingEnd = 0;
  let hasPending = false;
  /** 直前に読んだ区切り記号の時刻。次に出来るブロックの時刻になる */
  let pendingTime: number | null = null;

  const flush = () => {
    if (!hasPending) return;
    hasPending = false;
    if (raw.slice(pendingStart, pendingEnd).trim().length === 0) return;
    const index = blocks.length;
    const extracted = extractBlock(raw, pendingStart, pendingEnd, labels, norm, normOffsets);
    blocks.push({
      index,
      kind: "utterance",
      start: pendingStart,
      end: pendingEnd,
      heading: "",
      time: pendingTime,
      ...extracted,
    });
    // 一度使った時刻は次のブロックへ引き継がない (前のブロックの時刻を
    // 継承すると、区切りを消したときに嘘の位置を指してしまう)
    pendingTime = null;
  };

  for (const line of lines) {
    if (isSeparatorLine(line.text)) {
      flush();
      pendingTime = separatorTime(line.text);
      continue;
    }
    if (isHeadingLine(line.text)) {
      // 見出しは時刻を持たないが、区切りの時刻は消さない。
      // `--@12.3` の直後に議題見出しを足しても、続く発言の時刻が残るようにする
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
        time: null,
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

  return { blocks, norm: norm.join(""), normOffsets };
}

/**
 * 再生位置に対応するブロック番号を返す。
 *
 * 時刻が `currentTime` 以下である最後のブロック。時刻を持たないブロックは
 * 対象外として飛ばす。ブロックは時刻順に並んでいる前提。
 */
export function blockAtTime(
  blocks: Block[],
  currentTime: number,
  tolerance = 0.05
): number | null {
  let found: number | null = null;
  for (const b of blocks) {
    if (b.time == null) continue;
    if (b.time <= currentTime + tolerance) found = b.index;
    else break;
  }
  return found;
}

/** 1 ブロック分の範囲から話者メンションと本文を取り出す */
function extractBlock(
  raw: string,
  start: number,
  end: number,
  labels: string[],
  norm: string[],
  normOffsets: number[]
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
