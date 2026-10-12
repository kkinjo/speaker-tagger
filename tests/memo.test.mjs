import { buildFixtures } from "./fixtures.mjs";
import { importJson, launch, newProject, reporter } from "./helpers.mjs";
import { setStubMode, stubRequests } from "./anthropicStub.mjs";

/**
 * 変更が保存されるまで待つ（①②共通の .save-state）。
 * いったん「保存済み」以外になるのを待ってから「保存済み」を待つ。
 * 先に「保存済み」を見てしまうと、デバウンス待ちの前に抜けてしまう
 */
async function waitSaved(page) {
  await page
    .waitForFunction(
      () => !document.querySelector(".save-state")?.textContent?.includes("保存済み"),
      null,
      { timeout: 3000 }
    )
    .catch(() => {});
  await page.waitForFunction(
    () => document.querySelector(".save-state")?.textContent?.includes("保存済み"),
    null,
    { timeout: 8000 }
  );
}

/** サーバーに保存されている memo と設定を読む */
async function loadFromServer(page, projectId) {
  return page.evaluate(async (id) => {
    const res = await fetch(`/api/projects/${id}`);
    return res.json();
  }, projectId);
}

/**
 * プロジェクト単位のメモ（MemoPanel / Project.memo）。
 *
 * - ①で入力 → 再読み込みで残っている（打った内容が整形されずに残る）
 * - ②で入力 → ①で同じ内容が見える
 * - 開閉状態が保存される（①②で共通）。③専用の設定は壊さない
 * - ①と②を別タブで開いていても、メモを触っていない側が古い内容で上書きしない
 * - ①でメモに入力中に Space を押しても再生が始まらない
 * - /api/refine から Anthropic（スタブ）へ送る内容にメモが含まれない
 */
export default async function run() {
  const files = buildFixtures();
  const r = reporter("メモ");
  const browser = await launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("   [pageerror]", e.message));

  try {
    const editorUrl = await newProject(page, "メモのテスト");
    const projectId = new URL(editorUrl).pathname.split("/").pop();
    await importJson(page, files.sample);
    await page.getByRole("button", { name: "設定を閉じる" }).click();

    // ③専用の設定を既定から変えておき、メモの開閉で壊れないことを後で見る
    await page.evaluate(() =>
      fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exportIncludeTime: true }),
      })
    );

    /* ---- 既定は閉じている ---- */
    const memoText = page.locator("textarea.memo-text");
    const memoTab = page.locator(".memo-panel").getByRole("button", { name: "メモ" });
    r.check("既定ではタブ「メモ」だけが出ている", (await memoTab.count()) === 1);
    r.check("既定では入力欄は出ていない", (await memoText.count()) === 0);

    const pos = await page.evaluate(() => {
      const el = document.querySelector(".memo-panel");
      const rect = el.getBoundingClientRect();
      return {
        position: getComputedStyle(el).position,
        right: window.innerWidth - rect.right,
        bottom: window.innerHeight - rect.bottom,
      };
    });
    r.check(
      "①では右下に固定表示される",
      pos.position === "fixed" && pos.right < 40 && pos.bottom < 120,
      JSON.stringify(pos)
    );

    /* ---- ①で入力 → 再読み込みで残る ---- */
    const panesBefore = await page.locator(".panes").boundingBox();
    await memoTab.click();
    await memoText.waitFor();
    const panesAfter = await page.locator(".panes").boundingBox();
    r.check(
      "開いても下の表・編集欄の配置はずれない（上に重なる）",
      panesBefore.height === panesAfter.height && panesBefore.y === panesAfter.y,
      `${JSON.stringify(panesBefore)} -> ${JSON.stringify(panesAfter)}`
    );
    r.check(
      "開くとメモの入力欄にフォーカスが移る",
      await page.evaluate(() => document.activeElement?.classList.contains("memo-text"))
    );

    // 前後の空白・空行も、そのまま保存される（整形しない）
    const memo1 = "  来賓：琉球大学 金城 太郎（きんじょう たろう）\n\n誤変換：教会→協会  ";
    await memoText.fill(memo1);
    await waitSaved(page);

    await page.reload();
    await page.waitForSelector("textarea.editor-input");
    r.check("再読み込み後も開いたまま（開閉状態が保存される）", (await memoText.count()) === 1);
    r.check(
      "再読み込み後も入力した内容がそのまま残る",
      (await memoText.inputValue()) === memo1,
      JSON.stringify(await memoText.inputValue())
    );

    const saved1 = await loadFromServer(page, projectId);
    r.check("サーバーの memo は整形されていない", saved1.project.memo === memo1);
    r.check("設定に memoOpen: true が保存される", saved1.settings.memoOpen === true);
    r.check(
      "メモの開閉で③専用の設定（exportIncludeTime）は壊れない",
      saved1.settings.exportIncludeTime === true
    );

    /* ---- 高さの上限：画面の 1/3 程度で止まり、中でスクロールする ---- */
    await memoText.fill(Array.from({ length: 80 }, (_, i) => `行${i + 1}`).join("\n"));
    const size = await memoText.evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      scrollHeight: el.scrollHeight,
      overflowY: getComputedStyle(el).overflowY,
      vh: window.innerHeight,
    }));
    r.check(
      "長いメモは画面の 1/3 程度で止まり、中でスクロールできる",
      size.height <= size.vh * 0.34 &&
        size.scrollHeight > size.height &&
        size.overflowY === "auto",
      JSON.stringify(size)
    );
    await memoText.fill(memo1);
    await waitSaved(page);

    /* ---- ①でメモに入力中に Space を押しても再生しない ---- */
    await page.locator('input[type="file"][accept*="audio"]').setInputFiles(files.wav);
    await page.waitForFunction(
      () => (document.querySelector("audio")?.duration ?? 0) > 0,
      null,
      { timeout: 8000 }
    );
    await memoText.click();
    await memoText.press("End");
    await page.keyboard.press("Space");
    await page.waitForTimeout(600);
    r.check(
      "メモに入力中の Space では再生が始まらない",
      await page.evaluate(() => document.querySelector("audio").paused)
    );
    r.check(
      "メモに入力中の Space は空白として入る",
      (await memoText.inputValue()).endsWith(" ")
    );

    // 区切り（Alt+D）・話者（Alt+A）は生テキスト側を書き換えるので、メモの中では効かせない
    const rawBefore = await page.locator("textarea.editor-input").inputValue();
    await page.keyboard.press("Alt+KeyD");
    await page.keyboard.press("Alt+KeyA");
    await page.waitForTimeout(200);
    r.check(
      "メモの中では Alt+D / Alt+A で生テキストが変わらない",
      (await page.locator("textarea.editor-input").inputValue()) === rawBefore
    );
    r.check(
      "メモの中で Alt+D / Alt+A を押してもフォーカスはメモのまま",
      await page.evaluate(() => document.activeElement?.classList.contains("memo-text"))
    );
    await memoText.fill(memo1);
    await waitSaved(page);

    /* ---- ②で入力 → ①で同じ内容が見える ---- */
    await page.goto(editorUrl + "/refine");
    await page.waitForSelector("table.refine-table");
    r.check("②でも開閉状態が共通（開いたまま）", (await memoText.count()) === 1);
    r.check("②でも①で入力した内容が見える", (await memoText.inputValue()) === memo1);

    const pos2 = await page.evaluate(() => {
      const el = document.querySelector(".memo-panel");
      const rect = el.getBoundingClientRect();
      return {
        position: getComputedStyle(el).position,
        left: rect.left,
        bottom: window.innerHeight - rect.bottom,
      };
    });
    r.check(
      "②では左下に固定表示される",
      pos2.position === "fixed" && pos2.left < 40 && pos2.bottom < 60,
      JSON.stringify(pos2)
    );

    // 整文に渡さないことを確かめるための、ほかに出てこない目印
    const marker = "メモ専用の目印_ZQX9";
    const memo2 = `${memo1}\n${marker}`;
    await memoText.fill(memo2);
    await waitSaved(page);

    /* ---- /api/refine（スタブ側）にメモが含まれない ---- */
    await setStubMode("ok"); // 受け取ったリクエストの記録を空にする
    await page
      .locator("table.refine-table tbody tr:not(.refine-heading-row)")
      .first()
      .getByRole("button", { name: "↻" })
      .click();
    await page.waitForFunction(
      () =>
        document
          .querySelector("table.refine-table tbody tr:not(.refine-heading-row) .refine-status")
          ?.textContent?.includes("AI変換済み"),
      null,
      { timeout: 8000 }
    );
    const bodies = await stubRequests();
    r.check("整文のリクエストがスタブに届いている", bodies.length >= 1, `${bodies.length}`);
    r.check(
      "整文のリクエストにメモの内容が含まれない",
      bodies.every((b) => !b.includes(marker) && !b.includes("金城 太郎")),
      bodies.find((b) => b.includes(marker))?.slice(0, 200) ?? ""
    );
    await waitSaved(page);

    await page.goto(editorUrl);
    await page.waitForSelector("textarea.editor-input");
    r.check("②で入力した内容が①で見える", (await memoText.inputValue()) === memo2);

    /* ---- 別タブで開いていても、古いメモで上書きしない ---- */
    // ①（このタブ）はメモを読み込んだまま、②を別タブで開いてメモを書き換える
    const page2 = await context.newPage();
    await page2.goto(editorUrl + "/refine");
    await page2.waitForSelector("textarea.memo-text");
    const memo3 = `${memo2}\n②の別タブで追記`;
    await page2.locator("textarea.memo-text").fill(memo3);
    await waitSaved(page2);

    // ①で本文だけ編集して保存させる。①のメモは古いままだが、送らないので上書きしない
    await page.evaluate(() => {
      const el = document.querySelector("textarea.editor-input");
      el.focus();
      el.setSelectionRange(0, 0);
      document.execCommand("insertText", false, "# 議題1\n");
    });
    await waitSaved(page);
    const saved2 = await loadFromServer(page, projectId);
    r.check("①の本文は保存されている", saved2.project.rawText.startsWith("# 議題1\n"));
    r.check(
      "①がメモを触っていなければ、②で書いたメモは上書きされない",
      saved2.project.memo === memo3,
      JSON.stringify(saved2.project.memo.slice(-20))
    );

    // 逆向き：②で整文結果を保存しても、①で書いたメモを古い内容で上書きしない
    await page.reload();
    await page.waitForSelector("textarea.memo-text");
    const memo4 = `${memo3}\n①で追記`;
    await memoText.fill(memo4);
    await waitSaved(page);
    await page2
      .locator("table.refine-table tbody tr:not(.refine-heading-row) .refine-output textarea")
      .first()
      .fill("手で直した整文");
    await waitSaved(page2);
    const saved3 = await loadFromServer(page, projectId);
    r.check(
      "②がメモを触っていなければ、①で書いたメモは上書きされない",
      saved3.project.memo === memo4,
      JSON.stringify(saved3.project.memo.slice(-20))
    );
    await page2.close();

    /* ---- 閉じた状態も保存される ---- */
    await page.locator(".memo-panel").getByRole("button", { name: "閉じる" }).click();
    await page.waitForTimeout(300);
    await page.reload();
    await page.waitForSelector("textarea.editor-input");
    r.check(
      "閉じて再読み込みすると、閉じたまま（タブだけ）",
      (await memoText.count()) === 0 && (await memoTab.count()) === 1
    );
    const saved4 = await loadFromServer(page, projectId);
    r.check("設定に memoOpen: false が保存される", saved4.settings.memoOpen === false);
    r.check("閉じても内容は残っている", saved4.project.memo === memo4);

    /* ---- ③には出さない ---- */
    await page.goto(editorUrl + "/export");
    await page.waitForSelector("table.minutes");
    r.check("③にはメモを出さない", (await page.locator(".memo-panel").count()) === 0);
  } catch (e) {
    r.check("例外なく完了", false, String(e?.stack ?? e));
  } finally {
    await browser.close();
  }

  return r.finish();
}

if (import.meta.filename === process.argv[1]) {
  process.exit((await run()) ? 0 : 1);
}
