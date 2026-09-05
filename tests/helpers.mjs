import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

export const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
export const FIXTURES = path.join(import.meta.dirname, ".fixtures");

/**
 * Chromium の場所。CI や別環境では CHROMIUM_PATH で指定できる。
 * 指定が無ければ Playwright に任せ、それも見つからなければ
 * よくある配置場所を探す。
 */
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !fs.existsSync(root)) return undefined;
  const dir = fs
    .readdirSync(root)
    .filter((d) => d.startsWith("chromium-"))
    .sort()
    .pop();
  if (!dir) return undefined;
  const bin = path.join(root, dir, "chrome-linux", "chrome");
  return fs.existsSync(bin) ? bin : undefined;
}

export async function launch(options = {}) {
  const executablePath = chromiumPath();
  return chromium.launch({ ...options, ...(executablePath ? { executablePath } : {}) });
}

export function reporter(suite) {
  const failures = [];
  return {
    failures,
    log: (...args) => console.log("  ", ...args),
    check(name, condition, extra = "") {
      if (condition) {
        console.log("  OK   ", name);
      } else {
        failures.push(`${name} ${extra}`.trim());
        console.log("  FAIL ", name, extra);
      }
    },
    finish() {
      const ok = failures.length === 0;
      console.log(
        `\n==== ${suite}: ${ok ? "ALL PASS" : `${failures.length} FAILURE(S)`} ====`
      );
      for (const f of failures) console.log("  -", f);
      return ok;
    },
  };
}

/** 新規ユーザーを作り、議事録を1つ作った状態まで進める */
export async function newProject(page, title) {
  await page.goto(`${BASE}/login`);
  await page.getByRole("tab", { name: "新規登録" }).click();
  await page
    .locator('input[autocomplete="username"]')
    .fill("t" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36));
  await page.locator('input[type="password"]').fill("password123");
  await page.getByRole("button", { name: /登録してはじめる/ }).click();
  await page.waitForURL("**/projects");
  await page.locator('input[placeholder^="例）"]').fill(title);
  await page.getByRole("button", { name: "作成する" }).click();
  await page.waitForURL(/\/projects\/[^/]+$/);
  return page.url();
}

/** WhisperX の JSON を取り込み、左ペインに反映されるまで待つ */
export async function importJson(page, file, minChars = 50) {
  await page.locator('input[type="file"][accept*="json"]').setInputFiles(file);
  await page.waitForFunction(
    (n) => (document.querySelector("textarea.editor-input")?.value.length ?? 0) > n,
    minChars,
    { timeout: 90000 }
  );
}
