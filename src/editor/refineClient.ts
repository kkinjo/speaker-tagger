export type RefineRequest = {
  /** どのプロジェクトの整文か。所有者チェックのためサーバーで使う */
  projectId: string;
  /** 整文対象の発言本文 */
  body: string;
  /** 直前の発言本文（文脈理解のみに使い、変換対象ではない） */
  prevBody: string | null;
  /** 直後の発言本文（同上） */
  nextBody: string | null;
};

/**
 * 整文が失敗したときに投げる。
 *
 * 一括変換ループが 429（停止）と 5xx（1回だけリトライ）を区別できるよう、
 * HTTP ステータスを保持する（仕様書 第5.5章）。
 * ネットワーク障害など、応答そのものが無い場合は status を持たない。
 */
export class RefineRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "RefineRequestError";
  }

  /** レート制限・利用上限。叩き続けると状況が悪化するのでループを止める */
  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /**
   * 1回だけリトライしてよい失敗か。
   * サーバー側の一時的な失敗（5xx）と、応答が得られなかった場合が対象。
   */
  get isRetryable(): boolean {
    return this.status === undefined || this.status >= 500;
  }
}

/**
 * 整文を1件実行する（第5.1章）。
 *
 * Anthropic API のキーはサーバー側の環境変数にしか置かないため、
 * ブラウザからは自前の `/api/refine` を叩く。固有名詞・参加者・プリセットは
 * 送らない。サーバーがプロジェクトを読み直して組み立てる。
 */
export async function requestRefine(req: RefineRequest): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/refine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
  } catch (e) {
    throw new RefineRequestError(`サーバーに接続できませんでした: ${String(e)}`);
  }

  if (!res.ok) {
    const detail = await res
      .json()
      .then((d: { error?: string }) => d.error ?? "")
      .catch(() => "");
    throw new RefineRequestError(
      detail || `整文に失敗しました (${res.status})`,
      res.status,
    );
  }

  const data = (await res.json()) as { text?: string };
  if (typeof data.text !== "string" || !data.text) {
    throw new RefineRequestError("整文結果が空でした");
  }
  return data.text;
}
