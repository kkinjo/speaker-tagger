/**
 * 編集後テキストと WhisperX 原文の対応づけ。
 *
 * 人が話者を差し込んだり誤変換を直したりしても、単語単位タイムスタンプを
 * 見失わないようにするための照合処理。文字数比による按分は一切行わず、
 * 「編集後の文字がどの単語に由来するか」を突き合わせてから、その単語が持つ
 * 実際の時刻をそのまま使う。
 */

/** 再同期を探す範囲 (文字数) */
const WINDOW = 400;
/** 再同期とみなすのに必要な連続一致数 */
const RUN = 4;

function matchRun(
  a: string,
  ia: number,
  b: string,
  jb: number,
  k: number
): boolean {
  if (ia + k > a.length || jb + k > b.length) return false;
  for (let t = 0; t < k; t++) {
    if (a[ia + t] !== b[jb + t]) return false;
  }
  return true;
}

/**
 * edit の各文字が orig の何文字目に対応するかを返す。対応が取れない文字は -1。
 * 常に単調増加になるので、ブロックの前後関係が入れ替わることはない。
 */
export function alignNorm(edit: string, orig: string): Int32Array {
  const map = new Int32Array(edit.length).fill(-1);
  let i = 0;
  let j = 0;

  while (i < edit.length && j < orig.length) {
    if (edit[i] === orig[j]) {
      map[i] = j;
      i++;
      j++;
      continue;
    }
    // ずれた地点から、両側を少しずつ広げて連続一致する位置を探す
    let resynced = false;
    for (let d = 1; d <= WINDOW && !resynced; d++) {
      if (matchRun(edit, i + d, orig, j, RUN)) {
        i += d; // 編集側で加筆された分を読み飛ばす
        resynced = true;
      } else if (matchRun(edit, i, orig, j + d, RUN)) {
        j += d; // 編集側で削られた分を読み飛ばす
        resynced = true;
      }
    }
    if (!resynced) i++; // 対応不明の 1 文字として諦める
  }
  return map;
}

export type BlockTime = { start: number | null; end: number | null };

/**
 * ブロックごとの開始/終了時刻を求める。
 * @param normBlock norm の各文字が属するブロック番号
 * @param map alignNorm の結果
 * @param normWordIdx 原文の各文字が属する単語番号
 * @param words 単語ごとの時刻
 */
export function blockTimes(
  blockCount: number,
  normBlock: number[],
  map: Int32Array,
  normWordIdx: number[],
  words: { s: number | null; e: number | null }[]
): BlockTime[] {
  const first: number[] = new Array(blockCount).fill(-1);
  const last: number[] = new Array(blockCount).fill(-1);

  for (let i = 0; i < map.length; i++) {
    const o = map[i];
    if (o < 0) continue;
    const b = normBlock[i];
    if (b == null) continue;
    if (first[b] < 0) first[b] = o;
    last[b] = o;
  }

  const times: BlockTime[] = [];
  for (let b = 0; b < blockCount; b++) {
    if (first[b] < 0) {
      times.push({ start: null, end: null });
      continue;
    }
    times.push({
      start: startTimeOfChar(first[b], normWordIdx, words),
      end: endTimeOfChar(last[b], normWordIdx, words),
    });
  }
  return times;
}

/** タイムスタンプ欠損語があるので、前後の語まで探して実測値を拾う */
function startTimeOfChar(
  charIdx: number,
  normWordIdx: number[],
  words: { s: number | null; e: number | null }[]
): number | null {
  const w = normWordIdx[charIdx];
  if (w == null) return null;
  for (let k = w; k < words.length; k++) {
    if (words[k]?.s != null) return words[k].s;
  }
  for (let k = w; k >= 0; k--) {
    if (words[k]?.e != null) return words[k].e;
  }
  return null;
}

function endTimeOfChar(
  charIdx: number,
  normWordIdx: number[],
  words: { s: number | null; e: number | null }[]
): number | null {
  const w = normWordIdx[charIdx];
  if (w == null) return null;
  for (let k = w; k >= 0; k--) {
    if (words[k]?.e != null) return words[k].e;
  }
  for (let k = w; k < words.length; k++) {
    if (words[k]?.s != null) return words[k].s;
  }
  return null;
}

/**
 * 原文オフセット (話者交代のヒント位置) を編集後テキストの位置へ写す。
 * 対応が取れなかったヒントは捨てる。
 */
export function mapHintsToEditor(
  hints: number[],
  map: Int32Array,
  normOffsets: number[]
): number[] {
  if (hints.length === 0 || map.length === 0) return [];
  // orig -> edit の逆引きを作る
  const inverse = new Map<number, number>();
  for (let i = map.length - 1; i >= 0; i--) {
    if (map[i] >= 0) inverse.set(map[i], i);
  }
  const out: number[] = [];
  for (const h of hints) {
    // 完全一致が無ければ少し後ろ側を探す
    let editIdx: number | undefined;
    for (let d = 0; d < 40 && editIdx === undefined; d++) {
      editIdx = inverse.get(h + d);
    }
    if (editIdx === undefined) continue;
    const offset = normOffsets[editIdx];
    if (offset != null) out.push(offset);
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}
