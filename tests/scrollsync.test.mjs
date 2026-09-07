import { buildFixtures } from "./fixtures.mjs";
import { importJson, launch, newProject, reporter } from "./helpers.mjs";

/**
 * 左右のスクロール連動。
 * 両ペインは高さがまったく違うので、「同じ画素だけ動く」ではなく
 * 「同じブロックが上端に来る」ことを確かめる。
 */
export default async function run() {
  const files = buildFixtures();
  const r = reporter("スクロール連動");
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on("pageerror", (e) => console.log("   [pageerror]", e.message));

  /** 各ペインの上端に見えているブロック番号を読む */
  const topBlocks = () =>
    page.evaluate(() => {
      const read = (scroller, children) => {
        if (!scroller || children.length === 0) return null;
        const base = scroller.getBoundingClientRect().top;
        let found = null;
        for (let i = 0; i < children.length; i++) {
          const top =
            children[i].getBoundingClientRect().top - base + scroller.scrollTop;
          if (top <= scroller.scrollTop + 1) found = i;
          else break;
        }
        return found;
      };
      const leftScroller = document.querySelector(".editor-scroll");
      const overlay = document.querySelector(".editor-overlay");
      const rightScroller = document.querySelector(".table-scroll");
      const rows = document.querySelectorAll("table.minutes tbody tr");

      // 左は「行」単位なので、ブロック先頭行の一覧から引き直す
      const lines = overlay ? [...overlay.children] : [];
      const blockFirstLines = [];
      lines.forEach((el, i) => {
        if (el.classList.contains("ov-done") || el.classList.contains("ov-todo")) {
          blockFirstLines.push(i);
        }
      });
      const leftLine = read(leftScroller, lines);
      let leftBlock = null;
      for (let b = 0; b < blockFirstLines.length; b++) {
        if (blockFirstLines[b] <= leftLine) leftBlock = b;
        else break;
      }

      return {
        left: leftBlock,
        right: read(rightScroller, [...rows]),
        leftHeight: leftScroller?.scrollHeight ?? 0,
        rightHeight: rightScroller?.scrollHeight ?? 0,
        leftTop: leftScroller?.scrollTop ?? 0,
        rightTop: rightScroller?.scrollTop ?? 0,
      };
    });

  const scrollPane = (selector, top) =>
    page.evaluate(
      ([sel, y]) => {
        document.querySelector(sel).scrollTop = y;
      },
      [selector, top]
    );

  try {
    await newProject(page, "スクロール連動テスト");
    await importJson(page, files.big, 40000);
    await page.getByRole("button", { name: "設定を閉じる" }).click();
    await page.waitForTimeout(1500);

    const sizes = await topBlocks();
    r.log(
      `左の高さ ${sizes.leftHeight}px / 右の高さ ${sizes.rightHeight}px（比 ${(
        sizes.leftHeight / sizes.rightHeight
      ).toFixed(2)}）`
    );
    r.check(
      "両ペインの高さは実際に食い違っている（割合合わせでは無理な状況）",
      Math.abs(sizes.leftHeight / sizes.rightHeight - 1) > 0.1,
      `${sizes.leftHeight} vs ${sizes.rightHeight}`
    );

    r.check(
      "連動ボタンが既定でオンになっている",
      (await page.getByRole("button", { name: /連動中/ }).count()) === 1
    );

    // 左を動かすと右が追いつく
    for (const y of [4000, 12000, 30000]) {
      await scrollPane(".editor-scroll", y);
      await page.waitForTimeout(250);
      const at = await topBlocks();
      r.check(
        `左を ${y}px へ → 上端のブロックが一致（左 ${at.left} / 右 ${at.right}）`,
        at.left != null && at.right != null && Math.abs(at.left - at.right) <= 1,
        JSON.stringify(at)
      );
    }

    // 右を動かすと左が追いつく（逆向きも効く）
    for (const y of [2000, 9000]) {
      await scrollPane(".table-scroll", y);
      await page.waitForTimeout(250);
      const at = await topBlocks();
      r.check(
        `右を ${y}px へ → 上端のブロックが一致（左 ${at.left} / 右 ${at.right}）`,
        at.left != null && at.right != null && Math.abs(at.left - at.right) <= 1,
        JSON.stringify(at)
      );
    }

    // 揺り戻し（お互いを引っぱり合って止まらなくなる）が起きないこと
    await scrollPane(".editor-scroll", 20000);
    await page.waitForTimeout(400);
    const settled = await topBlocks();
    await page.waitForTimeout(700);
    const after = await topBlocks();
    r.check(
      "同期後に位置が動き続けない",
      Math.abs(settled.leftTop - after.leftTop) < 2 &&
        Math.abs(settled.rightTop - after.rightTop) < 2,
      JSON.stringify({ settled, after })
    );

    // オフにすると連動しない
    await page.getByRole("button", { name: /連動中/ }).click();
    await page.waitForTimeout(300);
    const before = await topBlocks();
    await scrollPane(".editor-scroll", 40000);
    await page.waitForTimeout(400);
    const off = await topBlocks();
    r.check(
      "オフにすると右は動かない",
      Math.abs(off.rightTop - before.rightTop) < 2,
      JSON.stringify({ before: before.rightTop, off: off.rightTop })
    );
    r.check(
      "ボタンの表示がオフに変わる",
      (await page.getByRole("button", { name: /連動オフ/ }).count()) === 1
    );

    // Alt+S で戻せる
    await page.keyboard.press("Alt+KeyS");
    await page.waitForTimeout(400);
    r.check(
      "Alt+S で連動を戻せる",
      (await page.getByRole("button", { name: /連動中/ }).count()) === 1
    );

    // 表の行をクリックすると両方がその発言へ寄る
    await page.evaluate(() => {
      document.querySelectorAll("table.minutes tbody tr")[60].click();
    });
    await page.waitForTimeout(900);
    const clicked = await topBlocks();
    r.check(
      "行をクリックすると両ペインが同じ発言へ寄る",
      clicked.left != null &&
        clicked.right != null &&
        Math.abs(clicked.left - clicked.right) <= 2,
      JSON.stringify(clicked)
    );

    // 設定が保存される
    await page.waitForTimeout(700);
    await page.reload();
    await page.waitForSelector("textarea.editor-input");
    r.check(
      "連動の設定が再読み込み後も残る",
      (await page.getByRole("button", { name: /連動中/ }).count()) === 1
    );
  } finally {
    await browser.close();
  }

  return r.finish();
}

if (import.meta.filename === process.argv[1]) {
  process.exit((await run()) ? 0 : 1);
}
