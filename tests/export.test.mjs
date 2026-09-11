import { buildFixtures } from "./fixtures.mjs";
import { importJson, launch, newProject, reporter } from "./helpers.mjs";

/**
 * 出力画面（③、第7章 / 第8章 実装の順序 #6）。
 * 完了条件: 列を選んでコピーできる。①のコピーボタンを削除する。
 */
export default async function run() {
  const files = buildFixtures();
  const r = reporter("出力画面");
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on("pageerror", (e) => console.log("   [pageerror]", e.message));

  try {
    const editorUrl = await newProject(page, "出力画面のテスト");
    await importJson(page, files.sample);

    // 見出しと参加者を用意しておく（列の出し分け・見出し行の確認用）
    await page.evaluate(() => {
      const el = document.querySelector("textarea.editor-input");
      el.focus();
      el.setSelectionRange(0, 0);
      document.execCommand("insertText", false, "# 議題1 開会\n");
    });
    await page.getByRole("button", { name: "まとめて貼り付け" }).first().click();
    await page
      .locator("textarea[placeholder^='1行に1人']")
      .fill("●●小/太田");
    await page.getByRole("button", { name: "この内容で追加" }).first().click();
    await page.waitForFunction(
      () => document.querySelector(".save-state")?.textContent?.includes("保存済み"),
      null,
      { timeout: 8000 }
    );

    await page.goto(editorUrl + "/export");
    await page.waitForSelector("table.minutes");

    r.check(
      "既定は時刻列オフ・話者列オン・整文後オン（第7章 7.2）",
      (await page.getByRole("checkbox", { name: "時刻列" }).isChecked()) === false &&
        (await page.getByRole("checkbox", { name: "話者列" }).isChecked()) === true &&
        (await page
          .getByRole("checkbox", { name: "整文後のテキストを使う（原文ではなく）" })
          .isChecked()) === true
    );
    r.check(
      "既定では時刻列が表に出ない",
      (await page.locator("table.minutes thead th").count()) === 2
    );
    r.check(
      "議題見出しは列をまたいで表示される",
      (await page.locator("table.minutes tr.heading-row").count()) === 1
    );
    r.check(
      "整文結果が無いので、整文後を選んでいても原文がそのまま出る",
      (await page.locator("table.minutes tbody tr").nth(1).locator("td.body").textContent())?.includes(
        "おはようございます"
      )
    );
    r.check(
      "未整文の行数（9件）が表示される",
      (await page.locator(".export-toolbar").textContent())?.includes("9")
    );

    // --- 時刻列を含める ---
    await page.getByRole("checkbox", { name: "時刻列" }).check();
    r.check(
      "時刻列を含めると3列になる",
      (await page.locator("table.minutes thead th").count()) === 3
    );
    const exportTimes = await page.locator("table.minutes tbody td.time").allTextContents();
    r.check(
      "時刻が表示される",
      exportTimes.filter((t) => /\d+:\d\d/.test(t)).length >= 5,
      JSON.stringify(exportTimes.slice(0, 4))
    );

    // --- 話者列を外す ---
    await page.getByRole("checkbox", { name: "話者列" }).uncheck();
    r.check(
      "話者列を外すと2列になる（時刻+発言内容）",
      (await page.locator("table.minutes thead th").count()) === 2
    );
    r.check(
      "話者列自体が無い",
      (await page.locator("table.minutes td.speaker").count()) === 0
    );

    // --- 設定は再読み込み後も保持される（UserSettings） ---
    await page.waitForTimeout(700);
    await page.reload();
    await page.waitForSelector("table.minutes");
    r.check(
      "表示設定は次回も同じ設定で開く",
      (await page.getByRole("checkbox", { name: "時刻列" }).isChecked()) === true &&
        (await page.getByRole("checkbox", { name: "話者列" }).isChecked()) === false
    );

    // --- コピー（Word 向け HTML + 列の出し分け） ---
    await page.getByRole("checkbox", { name: "話者列" }).check();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "表をコピー" }).click();
    await page.waitForTimeout(400);
    const clipHtml = await page.evaluate(async () => {
      for (const item of await navigator.clipboard.read()) {
        if (item.types.includes("text/html")) {
          return await (await item.getType("text/html")).text();
        }
      }
      return "";
    });
    r.check("クリップボードが表になっている", clipHtml.includes("<table"));
    r.check("罫線がインラインで入る（Word 向け）", clipHtml.includes("border:1px solid"));
    r.check("時刻列を含めてコピーされる", clipHtml.includes("時刻"));
    r.check("セル内の改行が保たれる形式を持つ", clipHtml.includes("<td"));

    // --- 整文結果があればそちらを使う ---
    await page.goto(editorUrl + "/refine");
    await page.waitForSelector("table.refine-table");
    await page.getByRole("button", { name: "一括変換" }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".refine-status-done").length >= 9,
      null,
      { timeout: 15000 }
    );
    await page.waitForFunction(
      () => document.querySelector(".save-state")?.textContent?.includes("保存済み"),
      null,
      { timeout: 8000 }
    );

    await page.goto(editorUrl + "/export");
    await page.waitForSelector("table.minutes");
    r.check(
      "整文結果があるときは整文後のテキストが使われる",
      (await page.locator("table.minutes tbody td.body").first().textContent())?.includes(
        "(ダミー整文)"
      )
    );
    r.check(
      "整文が全行終わっていれば未整文件数の表示が消える",
      !(await page.locator(".export-toolbar").textContent())?.match(/未整文/)
    );

    // 「原文」を選ぶと整文結果ではなく原文が出る
    await page
      .getByRole("checkbox", { name: "整文後のテキストを使う（原文ではなく）" })
      .uncheck();
    r.check(
      "原文を選ぶとダミー整文の文字列は出ない",
      !(await page.locator("table.minutes tbody td.body").first().textContent())?.includes(
        "(ダミー整文)"
      )
    );

    // --- ①には「表をコピー」が無い ---
    await page.goto(editorUrl);
    await page.waitForSelector("textarea.editor-input");
    r.check(
      "①話者整理画面にはコピー機能が無い（③に一本化）",
      (await page.getByRole("button", { name: "表をコピー" }).count()) === 0
    );
    r.check(
      "①の表形式ビューは確認用という案内がある",
      (await page.locator(".pane-header").filter({ hasText: "確認用" }).count()) > 0
    );
  } finally {
    await browser.close();
  }

  return r.finish();
}

if (import.meta.filename === process.argv[1]) {
  process.exit((await run()) ? 0 : 1);
}
