import type { Participant } from "@/lib/types";

export type RefineRequest = {
  /** 整文対象の発言本文 */
  body: string;
  /** 直前の発言本文（文脈理解のみに使い、変換対象ではない） */
  prevBody: string | null;
  /** 直後の発言本文（同上） */
  nextBody: string | null;
  /** 人名の誤変換防止に使う参加者リスト */
  participants: Participant[];
  /** 変更してはいけない固有名詞（全体リスト＋会議固有リストを結合済み） */
  glossary: string[];
};

/**
 * 整文を1件実行する。
 *
 * 現時点ではダミー実装（Anthropic API を呼ばない。第8章 実装の順序 #7 で
 * 中身だけを実際の呼び出しに差し替える）。呼び出し側（整文画面）はこの
 * 関数のシグネチャにだけ依存しているので、差し替えても呼び出し側の
 * 変更は不要。
 *
 * わずかな遅延を入れているのは、実際の API 呼び出しに近い体感にするため。
 * 遅延が無いと数百行が一瞬で終わってしまい、中断ボタンや「変換中」表示の
 * 動作を確認できない。
 */
export async function requestRefine(req: RefineRequest): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 40 + Math.random() * 60));

  const text = req.body.trim();
  if (!text) return text;
  return `${text}(ダミー整文)`;
}
