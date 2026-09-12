import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BASE } from "./helpers.mjs";
import { STUB_API_URL, startStub } from "./anthropicStub.mjs";

/**
 * ビルド済みのアプリを起動し、全テストを順に流す。
 * すでに TEST_BASE_URL でサーバーが動いていればそれを使う。
 */

const port = new URL(BASE).port || "3100";
let server = null;
let stub = null;
let dataDir = null;

async function reachable() {
  try {
    const res = await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function startServer() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "speaker-tagger-test-"));
  server = spawn("npx", ["next", "start", "-p", port], {
    stdio: "ignore",
    env: {
      ...process.env,
      APP_SECRET: "test-secret",
      DATA_DIR: dataDir,
      // 整文は本物の Anthropic API ではなくスタブへ向ける（tests/anthropicStub.mjs）
      ANTHROPIC_API_KEY: "test-key",
      REFINE_API_URL: STUB_API_URL,
      // テストは必ずファイル保存側で動かす（本番の KV を触らない）
      KV_REST_API_URL: "",
      KV_REST_API_TOKEN: "",
      UPSTASH_REDIS_REST_URL: "",
      UPSTASH_REDIS_REST_TOKEN: "",
    },
  });
  for (let i = 0; i < 40; i++) {
    if (await reachable()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`サーバーが起動しませんでした (${BASE})`);
}

// 整文のスタブは、アプリを使い回す場合にも要る（tests/refine.test.mjs が
// 直接叩いて応答の種類を切り替えるため）。既に動いていればそれを使う。
try {
  stub = await startStub();
} catch (e) {
  if (e.code !== "EADDRINUSE") throw e;
  console.log("既に動いている整文スタブを使います");
}

if (await reachable()) {
  console.log(`既に動いているサーバーを使います (${BASE})`);
} else {
  console.log(`サーバーを起動します (${BASE})`);
  await startServer();
}

const suites = [
  ["sourceKey", "./sourceKey.test.mjs"],
  ["normalizeProject", "./normalizeProject.test.mjs"],
  ["編集", "./editor.test.mjs"],
  ["音声連動", "./audio.test.mjs"],
  ["スクロール連動", "./scrollsync.test.mjs"],
  ["画面ナビゲーション", "./nav.test.mjs"],
  ["整文フィールドの保存・読み込み", "./refinements.test.mjs"],
  ["固有名詞の登録", "./glossary.test.mjs"],
  ["整文画面", "./refine.test.mjs"],
  ["出力画面", "./export.test.mjs"],
  ["データ分離", "./isolation.test.mjs"],
  ["大きな議事録", "./performance.test.mjs"],
];

let allPassed = true;
try {
  for (const [name, file] of suites) {
    console.log(`\n---- ${name} ----`);
    const { default: run } = await import(file);
    if (!(await run())) allPassed = false;
  }
} finally {
  if (server) server.kill("SIGKILL");
  if (stub) stub.close();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n${allPassed ? "すべて成功しました。" : "失敗したテストがあります。"}`);
process.exit(allPassed ? 0 : 1);
