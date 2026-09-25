import { buildFixtures } from "./fixtures.mjs";
import { importJson, launch, newProject, reporter } from "./helpers.mjs";

/**
 * 話者ピッカー（`@` で開く参加者の候補）の操作性。
 *
 * - 画面の下のほうで開いても候補全体が見えるよう、開いた瞬間に1回だけ
 *   スクロールする。候補の絞り込みで再描画されても再発火しない
 * - Escape で閉じられ、閉じたあとは上下キーが本文のカーソル移動に戻る
 */
export default async function run() {
  const files = buildFixtures();
  const r = reporter("話者ピッカー");
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on("pageerror", (e) => console.log("   [pageerror]", e.message));

  /** ピッカーと左ペインの表示範囲（画面座標） */
  const measure = () =>
    page.evaluate(() => {
      const scroller = document.querySelector(".editor-scroll");
      const box = document.querySelector(".suggest");
      const view = scroller.getBoundingClientRect();
      const rect = box?.getBoundingClientRect();
      return {
        scrollTop: scroller.scrollTop,
        viewTop: view.top,
        viewBottom: view.bottom,
        boxTop: rect?.top ?? null,
        boxBottom: rect?.bottom ?? null,
      };
    });

  /**
   * 何もない行の頭にカーソルを置き、その行が左ペインの下端から
   * `fromBottom` px の位置に来るようスクロールしておく。
   * 返り値はカーソル位置（本文内オフセット）。
   */
  const placeCaretNearBottom = (fromBottom) =>
    page.evaluate((fromBottom) => {
      const ta = document.querySelector("textarea.editor-input");
      const scroller = document.querySelector(".editor-scroll");
      const mirror = document.querySelector(".editor-mirror");
      // 文書の中ほどに空行を1つ作り、そこでピッカーを開く
      const at = ta.value.indexOf("\n", Math.floor(ta.value.length * 0.4)) + 1;
      ta.focus();
      ta.setSelectionRange(at, at);
      document.execCommand("insertText", false, "\n");
      ta.setSelectionRange(at, at);

      mirror.textContent = ta.value.slice(0, at);
      const marker = document.createElement("span");
      marker.textContent = "​";
      mirror.appendChild(marker);
      const lineTop = marker.offsetTop;
      const lineHeight = marker.offsetHeight;
      mirror.textContent = "";

      scroller.scrollTop = lineTop + lineHeight - scroller.clientHeight + fromBottom;
      return at;
    }, fromBottom);

  try {
    await newProject(page, "話者ピッカーのテスト");
    await importJson(page, files.medium, 500);

    const partsTa = page.locator("textarea.participant-text");
    await partsTa.fill(
      [
        "●●小/太田",
        "県教委/山田",
        "●●小/田中",
        "●●小/佐藤",
        "●●小/鈴木",
        "県教委/高橋",
        "県教委/伊藤",
        "県教委/渡辺",
        "●●小/中村",
        "●●小/小林",
        "県教委/加藤",
        "県教委/吉川",
      ].join("\n")
    );
    await partsTa.blur();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "設定を閉じる" }).click();
    await page.waitForTimeout(300);

    /* ---- 開いた瞬間に1回だけスクロールする ---- */
    await placeCaretNearBottom(40);
    await page.waitForTimeout(200);
    const before = await measure();

    await page.keyboard.type("@");
    await page.waitForSelector(".suggest", { timeout: 3000 });
    await page.waitForTimeout(200);
    const opened = await measure();
    r.check(
      "画面の下のほうで開くと、候補全体が見えるまでスクロールする",
      opened.scrollTop > before.scrollTop && opened.boxBottom <= opened.viewBottom,
      JSON.stringify({ before, opened })
    );
    r.check(
      "入力中の行（候補の上端）は画面から外れない",
      opened.boxTop >= opened.viewTop,
      JSON.stringify(opened)
    );

    // 候補が画面からはみ出す位置に戻してから絞り込む。
    // 絞り込みで再描画されても、ここではスクロールし直さない
    await page.evaluate((top) => {
      document.querySelector(".editor-scroll").scrollTop = top;
    }, before.scrollTop);
    await page.waitForTimeout(100);
    await page.keyboard.type("田");
    await page.waitForTimeout(300);
    const filtered = await measure();
    r.check(
      "絞り込みで再描画されても、再スクロールしない",
      (await page.locator(".suggest-item").count()) === 3 &&
        filtered.scrollTop === before.scrollTop,
      JSON.stringify({ before: before.scrollTop, after: filtered.scrollTop })
    );

    /* ---- Escape で閉じ、上下キーを本文に戻す ---- */
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    r.check("Escape でピッカーが閉じる", (await page.locator(".suggest").count()) === 0);

    const caretBefore = await page.evaluate(
      () => document.querySelector("textarea.editor-input").selectionStart
    );
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(200);
    const caretAfterDown = await page.evaluate(
      () => document.querySelector("textarea.editor-input").selectionStart
    );
    r.check(
      "閉じたあとは ↓ で本文のカーソルが動く",
      caretAfterDown > caretBefore && (await page.locator(".suggest").count()) === 0,
      `${caretBefore} -> ${caretAfterDown}`
    );
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(200);
    const caretAfterUp = await page.evaluate(
      () => document.querySelector("textarea.editor-input").selectionStart
    );
    r.check(
      "閉じたあとは ↑ でも本文のカーソルが動く",
      caretAfterUp < caretAfterDown,
      `${caretAfterDown} -> ${caretAfterUp}`
    );

    // 途中まで打った `@田` は、未登録の @ と同じく印付きで本文に残る
    r.check(
      "Escape で閉じた @ の書きかけは本文に残る",
      (await page.locator("textarea.editor-input").inputValue()).includes("\n@田\n")
    );
    r.check(
      "書きかけの @ には未登録の印が付く",
      (await page.locator(".editor-overlay .ov-mention-unknown").count()) > 0
    );

    /* ---- 区切り行の時刻（--@12.3）ではピッカーを開かない ---- */
    await page.evaluate(() => {
      const ta = document.querySelector("textarea.editor-input");
      const at = ta.value.search(/\n--@\d/) + 3; // `--@` の直後
      ta.focus();
      ta.setSelectionRange(at + 1, at + 1);
    });
    await page.keyboard.press("ArrowLeft"); // keyup でピッカーの判定が走る
    await page.waitForTimeout(200);
    r.check(
      "区切り行の --@秒 の @ ではピッカーが開かない（上下キーを取られない）",
      (await page.locator(".suggest").count()) === 0
    );

    /* ---- 別の @ を打てば、また普通に開く ---- */
    await page.evaluate(() => {
      const ta = document.querySelector("textarea.editor-input");
      const at = ta.value.indexOf("\n@田\n") + 3;
      ta.focus();
      ta.setSelectionRange(at, at);
    });
    await page.keyboard.press("End");
    await page.keyboard.type("@");
    await page.waitForSelector(".suggest", { timeout: 3000 });
    r.check("別の @ を打てば、またピッカーが開く", true);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    r.check(
      "2回目も Escape で閉じられる",
      (await page.locator(".suggest").count()) === 0
    );

    /* ---- Enter で確定したあと、ピッカーが開き直さない ---- */
    // 下に既存の行がある空行で確定すると改行を足さないため、カーソルは
    // `@所属/氏名` の直後に残る。そこで Enter の keyup が開き直していた
    await page.evaluate(() => {
      const ta = document.querySelector("textarea.editor-input");
      const at = ta.value.indexOf("\n", Math.floor(ta.value.length * 0.6)) + 1;
      ta.focus();
      ta.setSelectionRange(at, at);
      document.execCommand("insertText", false, "\n");
      ta.setSelectionRange(at, at);
    });
    await page.keyboard.type("@");
    await page.waitForSelector(".suggest", { timeout: 3000 });
    await page.keyboard.type("山田");
    await page.waitForTimeout(150);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    const committed = await page.evaluate(() => {
      const ta = document.querySelector("textarea.editor-input");
      return ta.value.slice(ta.selectionStart - "@県教委/山田".length, ta.selectionStart + 1);
    });
    r.check(
      "確定した @ は既存の改行の手前で終わる（空行は増えない）",
      committed === "@県教委/山田\n",
      JSON.stringify(committed)
    );
    r.check(
      "Enter で確定したあと、ピッカーが開き直さない",
      (await page.locator(".suggest").count()) === 0
    );
    const caretBeforeDown = await page.evaluate(
      () => document.querySelector("textarea.editor-input").selectionStart
    );
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(200);
    r.check(
      "確定直後の ↓ は本文のカーソル移動になる",
      (await page.evaluate(
        () => document.querySelector("textarea.editor-input").selectionStart
      )) > caretBeforeDown && (await page.locator(".suggest").count()) === 0
    );

    /* ---- 矢印キーやクリックで既存の @ の上を通っても開かない ---- */
    // メンションは必ず1行に1つになったので、上下移動でカーソルが
    // `@所属/氏名` の途中や直後に止まることが多い
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(200);
    r.check(
      "↑ で確定済みの @ の行に戻ってもピッカーは開かない",
      (await page.locator(".suggest").count()) === 0
    );
    await page.evaluate(() => {
      const ta = document.querySelector("textarea.editor-input");
      const at = ta.value.indexOf("@県教委/山田") + 3; // `@県教` の直後
      ta.focus();
      ta.setSelectionRange(at, at);
    });
    await page.locator("textarea.editor-input").dispatchEvent("click");
    await page.waitForTimeout(200);
    r.check(
      "クリックで @ の途中にカーソルを置いてもピッカーは開かない",
      (await page.locator(".suggest").count()) === 0
    );
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(200);
    r.check(
      "そこからの ↓ も本文のカーソル移動になる",
      (await page.locator(".suggest").count()) === 0
    );

    /* ---- ↑↓ で選んだ候補が、候補の枠の中でスクロールして見える ---- */
    await page.evaluate(() => {
      const ta = document.querySelector("textarea.editor-input");
      ta.focus();
      ta.setSelectionRange(0, 0);
    });
    await page.keyboard.type("@");
    await page.waitForSelector(".suggest", { timeout: 3000 });
    const total = await page.locator(".suggest-item").count();
    for (let i = 0; i < total - 1; i++) await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(200);
    const lastVisible = await page.evaluate(() => {
      const box = document.querySelector(".suggest").getBoundingClientRect();
      const item = document
        .querySelector('.suggest-item[aria-selected="true"]')
        .getBoundingClientRect();
      return item.top >= box.top && item.bottom <= box.bottom;
    });
    r.check(
      "↓ で一番下の候補まで進むと、候補の枠がスクロールして見える",
      total === 12 && lastVisible,
      `total=${total}`
    );
    await page.keyboard.press("ArrowDown"); // 先頭へ戻る
    await page.waitForTimeout(200);
    const firstVisible = await page.evaluate(() => {
      const box = document.querySelector(".suggest").getBoundingClientRect();
      const item = document
        .querySelector('.suggest-item[aria-selected="true"]')
        .getBoundingClientRect();
      return item.top >= box.top && item.bottom <= box.bottom;
    });
    r.check("末尾から先頭へ戻ったときも見える", firstVisible);

    /* ---- ピッカー表示中にカーソルを動かしたら閉じる（移動先で確定しない） ---- */
    // ← → で動かしても同じ `@…` の中にいる限り開いたままだったため、
    // 移動先で Enter を押すと、そこで選択中の候補が確定していた
    await page.keyboard.type("山");
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowLeft"); // `@` と `山` の間へ
    await page.waitForTimeout(200);
    r.check(
      "ピッカー表示中に ← でカーソルを動かすと閉じる",
      (await page.locator(".suggest").count()) === 0
    );
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    const head = await page.locator("textarea.editor-input").inputValue();
    r.check(
      "移動先の Enter は普通の改行になり、選択中の候補は確定しない",
      head.startsWith("@\n山"),
      JSON.stringify(head.slice(0, 12))
    );

    // 日本語は語の間に空白が無いので、→ で本文側へ動かしても
    // 同じ `@…` の続きとみなされていた
    await page.evaluate(() => {
      const ta = document.querySelector("textarea.editor-input");
      ta.focus();
      ta.setSelectionRange(2, 2); // 「山本日は…」の行頭（直前の確認で作った行）
    });
    await page.keyboard.type("@佐");
    await page.waitForSelector(".suggest", { timeout: 3000 });
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(200);
    r.check(
      "ピッカー表示中に → で本文側へ動かすと閉じる",
      (await page.locator(".suggest").count()) === 0
    );

    await page.evaluate(() => {
      const ta = document.querySelector("textarea.editor-input");
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
    await page.keyboard.type("\n@");
    await page.waitForSelector(".suggest", { timeout: 3000 });
    await page.locator("textarea.editor-input").click({ position: { x: 40, y: 20 } });
    await page.waitForTimeout(200);
    r.check(
      "ピッカー表示中にクリックでカーソルを動かすと閉じる",
      (await page.locator(".suggest").count()) === 0
    );
  } finally {
    await browser.close();
  }

  return r.finish();
}

if (import.meta.filename === process.argv[1]) {
  process.exit((await run()) ? 0 : 1);
}
