import http from "node:http";

/**
 * Anthropic API のスタブ。
 *
 * 整文（第5章）の e2e テストは本物の API を叩かない。課金が発生するうえ、
 * 429 や 5xx を意図して起こせないため、エラー処理（第5.5章）の確認ができない。
 * アプリ側は `REFINE_API_URL`（src/lib/refine.ts）でこのスタブに向ける。
 *
 * 応答の内容は、これまでのダミー実装と同じ「原文 + (ダミー整文)」にしてある。
 *
 * 制御用のエンドポイント:
 * - `POST /__mode` `{ "mode": "ok" | "429" | "500" | "max_tokens" }` …
 *   応答の種類を変え、回数を 0 に戻す。`max_tokens` は出力が途中で
 *   打ち切られた場合（本文が半分だけ返り、`stop_reason: "max_tokens"` が付く）を再現する
 * - `GET  /__stats` … `{ "calls": n }`。リトライ回数の確認に使う
 */

export const STUB_PORT = Number(process.env.REFINE_STUB_PORT ?? 3101);
export const STUB_BASE = `http://127.0.0.1:${STUB_PORT}`;

/** アプリに渡す整文エンドポイント */
export const STUB_API_URL = `${STUB_BASE}/v1/messages`;

/**
 * 応答を少し遅らせる。
 * 同一ホストのスタブは数ミリ秒で返るため、遅延が無いと数百行が一瞬で
 * 終わってしまい、「中断」ボタンや「変換中」表示の動作を確認できない。
 *
 * 中断のテストが使う大きめの入力は同じ文を繰り返しており、整文結果は本文の
 * ハッシュ（sourceKey）で共有される。つまり数回の応答で数百行が「変換済み」に
 * なるため、中断が間に合うだけの遅延がいる。これまでのダミー実装（40〜100ms、
 * 平均 70ms）と同じ体感になるようにしてある。
 */
const RESPONSE_DELAY_MS = 70;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

/** system プロンプトではなく、user プロンプトから整文対象の本文を取り出す */
function targetBody(payload) {
  const content = payload?.messages?.[0]?.content ?? "";
  const m = /対象発言: ([\s\S]*?)\n\n次の発言:/.exec(content);
  return (m ? m[1] : content).trim();
}

export async function startStub() {
  let mode = "ok";
  let calls = 0;

  const server = http.createServer(async (req, res) => {
    const json = (status, data) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };

    if (req.method === "POST" && req.url === "/__mode") {
      const { mode: next } = JSON.parse((await readBody(req)) || "{}");
      mode = next ?? "ok";
      calls = 0;
      return json(200, { mode });
    }
    if (req.method === "GET" && req.url === "/__stats") {
      return json(200, { calls, mode });
    }
    if (req.method !== "POST" || req.url !== "/v1/messages") {
      return json(404, { error: "not found" });
    }

    calls++;
    if (mode === "429") {
      return json(429, { error: { type: "rate_limit_error", message: "stub 429" } });
    }
    if (mode === "500") {
      return json(500, { error: { type: "api_error", message: "stub 500" } });
    }

    const payload = JSON.parse((await readBody(req)) || "{}");
    await new Promise((resolve) => setTimeout(resolve, RESPONSE_DELAY_MS));

    if (mode === "max_tokens") {
      // 本文の途中で打ち切られた状態を再現する。src/lib/refine.ts は
      // stop_reason だけを見て判定するので、本文の中身自体はダミーでよい
      const body = targetBody(payload);
      const truncated = body.slice(0, Math.max(1, Math.floor(body.length / 2)));
      return json(200, {
        content: [{ type: "text", text: truncated }],
        stop_reason: "max_tokens",
      });
    }

    return json(200, {
      content: [{ type: "text", text: `${targetBody(payload)}(ダミー整文)` }],
      stop_reason: "end_turn",
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(STUB_PORT, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  return server;
}

/** 応答の種類を切り替える。呼び出し回数も 0 に戻る */
export async function setStubMode(mode) {
  const res = await fetch(`${STUB_BASE}/__mode`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new Error(`スタブに接続できません (${STUB_BASE})`);
}

/** スタブが受けたリクエストの回数。リトライしたかどうかの確認に使う */
export async function stubCalls() {
  const res = await fetch(`${STUB_BASE}/__stats`);
  return (await res.json()).calls;
}
