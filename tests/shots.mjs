import { buildFixtures } from "./fixtures.mjs";
import { BASE, importJson, launch, newProject } from "./helpers.mjs";

/** 画面の見た目を目視確認するためのスクリーンショット取得（テストではない） */
const out = process.argv[2] ?? ".";
const files = buildFixtures();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

await page.goto(`${BASE}/login`);
await page.screenshot({ path: `${out}/01-login.png` });

await newProject(page, "6月 校内研修 打合せ");
await page.screenshot({ path: `${out}/02-empty.png` });

await importJson(page, files.sample);
await page.getByRole("button", { name: "まとめて貼り付け" }).click();
await page
  .locator("textarea[placeholder^='1行に1人']")
  .fill("宮崎小/河野\n県教委/山田\n宮崎小/田中");
await page.getByRole("button", { name: "この内容で追加" }).click();
await page.screenshot({ path: `${out}/03-setup.png` });

await page.getByRole("button", { name: "設定を閉じる" }).click();
await page.locator('input[type="file"][accept*="audio"]').setInputFiles(files.wav);
await page.waitForSelector("audio", { state: "attached" });

await page.evaluate(() => {
  const el = document.querySelector("textarea.editor-input");
  el.focus();
  el.setSelectionRange(0, 0);
  document.execCommand(
    "insertText",
    false,
    "# 議題1 開会について\n@宮崎小/河野 "
  );
});
await page.waitForTimeout(500);
await page.getByRole("button", { name: "次の未割り当てへ" }).click();
await page.waitForTimeout(300);
await page.keyboard.type("@山田");
await page.waitForSelector(".suggest");
await page.screenshot({ path: `${out}/04-suggest.png` });
await page.keyboard.press("Enter");
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/05-editing.png` });

await page.goto(`${BASE}/projects`);
await page.screenshot({ path: `${out}/06-list.png` });

await browser.close();
console.log("saved to", out);
