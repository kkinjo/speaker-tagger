import type { ProjectWords, Word } from "@/lib/types";

type RawWord = {
  word?: string;
  text?: string;
  start?: number;
  end?: number;
  speaker?: string;
};

type RawSegment = {
  text?: string;
  start?: number;
  end?: number;
  speaker?: string;
  words?: RawWord[];
};

type RawJson = {
  segments?: RawSegment[];
  word_segments?: RawWord[];
  language?: string;
};

export type ImportResult = {
  words: Word[];
  norm: string;
  normWordIdx: number[];
  /** 話者が切り替わった位置 (norm の文字オフセット) */
  hints: number[];
  /** 左ペインの初期テキスト */
  rawText: string;
  /** 取り込み結果の要約 (画面表示用) */
  summary: {
    wordCount: number;
    segmentCount: number;
    speakerCount: number;
    duration: number | null;
    hasWordTimestamps: boolean;
  };
};

function wordText(w: RawWord): string {
  return (w.word ?? w.text ?? "").trim();
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * WhisperX の JSON を取り込む。
 * `segments[].words[]` を最優先し、無ければ `word_segments`、
 * それも無ければセグメント単位にフォールバックする。
 */
export function importWhisperX(
  json: unknown,
  options: { insertSeparatorsAtSpeakerChange: boolean }
): ImportResult {
  const data = json as RawJson;
  if (!data || typeof data !== "object") {
    throw new Error("JSON の形式が読み取れませんでした。");
  }

  const segments = Array.isArray(data.segments) ? data.segments : [];
  const words: Word[] = [];
  /** 各セグメントが words 配列のどこから始まるか */
  const segmentWordStart: number[] = [];
  const segmentSpeaker: (string | undefined)[] = [];
  const segmentText: string[] = [];
  let hasWordTimestamps = false;

  if (segments.length > 0) {
    for (const seg of segments) {
      segmentWordStart.push(words.length);
      segmentSpeaker.push(seg.speaker);
      const list = Array.isArray(seg.words) ? seg.words : [];
      if (list.length > 0) {
        for (const w of list) {
          const t = wordText(w);
          if (!t) continue;
          if (num(w.start) != null) hasWordTimestamps = true;
          words.push({
            w: t,
            s: num(w.start),
            e: num(w.end),
            spk: w.speaker ?? seg.speaker,
          });
        }
      } else {
        const t = (seg.text ?? "").trim();
        if (t) {
          words.push({
            w: t,
            s: num(seg.start),
            e: num(seg.end),
            spk: seg.speaker,
          });
        }
      }
      segmentText.push(
        (seg.text ?? "").trim() ||
          words
            .slice(segmentWordStart[segmentWordStart.length - 1])
            .map((w) => w.w)
            .join("")
      );
    }
  } else if (Array.isArray(data.word_segments)) {
    for (const w of data.word_segments) {
      const t = wordText(w);
      if (!t) continue;
      if (num(w.start) != null) hasWordTimestamps = true;
      words.push({ w: t, s: num(w.start), e: num(w.end), spk: w.speaker });
    }
    segmentWordStart.push(0);
    segmentSpeaker.push(words[0]?.spk);
    segmentText.push(words.map((w) => w.w).join(""));
  }

  if (words.length === 0) {
    throw new Error(
      "単語データが見つかりませんでした。WhisperX の出力 JSON かご確認ください。"
    );
  }

  const { norm, normWordIdx } = buildNorm(words);

  // 話者が切り替わる語の先頭文字を、区切り候補のヒント位置とする
  const hints: number[] = [];
  const wordCharStart = new Array<number>(words.length).fill(-1);
  for (let c = 0; c < normWordIdx.length; c++) {
    const w = normWordIdx[c];
    if (wordCharStart[w] < 0) wordCharStart[w] = c;
  }
  let prevSpeaker: string | undefined;
  for (let i = 0; i < words.length; i++) {
    const spk = words[i].spk;
    if (i > 0 && spk && spk !== prevSpeaker && wordCharStart[i] >= 0) {
      hints.push(wordCharStart[i]);
    }
    if (spk) prevSpeaker = spk;
  }

  const rawText = buildInitialText(
    segmentText,
    segmentSpeaker,
    options.insertSeparatorsAtSpeakerChange
  );

  const speakers = new Set<string>();
  for (const w of words) if (w.spk) speakers.add(w.spk);

  const lastWithEnd = [...words].reverse().find((w) => w.e != null);

  return {
    words,
    norm,
    normWordIdx,
    hints,
    rawText,
    summary: {
      wordCount: words.length,
      segmentCount: segmentText.length,
      speakerCount: speakers.size,
      duration: lastWithEnd?.e ?? null,
      hasWordTimestamps,
    },
  };
}

/** 単語列を空白抜きで連結し、各文字がどの単語由来かを記録する */
export function buildNorm(words: Word[]): {
  norm: string;
  normWordIdx: number[];
} {
  const chars: string[] = [];
  const idx: number[] = [];
  for (let i = 0; i < words.length; i++) {
    for (const ch of words[i].w) {
      if (/\s/.test(ch) || ch === "　") continue;
      chars.push(ch);
      idx.push(i);
    }
  }
  return { norm: chars.join(""), normWordIdx: idx };
}

function buildInitialText(
  segmentText: string[],
  segmentSpeaker: (string | undefined)[],
  insertSeparators: boolean
): string {
  const out: string[] = [];
  let prev: string | undefined;
  for (let i = 0; i < segmentText.length; i++) {
    const text = segmentText[i];
    if (!text) continue;
    const spk = segmentSpeaker[i];
    if (insertSeparators && i > 0 && spk && spk !== prev) {
      out.push("--");
    }
    out.push(text);
    if (spk) prev = spk;
  }
  return out.join("\n") + "\n";
}

export function toProjectWords(result: ImportResult): ProjectWords {
  return {
    words: result.words,
    norm: result.norm,
    normWordIdx: result.normWordIdx,
  };
}
