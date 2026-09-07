import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BASE } from "./helpers.mjs";

/**
 * ビルド済みのアプリを起動し、全テストを順に流す。
 * すでに TEST_BASE_URL でサーバーが動いていればそれを使う。
 */

const port = new URL(BASE).port || "3100";
let server = null;
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

const started = !(await reachable());
if (started) {
  console.log(`サーバーを起動します (${BASE})`);
  await startServer();
} else {
  console.log(`既に動いているサーバーを使います (${BASE})`);
}

const suites = [
  ["編集", "./editor.test.mjs"],
  ["音声連動", "./audio.test.mjs"],
  ["スクロール連動", "./scrollsync.test.mjs"],
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
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n${allPassed ? "すべて成功しました。" : "失敗したテストがあります。"}`);
process.exit(allPassed ? 0 : 1);
