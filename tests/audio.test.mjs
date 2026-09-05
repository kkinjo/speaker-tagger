import { buildFixtures } from "./fixtures.mjs";
import { importJson, launch, newProject, reporter } from "./helpers.mjs";

/** 音声連動：再生・シーク・追従ハイライト・ショートカット */
export default async function run() {
  const files = buildFixtures();
  const r = reporter("音声連動");
  const browser = await launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on("pageerror", (e) => console.log("   [pageerror]", e.message));

  try {
    await newProject(page, "音声連動テスト");
    await importJson(page, files.sample);
    await page.getByRole("button", { name: "設定を閉じる" }).click();

    // 音声を渡してもサーバーへは送らない（ブラウザ内に保存する）
    const requests = [];
    page.on("request", (req) => {
      if (["POST", "PUT", "PATCH"].includes(req.method())) {
        requests.push((req.postData() ?? "").length);
      }
    });

    await page.locator('input[type="file"][accept*="audio"]').setInputFiles(files.wav);
    await page.waitForSelector("audio", { state: "attached", timeout: 8000 });
    await page.waitForFunction(
      () => (document.querySelector("audio")?.duration ?? 0) > 0,
      null,
      { timeout: 8000 }
    );
    const duration = await page.evaluate(() => document.querySelector("audio").duration);
    r.check("音声の長さが読める", duration > 20 && duration < 30, `${duration}`);
    r.check(
      "音声本体はサーバーへ送られない",
      Math.max(0, ...requests) < 200_000,
      `最大リクエスト ${Math.max(0, ...requests)} バイト`
    );

    // 時刻クリックでその位置へ
    await page.locator('.pane-header input[type="checkbox"]').first().check();
    await page.waitForTimeout(500);
    const link = page.locator("table.minutes td.time .time-link").nth(4);
    const label = await link.textContent();
    await link.click();
    await page.waitForTimeout(300);
    const seeked = await page.evaluate(
      () => document.querySelector("audio").currentTime
    );
    r.check("時刻をクリックするとそこから再生位置が動く", seeked > 1, `${label} -> ${seeked}`);

    // Space で再生・一時停止
    await page.locator("table.minutes").click();
    await page.keyboard.press("Space");
    await page.waitForTimeout(700);
    r.check(
      "Space で再生が始まる",
      await page.evaluate(() => !document.querySelector("audio").paused)
    );

    await page.waitForTimeout(1200);
    r.check(
      "再生中の発言が1行だけ光る",
      (await page.locator("table.minutes tr.row-active").count()) === 1
    );
    r.log(
      "再生中の行:",
      (
        (await page
          .locator("table.minutes tr.row-active td.body")
          .textContent()
          .catch(() => "")) ?? ""
      ).slice(0, 30)
    );

    await page.keyboard.press("Space");
    await page.waitForTimeout(300);
    r.check(
      "Space で一時停止する",
      await page.evaluate(() => document.querySelector("audio").paused)
    );

    const before = await page.evaluate(() => document.querySelector("audio").currentTime);
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => document.querySelector("audio").currentTime);
    r.check("Alt+← で3秒戻る", Math.abs(before - after - 3) < 0.35, `${before} -> ${after}`);

    await page.keyboard.press("Alt+ArrowDown");
    await page.waitForTimeout(300);
    r.check(
      "Alt+↓ で再生速度が落ちる",
      Math.abs(
        (await page.evaluate(() => document.querySelector("audio").playbackRate)) - 0.75
      ) < 0.001
    );

    // 編集中は Space が空白入力になる（Ctrl+Space なら再生）
    await page.locator("textarea.editor-input").click();
    const textBefore = await page.locator("textarea.editor-input").inputValue();
    await page.keyboard.press("Space");
    await page.waitForTimeout(200);
    r.check(
      "編集中の Space は空白の入力になる",
      (await page.locator("textarea.editor-input").inputValue()).length ===
        textBefore.length + 1
    );
    r.check(
      "そのとき再生は始まらない",
      await page.evaluate(() => document.querySelector("audio").paused)
    );
    await page.keyboard.press("Control+Space");
    await page.waitForTimeout(400);
    r.check(
      "編集中でも Ctrl+Space なら再生できる",
      await page.evaluate(() => !document.querySelector("audio").paused)
    );
    await page.keyboard.press("Control+Space");

    await page.reload();
    await page.waitForSelector("audio", { state: "attached", timeout: 8000 });
    r.check("再読み込みしても音声が復元される", true);
  } finally {
    await browser.close();
  }

  return r.finish();
}

if (import.meta.filename === process.argv[1]) {
  process.exit((await run()) ? 0 : 1);
}
