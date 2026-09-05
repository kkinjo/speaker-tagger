import { buildFixtures } from "./fixtures.mjs";
import { importJson, launch, newProject, reporter } from "./helpers.mjs";

/**
 * 1 時間規模（約 2500 発言・2 万語）の文字起こしでの実用性。
 * 入力の重さは実際に手が止まる原因になるので、時間そのものを見る。
 */
export default async function run() {
  const files = buildFixtures();
  const r = reporter("大きな議事録");
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on("pageerror", (e) => console.log("   [pageerror]", e.message));

  try {
    await newProject(page, "1時間の会議");
    const t0 = Date.now();
    await importJson(page, files.big, 40000);
    r.log(`取り込み ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    await page.getByRole("button", { name: "設定を閉じる" }).click();
    await page.waitForTimeout(1500);

    const stats = await page.evaluate(() => ({
      chars: document.querySelector("textarea.editor-input").value.length,
      rows: document.querySelectorAll("table.minutes tbody tr").length,
      hints: document.querySelectorAll(".editor-overlay .ov-hint").length,
    }));
    r.log(JSON.stringify(stats));
    r.check("大きな文字起こしを読み込める", stats.chars > 40000);
    r.check("全発言が表になる", stats.rows > 2000, `rows=${stats.rows}`);
    r.check("話者交代のヒントが付く", stats.hints > 100, `hints=${stats.hints}`);

    await page.locator('.pane-header input[type="checkbox"]').first().check();
    await page.waitForTimeout(1500);
    const times = await page.locator("table.minutes td.time").allTextContents();
    r.log(`時刻 先頭 ${times.slice(0, 3)} 末尾 ${times.slice(-3)}`);
    r.check(
      "末尾の発言に 1 時間付近の時刻が付く",
      /^1:0\d:\d\d$/.test(times[times.length - 1]),
      `last=${times[times.length - 1]}`
    );

    await page.evaluate(() => {
      const el = document.querySelector("textarea.editor-input");
      el.focus();
      el.setSelectionRange(0, 0);
    });
    const start = Date.now();
    await page.keyboard.type("これはテスト入力です。", { delay: 0 });
    const perChar = (Date.now() - start) / 11;
    r.log(`1 文字あたり ${perChar.toFixed(0)}ms`);
    r.check("入力が引っかからない", perChar < 120, `${perChar.toFixed(0)}ms/文字`);

    await page.getByRole("button", { name: "次の未割り当てへ" }).click();
    await page.waitForTimeout(400);
    r.check(
      "未割り当てへのジャンプが効く",
      (await page.evaluate(
        () => document.querySelector("textarea.editor-input").selectionStart
      )) > 0
    );

    await page.waitForFunction(
      () => document.querySelector(".save-state")?.textContent?.includes("保存済み"),
      null,
      { timeout: 20000 }
    );
    r.check("自動保存が完了する", true);
  } finally {
    await browser.close();
  }

  return r.finish();
}

if (import.meta.filename === process.argv[1]) {
  process.exit((await run()) ? 0 : 1);
}
