import { spawn } from "node:child_process";
import { BASE, launch, reporter } from "./helpers.mjs";

/**
 * 新規登録の停止。
 *
 * 新規登録は既定で受け付けず、環境変数 `ALLOW_SIGNUP=1` のときだけ受け付ける。
 * 画面のタブを隠すだけでなく、API（/api/auth/signup）でも止まることを確かめる。
 * 既存の利用者は、登録を止めていてもログインできる。
 *
 * テストの本体のサーバー（BASE）は ALLOW_SIGNUP=1 で動かしているので、
 * 同じ保存先を使い、ALLOW_SIGNUP を設定しないサーバーをもう1つ起動して確認する。
 */
const OFF_PORT = 3102;
const OFF = `http://127.0.0.1:${OFF_PORT}`;

async function reachable(url) {
  try {
    return (await fetch(`${url}/login`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

export default async function run() {
  const r = reporter("新規登録の停止");
  const dataDir = process.env.TEST_DATA_DIR;
  if (!dataDir) {
    // 外部のサーバーを使い回している場合は保存先が分からないので確かめられない
    r.log("TEST_DATA_DIR が無いため省略（tests/run.mjs からサーバーごと起動したときに実行）");
    return r.finish();
  }

  // 登録を受け付けるサーバーで、利用者を1人作っておく
  const username = `signup-${Date.now().toString(36)}`;
  const created = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "password123" }),
  });
  r.check("ALLOW_SIGNUP=1 のときは登録できる", created.ok, `status=${created.status}`);

  // 同じ保存先で、ALLOW_SIGNUP を設定しないサーバーを起動する
  const server = spawn("npx", ["next", "start", "-p", String(OFF_PORT)], {
    stdio: "ignore",
    detached: true,
    env: {
      ...process.env,
      APP_SECRET: "test-secret",
      DATA_DIR: dataDir,
      ALLOW_SIGNUP: "",
      KV_REST_API_URL: "",
      KV_REST_API_TOKEN: "",
      UPSTASH_REDIS_REST_URL: "",
      UPSTASH_REDIS_REST_TOKEN: "",
    },
  });
  const browser = await launch();
  try {
    for (let i = 0; i < 40 && !(await reachable(OFF)); i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    /* ---- API で止まる ---- */
    const refused = await fetch(`${OFF}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: `${username}-x`, password: "password123" }),
    });
    const body = await refused.json().catch(() => ({}));
    r.check(
      "ALLOW_SIGNUP が無いと、API を直接呼んでも登録できない（403）",
      refused.status === 403 && !refused.headers.get("set-cookie"),
      `status=${refused.status}`
    );
    r.check(
      "断った理由が返る",
      body.error === "新規登録は現在受け付けていません。",
      JSON.stringify(body)
    );
    const dup = await fetch(`${OFF}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "password123" }),
    });
    r.check(
      "既存のユーザー名でも 403 だけを返す（名前が使われているかを漏らさない）",
      dup.status === 403,
      `status=${dup.status}`
    );

    /* ---- 画面に「新規登録」が出ない ---- */
    const page = await browser.newPage();
    await page.goto(`${OFF}/login`);
    await page.waitForSelector('input[autocomplete="username"]');
    r.check(
      "ログイン画面に「新規登録」のタブが出ない",
      (await page.getByRole("tab", { name: "新規登録" }).count()) === 0 &&
        (await page.getByText("新規登録").count()) === 0
    );

    /* ---- 既存の利用者はログインできる ---- */
    await page.locator('input[autocomplete="username"]').fill(username);
    await page.locator('input[type="password"]').fill("password123");
    await page.getByRole("button", { name: "ログイン" }).click();
    await page.waitForURL("**/projects", { timeout: 10000 });
    r.check("既存の利用者はログインできる", page.url().endsWith("/projects"));
  } finally {
    await browser.close();
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      server.kill("SIGKILL");
    }
  }

  return r.finish();
}

if (import.meta.filename === process.argv[1]) {
  process.exit((await run()) ? 0 : 1);
}
