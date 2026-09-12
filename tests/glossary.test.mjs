import { buildFixtures } from "./fixtures.mjs";
import { importJson, launch, newProject, reporter } from "./helpers.mjs";

/**
 * 会議固有の固有名詞の登録（GlossaryPanel、第6章 / 第8章 実装の順序 #4）。
 * 完了条件: 会議固有の語を登録・保存でき、全体リストが参考表示される。
 *
 * このパネルは②整文画面のヘッダ（「固有名詞」ボタン）から開く。
 * 整文で AI に渡す情報なので、①話者整理画面には置いていない。
 */
export default async function run() {
  const files = buildFixtures();
  const r = reporter("固有名詞の登録");
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on("pageerror", (e) => console.log("   [pageerror]", e.message));

  try {
    const editorUrl = await newProject(page, "固有名詞のテスト");
    await importJson(page, files.sample);

    r.check(
      "①話者整理画面に固有名詞の登録は無い（②へ移動した）",
      (await page.locator(".glossary-columns").count()) === 0
    );

    await page.goto(editorUrl + "/refine");
    await page.waitForSelector("table.refine-table");
    r.check(
      "②を開いた直後は固有名詞のドロワーが閉じている",
      (await page.locator(".glossary-columns").count()) === 0
    );
    await page.getByRole("button", { name: "固有名詞", exact: true }).click();
    await page.waitForSelector(".glossary-columns");

    r.check(
      "全体リストが参考表示される",
      (await page.getByText("九附後連").count()) > 0
    );
    r.check(
      "全体リストの語には削除ボタンが無い（編集不可）",
      (await page.locator(".glossary-list-readonly button").count()) === 0
    );

    await page.getByRole("button", { name: "まとめて貼り付け" }).click();
    await page
      .locator("textarea[placeholder^='1行に1語']")
      .fill("議案名A\n九附後連\n\n  前後の空白  ");
    await page.getByRole("button", { name: "この内容で追加" }).click();

    const terms = await page
      .locator(".glossary-list:not(.glossary-list-readonly) li")
      .allTextContents();
    r.check(
      "3語（空行除く）が登録される",
      terms.length === 3,
      JSON.stringify(terms)
    );
    r.check(
      "前後の空白が落ちて登録される",
      terms.some((t) => t.startsWith("前後の空白")),
      JSON.stringify(terms)
    );
    r.check(
      "全体リストと重複する語に注記が付く",
      terms.some((t) => t.includes("九附後連") && t.includes("登録済み")),
      JSON.stringify(terms)
    );

    // 削除できる（削除ボタンは「×」表示・title="削除"）
    await page
      .locator(".glossary-list:not(.glossary-list-readonly) li", { hasText: "議案名A" })
      .locator('button[title="削除"]')
      .click();
    const afterRemove = await page
      .locator(".glossary-list:not(.glossary-list-readonly) li")
      .allTextContents();
    r.check(
      "削除した語は一覧から消える",
      !afterRemove.some((t) => t.includes("議案名A")),
      JSON.stringify(afterRemove)
    );

    // 保存され、再読み込みしても残る
    await page.waitForFunction(
      () => document.querySelector(".save-state")?.textContent?.includes("保存済み"),
      null,
      { timeout: 8000 }
    );
    await page.reload();
    await page.waitForSelector("table.refine-table");
    // ドロワーは既定で閉じているので開き直す
    await page.getByRole("button", { name: "固有名詞", exact: true }).click();
    await page.waitForSelector(".glossary-columns");
    const afterReload = await page
      .locator(".glossary-list:not(.glossary-list-readonly) li")
      .allTextContents();
    r.check(
      "再読み込みしても登録した固有名詞が残る",
      afterReload.length === 2 &&
        afterReload.some((t) => t.includes("九附後連")) &&
        afterReload.some((t) => t.startsWith("前後の空白")),
      JSON.stringify(afterReload)
    );
  } finally {
    await browser.close();
  }

  return r.finish();
}

if (import.meta.filename === process.argv[1]) {
  process.exit((await run()) ? 0 : 1);
}
