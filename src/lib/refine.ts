import { mergeGlossary } from "./glossary";

/* ------------------------------------------------------------------ *
 * プリセット
 * ------------------------------------------------------------------ */

export type PromptPreset = {
  id: string;
  name: string;
  /** 利用者向けの補足。UI のセレクトに添える */
  hint: string;
  /** 語尾処理の方針。共通プロンプトに差し込む差分はここだけ */
  endingPolicy: string;
};

export const PROMPT_PRESETS: PromptPreset[] = [
  {
    id: "formal",
    name: "公式議事録",
    hint: "体言止めにして固い文体にする。会長会・校長会向け",
    endingPolicy:
      "- 文末の「〜です」「〜ます」「〜ですね」「〜なんですけれども」等の語尾を落とし、\n" +
      "  体言止めまたは連体形で終える\n" +
      "- 意味が変わる、または文として成立しなくなる場合のみ語尾を残す",
  },
  {
    id: "plain",
    name: "発言そのまま",
    hint: "丁寧語を残して柔らかい文体にする。副会長会・特支・幼稚園部会向け",
    endingPolicy:
      "- 語尾は変更しない。「です」「ですね」「ですか？」等の丁寧語はそのまま残す\n" +
      "- 体言止めにはしない",
  },
];

export const DEFAULT_PRESET_ID = "formal";

export function getPreset(id: string | undefined): PromptPreset {
  return (
    PROMPT_PRESETS.find((p) => p.id === id) ??
    PROMPT_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!
  );
}

/** 未知の値を弾く。既存プロジェクトには promptPresetId が無いので undefined も許す */
export function isPresetId(value: unknown): value is string {
  return typeof value === "string" && PROMPT_PRESETS.some((p) => p.id === value);
}

/* ------------------------------------------------------------------ *
 * プロンプト
 * ------------------------------------------------------------------ */

/**
 * system プロンプトを組み立てる。
 * 内容は project 単位で固定されるため、プロンプトキャッシュの対象にできる。
 */
export function buildSystemPrompt(args: {
  preset: PromptPreset;
  glossary: string[];
  participants: string[];
}): string {
  const { preset, glossary, participants } = args;

  return `あなたは会議議事録の整文を行うアシスタントです。

## 整文の定義
発言の意味を変えずに、文書として読める形へ整えます。

行うこと:
- フィラー（「えーっと」「あのー」「なんか」等）の除去
- 言い淀み・言い直しの統合
- 冗長な繰り返しの圧縮
${preset.endingPolicy}

行わないこと:
- 複数の発言をまとめること
- 前後の文脈から論点を再構成すること
- 発言に含まれない情報を補うこと
- 発言が途中で終わっている場合、続きを補うこと。そのまま途中で終わらせる
- 聞き取れていない箇所、意味の通らない箇所を、推測で補ったり書き換えたりすること。そのまま残す
- 文字起こしの誤変換と思われる箇所を、推測で直すこと（誤変換の修正は本アシスタントの担当ではない）
- 下記の固有名詞リストにある語の表記を変更すること（略称・正式名称いずれの表記も、そのままの形で残す）

## 出力形式
- 整文後のテキストのみを出力する。前置き・説明・引用符・見出しは一切付けない
- 入力は1発言、出力も1発言。分割や結合はしない
- 意味が取れない発言、整えると意味が変わる恐れがある発言は、無理に整えず原文のまま返す

## 前後の発言について
「前の発言」「次の発言」は、指示語や省略された主語を理解するための文脈情報としてのみ使う。これらの内容を対象発言に取り込まない。

## 固有名詞リスト（表記を変更しないこと）
${glossary.join("、")}

## 参加者リスト（人名の変換に注意）
${participants.join("、")}`;
}

function buildUserPrompt(args: {
  body: string;
  prevBody?: string;
  nextBody?: string;
}): string {
  const prev = args.prevBody?.trim() || "（なし）";
  const next = args.nextBody?.trim() || "（なし）";

  return `前の発言: ${prev}

対象発言: ${args.body}

次の発言: ${next}

対象発言のみを整文して出力してください。`;
}

/* ------------------------------------------------------------------ *
 * Anthropic API 呼び出し
 * ------------------------------------------------------------------ */

/** 呼び出し側が 429 と 5xx を区別できるようにする（第5.5章） */
export class RefineError extends Error {
  constructor(
    message: string,
    /** HTTP ステータス。ネットワーク障害等では undefined */
    readonly status?: number,
  ) {
    super(message);
    this.name = "RefineError";
  }
}

/**
 * 既定は本番の Anthropic API。
 * `REFINE_API_URL` は e2e テストでスタブに向けるための差し替え口で、
 * 本番では設定しない。
 */
const API_URL = process.env.REFINE_API_URL ?? "https://api.anthropic.com/v1/messages";

/** 既定は Claude Sonnet 5。コスト優先なら環境変数で Haiku 4.5 に切り替える（第5.2章） */
const MODEL = process.env.REFINE_MODEL ?? "claude-sonnet-5";

export type RefineArgs = {
  body: string;
  prevBody?: string;
  nextBody?: string;
  participants: string[];
  /** Project.glossary。全体リストとの結合はこの関数の中で行う */
  projectGlossary?: string[];
  presetId?: string;
};

/**
 * 1発言を整文する。
 *
 * 後から他のモデルへ差し替えられるよう、API 呼び出しはこの関数に閉じる（第5.1章）。
 */
export async function refine(args: RefineArgs): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new RefineError("ANTHROPIC_API_KEY が設定されていません");
  }

  const system = buildSystemPrompt({
    preset: getPreset(args.presetId),
    glossary: mergeGlossary(args.projectGlossary),
    participants: args.participants,
  });

  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        // 長い発言（4,000字程度）でも打ち切られないよう余裕を持たせる。
        // 1024 では長い発言の出力が途中で切れ、気づかれないまま保存される
        // 事故があった。日本語は 1 トークンに複数文字が入ることが多いとはいえ、
        // 安全側に振って余裕を持たせてある
        max_tokens: 8192,
        // 1発言ずつ逐次処理するため、system 部分はほぼ毎回キャッシュヒットする
        system: [
          {
            type: "text",
            text: system,
            cache_control: { type: "ephemeral" },
          },
        ],
        // assistant prefill は使わない。Claude Sonnet 5 以降では廃止されており、
        // 送ると 400 が返る。前置きの抑止は system プロンプト側で行う
        messages: [{ role: "user", content: buildUserPrompt(args) }],
      }),
    });
  } catch (e) {
    // ネットワーク障害。status を付けないので呼び出し側は 5xx と同じ扱いにする
    throw new RefineError(`Anthropic API へ接続できませんでした: ${String(e)}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new RefineError(
      `Anthropic API error (${res.status}): ${detail.slice(0, 200)}`,
      res.status,
    );
  }

  const data = await res.json();
  const text: string = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("")
    .trim();

  /**
   * max_tokens に達して打ち切られた応答は、成功扱いにしない。
   *
   * この場合 res.ok は true（API としては正常応答）で、`text` には
   * 文の途中で切れた内容が入っている。気づかれないまま保存されると
   * 議事録が欠けたまま確定してしまうため、呼び出し側（一括変換ループ）に
   * 「失敗」として扱わせる。429 でも 5xx でもない、専用のステータスにして
   * 429（ループ停止）にも 5xx（1回だけリトライ）にも解釈されないようにする。
   * 同じ入力を再送しても打ち切りは再発しやすいため、リトライはしない。
   */
  if (data.stop_reason === "max_tokens") {
    throw new RefineError(
      "出力が長すぎて途中で切れました（発言が長すぎる可能性があります）",
      422,
    );
  }

  if (!text) {
    throw new RefineError("整文結果が空でした");
  }

  return text;
}
