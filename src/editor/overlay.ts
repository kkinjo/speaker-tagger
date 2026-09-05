import {
  isHeadingLine,
  isSeparatorLine,
  splitLines,
  type ParsedDoc,
} from "./parse";

export type OverlayInput = {
  raw: string;
  doc: ParsedDoc;
  /** 話者交代のヒント位置 (rawText 内オフセット) */
  hints: number[];
  /** 音声再生中のブロック */
  activeBlock: number | null;
  /** カーソルのあるブロック */
  caretBlock: number | null;
};

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function escape(input: string): string {
  // 日本語の本文はほとんど該当しないので、まず含むかどうかだけ見る
  return /[&<>"]/.test(input)
    ? input.replace(/[&<>"]/g, (c) => ESCAPES[c])
    : input;
}

const HINT_SPAN =
  '<span class="ov-hint" title="pyannote が話者交代を検知した位置"></span>';

/**
 * テキストエリアの背後に敷く装飾レイヤを、1 行 1 要素の HTML として組み立てる。
 *
 * テキストエリア本体の文字はそのまま表示させ、この層では
 * 背景・区切り線・話者チップ・ヒントだけを描く。日本語入力の変換中の文字が
 * 見えなくなる問題を避けるための構成で、装飾はすべて幅を持たない。
 * この層の高さがそのまま編集領域の高さになる。
 *
 * 行ごとに配列で返すのは、変わった行だけを差し替えるため。
 * 1時間分の文字起こしでは 5000 行前後になり、毎回まるごと入れ替えると
 * ブラウザのレイアウト計算だけで 1 文字あたり 200ms 以上かかってしまう。
 */
export function buildOverlayLines(input: OverlayInput): string[] {
  const { raw, doc, hints, activeBlock, caretBlock } = input;
  const lines = splitLines(raw);

  // 行 -> ブロックの対応と、ブロック先頭行の判定。
  // 行もブロックも位置順に並んでいるので、両方を1回ずつ舐めて対応づける
  // (総当たりにすると1時間分の文字起こしで入力が固まる)。
  const lineBlock = new Array<number>(lines.length).fill(-1);
  const blockFirstLine = new Array<number>(doc.blocks.length).fill(-1);
  let bi = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    while (bi < doc.blocks.length && doc.blocks[bi].end < line.end) bi++;
    const b = doc.blocks[bi];
    if (b && line.start >= b.start && line.end <= b.end) {
      lineBlock[li] = b.index;
      if (blockFirstLine[b.index] < 0) blockFirstLine[b.index] = li;
    }
  }

  // 文字位置ごとに差し込むタグをまとめる。1文字ずつ調べると長文で遅くなるため、
  // 差し込みのある位置だけを並べ、その間はまとめて切り出す。
  const insertAt = new Map<number, string>();
  const addInsert = (at: number, html: string, before: boolean) => {
    const current = insertAt.get(at);
    if (current === undefined) insertAt.set(at, html);
    else insertAt.set(at, before ? html + current : current + html);
  };
  for (const b of doc.blocks) {
    for (const m of b.mentions) {
      addInsert(
        m.start,
        `<span class="ov-mention${m.known ? "" : " ov-mention-unknown"}">`,
        false
      );
      addInsert(m.end, "</span>", true);
    }
  }
  for (const h of hints) addInsert(h, HINT_SPAN, false);

  const offsets = [...insertAt.keys()].sort((a, b) => a - b);

  const out: string[] = [];
  const parts: string[] = [];
  let oi = 0;
  for (let li = 0; li < lines.length; li++) {
    parts.length = 0;
    const line = lines[li];
    const classes = ["ov-line"];
    const blockIdx = lineBlock[li];
    const block = blockIdx >= 0 ? doc.blocks[blockIdx] : null;

    if (isSeparatorLine(line.text)) {
      classes.push("ov-sep");
    } else if (block?.kind === "heading" || isHeadingLine(line.text)) {
      classes.push("ov-head");
    } else if (block) {
      if (blockFirstLine[block.index] === li) {
        classes.push(block.speakers.length > 0 ? "ov-done" : "ov-todo");
      }
      if (block.index === activeBlock) classes.push("ov-active");
      if (block.index === caretBlock) classes.push("ov-caret-block");
    }

    // 行番号は属性に持たせない。属性に入れると 1 行挿入しただけで
    // 以降の全行が「変わった行」になり、差分更新の意味がなくなる。
    parts.push(`<div class="${classes.join(" ")}">`);

    while (oi < offsets.length && offsets[oi] < line.start) oi++;
    if (oi < offsets.length && offsets[oi] <= line.end) {
      let cursor = line.start;
      let hasText = false;
      while (oi < offsets.length && offsets[oi] <= line.end) {
        const at = offsets[oi];
        if (at > cursor) {
          parts.push(escape(raw.slice(cursor, at)));
          hasText = true;
          cursor = at;
        }
        parts.push(insertAt.get(at)!);
        oi++;
      }
      if (cursor < line.end) {
        parts.push(escape(raw.slice(cursor, line.end)));
        hasText = true;
      }
      // 装飾だけの行や空行でも 1 行分の高さを保つ
      if (!hasText) parts.push("&nbsp;");
    } else if (line.end > line.start) {
      parts.push(escape(line.text));
    } else {
      parts.push("&nbsp;");
    }

    parts.push("</div>");
    out.push(parts.join(""));
  }

  return out;
}

/**
 * 前回の行配列と比べ、変わったところだけ DOM を差し替える。
 * 先頭と末尾の一致部分は触らないので、1 行だけ書き換えたときは
 * その 1 要素の入れ替えで済む。
 */
export function patchOverlay(
  container: HTMLElement,
  prev: string[],
  next: string[]
): void {
  const children = container.children;
  if (children.length !== prev.length) {
    // 想定外の状態になっていたら作り直す
    container.innerHTML = next.join("");
    return;
  }

  let head = 0;
  const limit = Math.min(prev.length, next.length);
  while (head < limit && prev[head] === next[head]) head++;

  let tail = 0;
  while (
    tail < limit - head &&
    prev[prev.length - 1 - tail] === next[next.length - 1 - tail]
  ) {
    tail++;
  }

  const removeCount = prev.length - head - tail;
  const insert = next.slice(head, next.length - tail);

  const anchor = children[head + removeCount] ?? null;
  for (let i = 0; i < removeCount; i++) children[head].remove();

  if (insert.length > 0) {
    const tpl = document.createElement("template");
    tpl.innerHTML = insert.join("");
    container.insertBefore(tpl.content, anchor);
  }
}
