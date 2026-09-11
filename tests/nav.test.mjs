import { BASE, launch, newProject, reporter } from "./helpers.mjs";

/**
 * ①話者整理・②整文・③出力の3画面が別 URL で存在し、
 * 相互に行き来できること（第8章 実装の順序 #3）。
 */
export default async function run() {
  const r = reporter("画面ナビゲーション");
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("pageerror", (e) => console.log("   [pageerror]", e.message));

  try {
    const editorUrl = await newProject(page, "ナビゲーションのテスト");
    const projectId = new URL(editorUrl).pathname.split("/").pop();

    r.check("①話者整理画面のURL", page.url() === editorUrl);

    // ① → ②
    await page.getByRole("link", { name: "整文" }).click();
    await page.waitForURL(`**/projects/${projectId}/refine`);
    r.check("①から②へ遷移できる", page.url().endsWith(`/refine`));
    r.check(
      "②のページにも同じナビゲーションがある",
      (await page.locator(".project-nav").count()) === 1
    );

    // ② → ③
    await page.getByRole("link", { name: "出力" }).click();
    await page.waitForURL(`**/projects/${projectId}/export`);
    r.check("②から③へ遷移できる", page.url().endsWith(`/export`));

    // ③ → ①
    await page.getByRole("link", { name: "話者整理" }).click();
    await page.waitForURL(editorUrl);
    r.check("③から①へ戻れる", page.url() === editorUrl);

    // 現在地はリンクにならない（自分自身へは飛べない）
    r.check(
      "現在地はリンクではなく文字表示",
      (await page.getByRole("link", { name: "話者整理", exact: true }).count()) === 0
    );

    // ブラウザの戻る操作が効く（タブ切り替えでなく別URLである証拠）
    await page.getByRole("link", { name: "整文" }).click();
    await page.waitForURL(`**/refine`);
    await page.goBack();
    await page.waitForURL(editorUrl);
    r.check("ブラウザの戻るボタンが効く", page.url() === editorUrl);

    // 直接 URL を開いても表示できる
    await page.goto(`${BASE}/projects/${projectId}/export`);
    r.check(
      "③のURLを直接開ける",
      (await page.locator(".project-nav").count()) === 1
    );

    // 一覧からも直接遷移できる
    await page.goto(`${BASE}/projects`);
    const row = page.locator(".project-row", { hasText: "ナビゲーションのテスト" });
    await row.getByRole("link", { name: "整文" }).click();
    await page.waitForURL(`**/refine`);
    r.check("一覧から直接②へ遷移できる", page.url().endsWith("/refine"));
  } finally {
    await browser.close();
  }

  return r.finish();
}

if (import.meta.filename === process.argv[1]) {
  process.exit((await run()) ? 0 : 1);
}
