import { buildFixtures } from "./fixtures.mjs";
import { createProject, importJson, launch, newProject, reporter } from "./helpers.mjs";
import { setStubMode, stubCalls } from "./anthropicStub.mjs";

/**
 * 整文画面（第4章 / 第5章）。
 *
 * 整文は `/api/refine` 経由で Anthropic API を呼ぶ。テストでは本物の API では
 * なくスタブ（tests/anthropicStub.mjs）に向け、成功時は「原文 + (ダミー整文)」を
 * 返させる。429 / 5xx / max_tokens（出力が途中で打ち切られた場合）を意図して
 * 起こし、第5.5章のエラー処理も確認する。
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
      "整文結果が無い行の3列目には原文が薄く出る（textarea ではない。第4章 4.1）",
      (await page.locator("table.refine-table .refine-out-original").count()) === 9 &&
        (await page.locator("table.refine-table textarea").count()) === 0
    );
    r.check(
      "3列目の下段に出るのは1列目と同じ原文",
      (await page.locator("table.refine-table .refine-out-original").first().textContent()) ===
        (await page.locator("table.refine-table .refine-body").first().textContent())
    );
    r.check(
      "3列目の上段に話者が出る（1列目と重複するが省略しない。第4章 4.1）",
      (await page.locator("table.refine-table .refine-out-speaker").count()) === 9
    );
    r.check(
      "ステータスは「原文のまま出力」と文字で出る（第3章 3.3）",
      (await page
        .locator("table.refine-table tbody tr:not(.refine-heading-row) .refine-status")
        .first()
        .textContent()) === "原文のまま出力"
    );
    r.check(
      "未変換行のステータスは未変換色（done/edited/error のどれでもない）",
      (await page
        .locator("table.refine-table tbody tr:not(.refine-heading-row) .refine-status")
        .first()
        .getAttribute("class")) === "refine-status refine-status-empty"
    );

    /* --- 表示の絞り込み（第4章 4.2） --- */
    await page.getByLabel("表示の絞り込み").selectOption("raw");
    await page.waitForTimeout(200);
    r.check(
      "絞り込むと「原文のまま出力」の行だけになる（見出し行も隠れる）",
      (await page.locator("table.refine-table tbody tr").count()) === 9 &&
        (await page.locator("tr.refine-heading-row").count()) === 0
    );

    /* --- 原文のまま確定する（第4章 4.6）。何も直さずフォーカスを外すだけ --- */
    await page.locator("table.refine-table .refine-out-original").first().click();
    r.check(
      "クリックすると原文が入った textarea に変わる",
      (await page.locator("table.refine-table textarea").first().inputValue()) ===
        (await page.locator("table.refine-table .refine-body").first().textContent())
    );
    await page.locator(".refine-toolbar").click();
    await page.waitForTimeout(300);
    r.check(
      "原文のまま確定した行は絞り込みから外れる（残作業の確認が成立する）",
      (await page.locator("table.refine-table tbody tr").count()) === 8
    );

    /* --- 誤操作の取り消し（第4章 4.6） --- */
    r.check(
      "確定直後に取り消しの案内が出る",
      (await page.locator(".refine-undo").count()) === 1 &&
        ((await page.locator(".refine-undo").textContent()) ?? "").includes(
          "原文のまま確定しました"
        )
    );
    await page.locator(".refine-undo").getByRole("button", { name: "取り消す" }).click();
    await page.waitForTimeout(300);
    r.check(
      "取り消すと確定前（原文のまま出力）に戻る",
      (await page.locator("table.refine-table tbody tr").count()) === 9 &&
        (await page.locator(".refine-status-edited").count()) === 0
    );
    r.check(
      "取り消すと案内も消える",
      (await page.locator(".refine-undo").count()) === 0
    );

    // 取り消した行を、もう一度「原文のまま確定」しておく
    await page.locator("table.refine-table .refine-out-original").first().click();
    await page.locator(".refine-toolbar").click();
    await page.waitForTimeout(300);
    r.check(
      "取り消したあとでも、もう一度確定できる",
      (await page.locator("table.refine-table tbody tr").count()) === 8
    );

    // 案内は数秒で自動的に消える（永続的なボタンは置かない）
    await page.waitForSelector(".refine-undo", { state: "detached", timeout: 12000 });
    r.check("取り消しの案内は数秒で自動的に消える", true);

    await page.getByLabel("表示の絞り込み").selectOption("all");
    await page.waitForTimeout(200);
    r.check(
      "絞り込みを解除すると全行に戻る",
      (await page.locator("table.refine-table tbody tr").count()) === 10
    );
    r.check(
      "何も直さずフォーカスを外すだけで「手修正済み」になる（第4章 4.6）",
      (await page.locator(".refine-status-edited").count()) === 1
    );
    r.check(
      "原文のまま確定した行の本文は原文と同じ",
      (await page.locator("table.refine-table textarea").first().inputValue()) ===
        (await page.locator("table.refine-table .refine-body").first().textContent())
    );

    // 確定した内容の保存を待ってから先へ進む
    await page.waitForFunction(
      () => document.querySelector(".save-state")?.textContent?.includes("保存済み"),
      null,
      { timeout: 6000 }
    );

    // --- 一括変換：3列目にスタブの応答が入る ---
    await setStubMode("ok");
    // 1行は上で「原文のまま確定」したので、一括変換の対象は残り8行
    await page.getByRole("button", { name: "一括変換" }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".refine-status-done").length >= 8,
      null,
      { timeout: 15000 }
    );
    r.check(
      "一括変換は未処理の8行だけを変換する（原文のまま確定した行はそのまま）",
      (await page.locator(".refine-status-done").count()) === 8 &&
        (await page.locator(".refine-status-edited").count()) === 1
    );
    const firstText = await page
      .locator("table.refine-table textarea")
      .nth(1)
      .inputValue();
    r.check("3列目に API の応答が入る", firstText.endsWith("(ダミー整文)"), firstText);
    r.check(
      "整文対象の本文が API に渡っている（前後の行ではなく対象発言）",
      firstText ===
        `${await page.locator("table.refine-table .refine-body").nth(1).textContent()}(ダミー整文)`,
      firstText
    );
    r.check(
      "進捗表示が 9/9 になる",
      /9\s*\/\s*9/.test((await page.locator(".refine-progress").textContent()) ?? "")
    );
    r.check(
      "絞り込むと0行になり、処理漏れが無いことを確認できる（第4章 4.2）",
      await (async () => {
        await page.getByLabel("表示の絞り込み").selectOption("raw");
        await page.waitForTimeout(200);
        const text = (await page.locator("table.refine-table tbody").textContent()) ?? "";
        await page.getByLabel("表示の絞り込み").selectOption("all");
        await page.waitForTimeout(200);
        return text.includes("処理漏れはありません");
      })()
    );

    // --- 既定では変換済みの行を再処理しない ---
    await page.getByRole("button", { name: "一括変換" }).click();
    await page.waitForTimeout(500);
    r.check(
      "既定の一括変換は変換済みの行をやり直さない",
      (await page.locator("table.refine-table textarea").nth(1).inputValue()) === firstText
    );

    // --- 手で編集すると「手動修正済み」（緑）になる ---
    const row2 = rows.nth(1);
    const secondTextarea = row2.locator("textarea");
    await secondTextarea.fill("手で直したテキスト");
    await page.locator(".refine-toolbar").click();
    await page.waitForTimeout(300);
    r.check(
      "1文字でも編集した場合は取り消しの案内を出さない（第4章 4.6）",
      (await page.locator(".refine-undo").count()) === 0
    );
    r.check(
      "手動編集した行は緑（手修正済み）になる",
      (await row2.locator(".refine-status-edited").count()) === 1 &&
        (await row2.locator(".refine-status").textContent()) === "手修正済み"
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
      "再変換後は手修正済みではなく AI変換済み（青）に戻る",
      (await row2.locator(".refine-status-done").count()) === 1 &&
        (await row2.locator(".refine-status").textContent()) === "AI変換済み"
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
      (await page.locator(".refine-status-done").count()) === 8 &&
        (await page.locator(".refine-status-edited").count()) === 1
    );

    /* ---- エラー処理（第5.5章） ---- */
    const errorUrl = await createProject(page, "エラー処理のテスト");
    await importJson(page, files.sample);
    await page.waitForFunction(
      () => document.querySelector(".save-state")?.textContent?.includes("保存済み"),
      null,
      { timeout: 8000 }
    );
    await page.goto(errorUrl + "/refine");
    await page.waitForSelector("table.refine-table");
    const errorRows = await page
      .locator("table.refine-table tbody tr:not(.refine-heading-row)")
      .count();

    // --- 429：即座にループを停止し、リトライしない ---
    await setStubMode("429");
    await page.getByRole("button", { name: "一括変換" }).click();
    await page.waitForSelector(".refine-error-note", { timeout: 10000 });
    await page.waitForTimeout(300);
    const callsAfter429 = await stubCalls();
    r.check(
      "429 なら1行目で停止する（後続の行は処理しない）",
      (await page.locator(".refine-status-error").count()) === 1 &&
        (await page.locator(".refine-status-empty").count()) === errorRows - 1
    );
    r.check(
      "429 はリトライしない（API 呼び出しは1回だけ）",
      callsAfter429 === 1,
      `calls=${callsAfter429}`
    );
    r.check(
      "停止した理由が画面に出る",
      ((await page.locator(".refine-error-note").textContent()) ?? "").includes("中断")
    );

    // --- 5xx：1回だけリトライし、駄目なら失敗にして次の行へ進む ---
    await setStubMode("500");
    await page.getByRole("button", { name: "一括変換" }).click();
    await page.waitForFunction(
      (total) => document.querySelectorAll(".refine-status-error").length >= total,
      errorRows,
      { timeout: 30000 }
    );
    await page.waitForTimeout(500);
    const callsAfter500 = await stubCalls();
    r.check(
      "5xx でも全行を処理して進む（途中で止まらない）",
      (await page.locator(".refine-status-error").count()) === errorRows
    );
    r.check(
      "5xx は1回だけリトライする（1行あたり2回）",
      callsAfter500 === errorRows * 2,
      `calls=${callsAfter500} rows=${errorRows}`
    );

    // --- 失敗した行は個別再変換ボタンから復旧できる（第5.5章） ---
    await setStubMode("ok");
    await page
      .locator("table.refine-table tbody tr:not(.refine-heading-row)")
      .first()
      .locator('button[title^="この行を再変換"]')
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".refine-status-done").length === 1,
      null,
      { timeout: 10000 }
    );
    r.check(
      "失敗した行は個別再変換ボタンから復旧できる",
      (await page.locator(".refine-status-done").count()) === 1 &&
        (await page.locator(".refine-status-error").count()) === errorRows - 1
    );

    /* ---- max_tokens で打ち切られた場合は失敗として扱う ---- */
    // 429/5xx とは別プロジェクトで確認する（前段の失敗・復旧の状態と混ざらないように）
    const truncUrl = await createProject(page, "max_tokens のテスト");
    await importJson(page, files.sample);
    await page.waitForFunction(
      () => document.querySelector(".save-state")?.textContent?.includes("保存済み"),
      null,
      { timeout: 8000 }
    );
    await page.goto(truncUrl + "/refine");
    await page.waitForSelector("table.refine-table");
    const truncRows = await page
      .locator("table.refine-table tbody tr:not(.refine-heading-row)")
      .count();

    await setStubMode("max_tokens");
    await page.getByRole("button", { name: "一括変換" }).click();
    await page.waitForFunction(
      (total) => document.querySelectorAll(".refine-status-error").length >= total,
      truncRows,
      { timeout: 30000 }
    );
    await page.waitForTimeout(300);
    const callsAfterTruncated = await stubCalls();
    r.check(
      "max_tokens で打ち切られた応答は成功扱いにせず、行を「失敗」にする",
      (await page.locator(".refine-status-error").count()) === truncRows
    );
    r.check(
      "429 とは違い、途中で止まらず最後の行まで処理する",
      (await page.locator(".refine-status-empty").count()) === 0
    );
    r.check(
      "max_tokens はリトライしない（1行あたり1回。5xx と違い再送しても再発しやすいため）",
      callsAfterTruncated === truncRows,
      `calls=${callsAfterTruncated} rows=${truncRows}`
    );
    r.check(
      "失敗理由に「出力が途中で切れた」旨が出る",
      ((await page.locator(".refine-error-note").textContent()) ?? "").includes("切れ")
    );

    // 個別再変換から復旧できる（第5.5章）
    await setStubMode("ok");
    await page
      .locator("table.refine-table tbody tr:not(.refine-heading-row)")
      .first()
      .locator('button[title^="この行を再変換"]')
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".refine-status-done").length === 1,
      null,
      { timeout: 10000 }
    );
    r.check(
      "打ち切られて失敗した行も個別再変換ボタンから復旧できる",
      (await page.locator(".refine-status-done").count()) === 1
    );

    /* ---- プリセット（第5.4章 / 文体の切り替え） ---- */
    r.check(
      "既定のプリセットは「公式議事録」",
      (await page.getByLabel("プロンプトのプリセット").inputValue()) === "formal"
    );
    await page.getByLabel("プロンプトのプリセット").selectOption("plain");
    r.check(
      "切り替えても既存の整文結果は変わらない旨が画面に出る",
      ((await page.locator(".refine-note").textContent()) ?? "").includes(
        "変換済み・手修正済みの行はそのまま"
      )
    );
    const doneBefore = await page
      .locator("table.refine-table textarea")
      .first()
      .inputValue();
    await page.waitForFunction(
      () => document.querySelector(".save-state")?.textContent?.includes("保存済み"),
      null,
      { timeout: 8000 }
    );
    await page.reload();
    await page.waitForSelector("table.refine-table");
    r.check(
      "選んだプリセットは保存され、再読み込みしても残る",
      (await page.getByLabel("プロンプトのプリセット").inputValue()) === "plain"
    );
    r.check(
      "プリセットを切り替えても既存の refinements は変わらない",
      (await page.locator("table.refine-table textarea").first().inputValue()) ===
        doneBefore,
      doneBefore
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
