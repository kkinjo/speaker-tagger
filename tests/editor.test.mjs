import { buildFixtures } from "./fixtures.mjs";
import { importJson, launch, newProject, reporter } from "./helpers.mjs";

/** 編集画面の中心的な動き：取り込み・@サジェスト・区切り・見出し・表・取り消し */
export default async function run() {
  const files = buildFixtures();
  const r = reporter("編集");
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on("pageerror", (e) => console.log("   [pageerror]", e.message));

  try {
    await newProject(page, "6月 校内研修 打合せ");
    await importJson(page, files.sample);

    const rawText = await page.locator("textarea.editor-input").inputValue();
    r.check("JSON が左ペインに取り込まれる", rawText.includes("おはようございます"));
    r.check(
      "話者交代の位置に区切りが入る",
      /\n--@\d+(\.\d+)?\n/.test(rawText),
      JSON.stringify(rawText.slice(0, 60))
    );
    r.check(
      "区切りに時刻が付いている（本文を編集しても失われない）",
      (rawText.match(/^--@\d+(\.\d+)?$/gm) ?? []).length >= 5
    );

    // 参加者の登録（1行1人のテキストエリア。フォーカスを外した時点で確定する）
    const partsTa = page.locator("textarea.participant-text");
    await partsTa.fill("●●小/太田\n県教委/山田\n●●小/田中");
    r.check(
      "入力中はまだ確定しない",
      ((await page.locator(".participant-note").first().textContent()) ?? "").includes(
        "0名"
      )
    );
    await partsTa.blur();
    await page.waitForTimeout(200);
    r.check(
      "フォーカスを外すと3名登録される",
      ((await page.locator(".participant-note").first().textContent()) ?? "").includes(
        "3名"
      )
    );
    await page.getByRole("button", { name: "設定を閉じる" }).click();

    // @ サジェスト
    const ta = page.locator("textarea.editor-input");
    await ta.click();
    await page.evaluate(() => {
      const el = document.querySelector("textarea.editor-input");
      el.focus();
      el.setSelectionRange(0, 0);
    });
    await page.keyboard.type("@");
    await page.waitForSelector(".suggest", { timeout: 3000 });
    const items = await page.locator(".suggest-item").allTextContents();
    r.check("候補は登録した参加者だけ", items.length === 3, JSON.stringify(items));

    await page.keyboard.type("山田");
    await page.waitForTimeout(150);
    const filtered = await page.locator(".suggest-item").allTextContents();
    r.check(
      "入力で候補が絞られる",
      filtered.length === 1 && filtered[0].includes("山田"),
      JSON.stringify(filtered)
    );
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    const afterMention = await ta.inputValue();
    r.check(
      "キーボードだけで話者を確定できる（確定すると常に改行が入る）",
      afterMention.startsWith("@県教委/山田\n"),
      JSON.stringify(afterMention.slice(0, 20))
    );

    await page.keyboard.press("Control+Home");
    await page.keyboard.type("@");
    await page.waitForSelector(".suggest");
    const mruItems = await page.locator(".suggest-item").allTextContents();
    r.check("直近に使った話者が先頭に出る", mruItems[0].includes("山田"));
    await page.keyboard.press("Escape");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(400);

    // 未登録の名前は話者にしない（日本語は語間に空白が無く、
    // 当てずっぽうに拾うと一文まるごと氏名になってしまう）
    await page.evaluate(() => {
      const el = document.querySelector("textarea.editor-input");
      el.focus();
      const at = el.value.indexOf("はい、そちらで");
      el.setSelectionRange(at, at);
      document.execCommand("insertText", false, "@未登録の人");
    });
    await page.waitForTimeout(400);
    const speakerCells = await page.locator("table.minutes td.speaker").allTextContents();
    r.check(
      "未登録の @ は話者にならない",
      speakerCells.every((c) => !c.includes("未登録の人")),
      JSON.stringify(speakerCells.find((c) => c.includes("未登録")) ?? "")
    );
    await page.evaluate(() => {
      const el = document.querySelector("textarea.editor-input");
      const at = el.value.indexOf("@未登録の人");
      el.focus();
      el.setSelectionRange(at, at + "@未登録の人".length);
      document.execCommand("insertText", false, "");
    });
    await page.waitForTimeout(300);

    r.check(
      "表の話者列に反映される",
      (
        await page
          .locator("table.minutes tbody tr")
          .first()
          .locator("td.speaker")
          .textContent()
      )?.includes("県教委/山田")
    );

    const progress = (await page.locator(".progress").first().textContent())?.replace(
      /\s+/g,
      " "
    );
    r.log("進捗表示:", progress?.trim());
    r.check("未割り当て件数が表示される", /全 \d+ ブロック中/.test(progress ?? ""));

    // 話者の付け替え：既存の @ を消して打ち直したとき、直後に元からあった
    // 改行が残っていても二重に改行が入らない（空行が増えない）ことを確認する
    await page.evaluate(() => {
      const el = document.querySelector("textarea.editor-input");
      el.focus();
      el.setSelectionRange(0, "@県教委/山田".length);
      document.execCommand("delete");
    });
    await page.keyboard.type("@");
    await page.waitForSelector(".suggest");
    await page.keyboard.type("太田");
    await page.waitForTimeout(150);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    const reassigned = await ta.inputValue();
    r.check(
      "話者を付け替えても改行が重複せず、空行が増えない",
      reassigned.startsWith("@●●小/太田\n") &&
        !reassigned.startsWith("@●●小/太田\n\n"),
      JSON.stringify(reassigned.slice(0, 20))
    );

    // 見出し
    await page.evaluate(() => {
      const el = document.querySelector("textarea.editor-input");
      el.focus();
      el.setSelectionRange(0, 0);
      document.execCommand("insertText", false, "# 議題1 開会\n");
    });
    await page.waitForTimeout(400);
    r.check(
      "見出し行が表に出る",
      (await page.locator("table.minutes tr.heading-row").count()) === 1
    );
    r.check(
      "見出しは時刻・話者・発言の3列をまたぐ",
      (await page.locator("table.minutes tr.heading-row td").getAttribute("colspan")) ===
        "3"
    );
    r.check(
      "見出しは編集画面でも区別される",
      (await page.locator(".editor-overlay .ov-head").count()) === 1
    );

    r.check(
      "区切り行が線として表示される",
      (await page.locator(".editor-overlay .ov-sep").count()) > 0
    );
    r.check(
      "話者交代のヒントが点線で出る",
      (await page.locator(".editor-overlay .ov-hint").count()) > 0
    );

    // 装飾レイヤと本文がずれていないこと
    const align = await page.evaluate(() => {
      const ta = document.querySelector("textarea.editor-input");
      const ov = document.querySelector(".editor-overlay");
      return {
        taH: ta.scrollHeight,
        ovH: ov.scrollHeight,
        taW: ta.clientWidth,
        ovW: ov.clientWidth,
      };
    });
    r.check(
      "装飾レイヤの高さが本文と一致",
      Math.abs(align.taH - align.ovH) <= 2,
      JSON.stringify(align)
    );
    r.check("装飾レイヤの幅が本文と一致", align.taW === align.ovW, JSON.stringify(align));

    // 取り消し・やり直し
    const beforeUndo = await ta.inputValue();
    await ta.click();
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(200);
    const afterUndo = await ta.inputValue();
    r.check(
      "プログラムからの挿入も Ctrl+Z で戻せる",
      afterUndo !== beforeUndo && !afterUndo.startsWith("# 議題1")
    );
    await page.keyboard.press("Control+Shift+z");
    await page.waitForTimeout(200);
    r.check("Ctrl+Shift+Z でやり直せる", (await ta.inputValue()) === beforeUndo);

    // 時刻（常時表示）
    await page.waitForTimeout(300);
    const timeCells = await page.locator("table.minutes td.time").allTextContents();
    r.check(
      "単語の時刻が各行に割り当たる",
      timeCells.filter((t) => /\d+:\d\d/.test(t)).length >= 5,
      JSON.stringify(timeCells.slice(0, 6))
    );

    // 未割り当てへのジャンプ
    await page.getByRole("button", { name: "次の未割り当てへ" }).click();
    await page.waitForTimeout(400);
    r.check(
      "未割り当ての次の箇所へ移動する",
      (await page.evaluate(
        () => document.querySelector("textarea.editor-input").selectionStart
      )) > 0
    );

    // ペイン切り替え
    await page.keyboard.press("Alt+Digit1");
    await page.waitForTimeout(200);
    r.check("Alt+1 で左のみ", (await page.locator("table.minutes").count()) === 0);
    await page.keyboard.press("Alt+Digit3");
    await page.waitForTimeout(200);
    r.check(
      "Alt+3 で右のみ",
      (await page.locator("textarea.editor-input").count()) === 0
    );
    await page.keyboard.press("Alt+Digit2");
    await page.waitForTimeout(200);
    r.check(
      "Alt+2 で両方",
      (await page.locator("textarea.editor-input").count()) === 1 &&
        (await page.locator("table.minutes").count()) === 1
    );

    // 文字サイズ
    const sizeBefore = await page.evaluate(
      () => getComputedStyle(document.querySelector("textarea.editor-input")).fontSize
    );
    await page.keyboard.press("Alt+Equal");
    await page.keyboard.press("Alt+Equal");
    await page.waitForTimeout(900);
    const sizeAfter = await page.evaluate(
      () => getComputedStyle(document.querySelector("textarea.editor-input")).fontSize
    );
    r.check(
      "Alt+= で文字が大きくなる",
      parseFloat(sizeAfter) === parseFloat(sizeBefore) + 2,
      `${sizeBefore} -> ${sizeAfter}`
    );

    await page.waitForFunction(
      () => document.querySelector(".save-state")?.textContent?.includes("保存済み"),
      null,
      { timeout: 8000 }
    );
    r.check("自動保存され「保存済み」になる", true);

    r.check(
      "①の表形式ビューに「表をコピー」ボタンは無い（③に一本化。第7章 7.4）",
      (await page.getByRole("button", { name: "表をコピー" }).count()) === 0
    );

    // 再読み込み後も残る
    await page.reload();
    await page.waitForSelector("textarea.editor-input");
    r.check(
      "再読み込みしても本文が残る",
      (await page.locator("textarea.editor-input").inputValue()).includes(
        "@●●小/太田"
      )
    );
    r.check(
      "文字サイズの設定も残る",
      (await page.evaluate(
        () => getComputedStyle(document.querySelector("textarea.editor-input")).fontSize
      )) === sizeAfter
    );

    // 保存済みの参加者がテキストエリアへ展開される
    await page.getByRole("button", { name: "取り込み・参加者" }).click();
    const reopened = page.locator("textarea.participant-text");
    r.check(
      "既存の参加者が1行1人でテキストエリアに展開される",
      (await reopened.inputValue()) === "●●小/太田\n県教委/山田\n●●小/田中",
      JSON.stringify(await reopened.inputValue())
    );
    r.check(
      "登録済みの件数が出る",
      ((await page.locator(".participant-note").first().textContent()) ?? "").includes(
        "3名"
      )
    );

    // 行を消すと参加者も消える
    await reopened.fill("●●小/太田\n県教委/山田");
    await reopened.blur();
    await page.waitForTimeout(200);
    r.check(
      "行を消すとその参加者も消える",
      ((await page.locator(".participant-note").first().textContent()) ?? "").includes(
        "2名"
      )
    );
    await page.locator("textarea.editor-input").click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.type("@");
    await page.waitForSelector(".suggest");
    r.check(
      "消した参加者は @ の候補にも出なくなる",
      (await page.locator(".suggest-item").allTextContents()).every(
        (t) => !t.includes("田中")
      )
    );
    await page.keyboard.press("Escape");
    await page.keyboard.press("Backspace");

    r.check(
      "廃止したボタンが残っていない",
      (await page.getByRole("button", { name: "＋ 1人追加" }).count()) === 0 &&
        (await page.locator(".participant-row").count()) === 0
    );
  } finally {
    await browser.close();
  }

  return r.finish();
}

if (import.meta.filename === process.argv[1]) {
  process.exit((await run()) ? 0 : 1);
}
