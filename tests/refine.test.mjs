import { buildFixtures } from "./fixtures.mjs";
import { createProject, importJson, launch, newProject, reporter } from "./helpers.mjs";

/**
 * 整文画面の UI（第4章 / 第8章 実装の順序 #5）。
 * この段階では Anthropic API を呼ばず、ダミー実装（src/editor/refineClient.ts）
 * で代替している。完了条件: ボタンを押すと3列目にダミー文字列が入る。
 * ステータス遷移・一括変換・中断・保存・再開がすべて動く。
 */
export default async function run() {
  const files = buildFixtures();
  const r = reporter("整文画面");
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on("pageerror", (e) => console.log("   [pageerror]", e.message));

  try {
    /* ---- 基本の状態遷移（少ない行数のデータで） ---- */
    const editorUrl = await newProject(page, "整文画面のテスト");
    await importJson(page, files.sample);

    // 議題見出しを1つ追加し、整文対象から除外されることも確認する
    await page.evaluate(() => {
      const el = document.querySelector("textarea.editor-input");
      el.focus();
      el.setSelectionRange(0, 0);
      document.execCommand("insertText", false, "# 議題1 開会\n");
    });
    await page.waitForFunction(
      () => document.querySelector(".save-state")?.textContent?.includes("保存済み"),
      null,
      { timeout: 8000 }
    );

    await page.goto(editorUrl + "/refine");
    await page.waitForSelector("table.refine-table");

    r.check(
      "議題見出しは3列をまたぐ見出し行として表示される",
      (await page.locator("tr.refine-heading-row").count()) === 1
    );
    r.check(
      "見出し行には再変換ボタンが無い",
      (await page.locator("tr.refine-heading-row button").count()) === 0
    );

    const rows = page.locator("table.refine-table tbody tr:not(.refine-heading-row)");
    const totalRows = await rows.count();
    r.check("発言数ぶんの行がある（9件）", totalRows === 9, `rows=${totalRows}`);

    r.check(
      "最初は進捗が 0 件完了",
      /0\s*\/\s*9/.test((await page.locator(".refine-progress").textContent()) ?? "")
    );
    r.check(
      "未変換行の3列目は空（プレースホルダーのみ）",
      (await page.locator("table.refine-table textarea").first().inputValue()) === ""
    );
    r.check(
      "未変換行は状態ドットが未変換色（done/edited/error のどれでもない）",
      (await page
        .locator("table.refine-table tbody tr:not(.refine-heading-row) .refine-status")
        .first()
        .getAttribute("class")) === "refine-status refine-status-empty"
    );

    // --- 一括変換：3列目にダミー文字列が入り、全行が変換済みになる ---
    await page.getByRole("button", { name: "一括変換" }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".refine-status-done").length >= 9,
      null,
      { timeout: 15000 }
    );
    r.check(
      "一括変換で全9行が変換済み（青）になる",
      (await page.locator(".refine-status-done").count()) === 9
    );
    const firstText = await page.locator("table.refine-table textarea").first().inputValue();
    r.check("3列目にダミー文字列が入る", firstText.endsWith("(ダミー整文)"), firstText);
    r.check(
      "進捗表示が 9/9 になる",
      /9\s*\/\s*9/.test((await page.locator(".refine-progress").textContent()) ?? "")
    );

    // --- 既定では変換済みの行を再処理しない ---
    await page.getByRole("button", { name: "一括変換" }).click();
    await page.waitForTimeout(500);
    r.check(
      "既定の一括変換は変換済みの行をやり直さない",
      (await page.locator("table.refine-table textarea").first().inputValue()) === firstText
    );

    // --- 手で編集すると「手動修正済み」（緑）になる ---
    const row2 = rows.nth(1);
    const secondTextarea = row2.locator("textarea");
    await secondTextarea.fill("手で直したテキスト");
    await page.waitForTimeout(300);
    r.check(
      "手動編集した行は緑（手動修正済み）になる",
      (await row2.locator(".refine-status-edited").count()) === 1
    );

    // 2秒デバウンス後に保存される（第4章 4.4）
    await page.waitForFunction(
      () => document.querySelector(".save-state")?.textContent?.includes("保存済み"),
      null,
      { timeout: 6000 }
    );

    // --- 個別再変換：手動修正済みの行は確認を挟む（第4章 4.5） ---
    page.once("dialog", (d) => d.dismiss());
    await row2.locator('button[title="この行を再変換"]').click();
    await page.waitForTimeout(300);
    r.check(
      "確認をキャンセルすると手動修正した内容が残る",
      (await secondTextarea.inputValue()) === "手で直したテキスト"
    );

    page.once("dialog", (d) => d.accept());
    await row2.locator('button[title="この行を再変換"]').click();
    await page.waitForFunction(
      () => {
        const els = document.querySelectorAll("table.refine-table textarea");
        return els[1]?.value.endsWith("(ダミー整文)");
      },
      null,
      { timeout: 5000 }
    );
    r.check(
      "確認して上書きすると再変換される",
      (await secondTextarea.inputValue()).endsWith("(ダミー整文)")
    );
    r.check(
      "再変換後は手動修正済みではなく変換済み（青）に戻る",
      (await row2.locator(".refine-status-done").count()) === 1
    );

    // --- 再読み込みしても結果が残る（再変換の保存を待ってから） ---
    await page.waitForFunction(
      () => document.querySelector(".save-state")?.textContent?.includes("保存済み"),
      null,
      { timeout: 6000 }
    );
    await page.reload();
    await page.waitForSelector("table.refine-table");
    r.check(
      "再読み込みしても整文結果が残る",
      (await page.locator(".refine-status-done").count()) === 9
    );

    /* ---- 中断・再開（行数の多いデータで確実に間に合わせる） ---- */
    // 同じログイン済みセッションで2つ目の議事録を作る（newProject は
    // ログイン画面から始めるため、ログイン済みだとリダイレクトされて使えない）
    const mediumUrl = await createProject(page, "中断のテスト");
    await importJson(page, files.medium, 500);
    await page.goto(mediumUrl + "/refine");
    await page.waitForSelector("table.refine-table");

    const mediumTotal = await page
      .locator("table.refine-table tbody tr:not(.refine-heading-row)")
      .count();
    r.check(
      "中断テスト用データが十分な行数を持つ",
      mediumTotal >= 150,
      `rows=${mediumTotal}`
    );

    await page.getByRole("button", { name: "一括変換" }).click();
    r.check(
      "実行中は「中断」ボタンに切り替わる",
      (await page.getByRole("button", { name: "中断" }).count()) === 1
    );
    await page.waitForTimeout(250); // 数行だけ処理させる
    await page.getByRole("button", { name: "中断" }).click();
    await page.waitForTimeout(400); // 実行中の1行の完了を待つ

    const doneAfterAbort = await page.locator(".refine-status-done").count();
    r.check(
      "中断すると全行は完了しない（一部だけ完了する）",
      doneAfterAbort > 0 && doneAfterAbort < mediumTotal,
      `${doneAfterAbort}/${mediumTotal}`
    );
    r.check(
      "中断後はボタンが「一括変換」に戻る",
      (await page.getByRole("button", { name: "一括変換" }).count()) === 1
    );

    await page.waitForFunction(
      () => document.querySelector(".save-state")?.textContent?.includes("保存済み"),
      null,
      { timeout: 8000 }
    );
    await page.reload();
    await page.waitForSelector("table.refine-table");
    const doneAfterReload = await page.locator(".refine-status-done").count();
    r.check(
      "再読み込みしても中断までに完了した行は残る",
      doneAfterReload === doneAfterAbort,
      `${doneAfterReload} vs ${doneAfterAbort}`
    );

    // 続きから再開すると、残りが完了して全行変換済みになる
    await page.getByRole("button", { name: "一括変換" }).click();
    await page.waitForFunction(
      (total) => document.querySelectorAll(".refine-status-done").length >= total,
      mediumTotal,
      { timeout: 60000 }
    );
    r.check(
      "再度実行すると残りが完了し、全行変換済みになる（再開できる）",
      (await page.locator(".refine-status-done").count()) === mediumTotal
    );
  } finally {
    await browser.close();
  }

  return r.finish();
}

if (import.meta.filename === process.argv[1]) {
  process.exit((await run()) ? 0 : 1);
}
