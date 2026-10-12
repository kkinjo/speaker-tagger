import { buildFixtures } from "./fixtures.mjs";
import { importJson, launch, newProject, reporter } from "./helpers.mjs";

/**
 * Alt+D（Mac は Option+D）で入れる区切りの時刻。
 *
 * - 時:分:秒（`--@0:01:23`）の形で入れる
 * - 音声を再生・頭出ししているときは再生位置を使い、2秒前にずらす
 *   （話者が替わったのを聞いてから押すため）。0秒より前にはしない
 * - 再生位置が無いときは、カーソル位置の単語データの時刻を使う。
 *   単語データの時刻は発言の頭そのものなので、ずらさない
 */
export default async function run() {
  const files = buildFixtures();
  const r = reporter("Alt+D の時刻");
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on("pageerror", (e) => console.log("   [pageerror]", e.message));

  const hms = (sec) => {
    const t = Math.floor(sec);
    const pad = (n) => String(n).padStart(2, "0");
    return `${Math.floor(t / 3600)}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
  };
  /** カーソルを置いて Alt+D を押し、入った区切り行を返す */
  const pressAt = async (offset) => {
    await page.evaluate((at) => {
      const ta = document.querySelector("textarea.editor-input");
      ta.focus();
      ta.setSelectionRange(at, at);
    }, offset);
    await page.keyboard.press("Alt+KeyD");
    await page.waitForTimeout(200);
    return page.evaluate((at) => {
      const v = document.querySelector("textarea.editor-input").value;
      const start = v.indexOf("--", at);
      return v.slice(start, v.indexOf("\n", start));
    }, offset);
  };

  try {
    await newProject(page, "Alt+D の時刻のテスト");
    await importJson(page, files.sample);
    const close = page.getByRole("button", { name: "設定を閉じる" });
    if (await close.count()) await close.click();

    /* ---- 音声が無い：単語データの時刻をそのまま（ずらさない） ---- */
    // 取り込みで付いた区切り `--@T` の直後の発言の頭で押す。
    // その発言の最初の単語の時刻は T と同じなので、時:分:秒にした T が入るはず
    const target = await page.evaluate(() => {
      const v = document.querySelector("textarea.editor-input").value;
      const re = /\n--@(\d+(?:\.\d+)?)\n/g;
      let m;
      while ((m = re.exec(v)) !== null) {
        if (Number(m[1]) >= 3) return { at: m.index + m[0].length, time: Number(m[1]) };
      }
      return null;
    });
    r.check("確認に使う区切り（3秒以降）が取り込まれている", target !== null);
    const fromWords = await pressAt(target.at);
    r.check(
      "音声が無いときは単語データの時刻を、時:分:秒で入れる",
      fromWords === `--@${hms(target.time)}`,
      `${fromWords} (区切りの時刻 ${target.time})`
    );
    r.check(
      "単語データの時刻は2秒ずらさない",
      fromWords !== `--@${hms(Math.max(0, target.time - 2))}`
    );

    /* ---- 音声あり：再生位置の2秒前 ---- */
    await page.locator('input[type="file"][accept*="audio"]').setInputFiles(files.wav);
    await page.waitForFunction(
      () => (document.querySelector("audio")?.duration ?? 0) > 0,
      null,
      { timeout: 8000 }
    );
    const seekTo = (t) =>
      page.evaluate(
        (t) =>
          new Promise((resolve) => {
            const el = document.querySelector("audio");
            el.pause();
            el.addEventListener("seeked", () => resolve(), { once: true });
            el.currentTime = t;
          }),
        t
      );
    const end = () =>
      page.evaluate(() => document.querySelector("textarea.editor-input").value.length);

    await seekTo(12.6);
    const fromPlayhead = await pressAt(await end());
    r.check(
      "再生位置（12.6秒）の2秒前を、時:分:秒で入れる",
      fromPlayhead === "--@0:00:10",
      fromPlayhead
    );

    await seekTo(1.2);
    const clamped = await pressAt(await end());
    r.check("2秒前が0秒より前になるときは0秒にする", clamped === "--@0:00:00", clamped);

    await seekTo(0);
    const fallback = await pressAt(target.at);
    r.check(
      "再生位置が0（まだ再生していない）のときは、単語データの時刻を使う",
      fallback === `--@${hms(target.time)}`,
      fallback
    );
  } finally {
    await browser.close();
  }

  return r.finish();
}

if (import.meta.filename === process.argv[1]) {
  process.exit((await run()) ? 0 : 1);
}
