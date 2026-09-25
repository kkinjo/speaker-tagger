import { buildFixtures } from "./fixtures.mjs";
import { BASE, importJson, launch, newProject, reporter } from "./helpers.mjs";

/**
 * 音声ファイルの保存（ブラウザの IndexedDB）と、保存されていないときの扱い。
 *
 * 音声のファイル名・サイズはサーバー、本体はこのブラウザに保存しており、
 * 両者がずれることがある（ブラウザのデータ消去・別の端末・保存の失敗など）。
 * ずれたときは、音の出ない再生バーではなく「選び直す」画面を出す。
 */
export default async function run() {
  const files = buildFixtures();
  const r = reporter("音声の保存");
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on("pageerror", (e) => console.log("   [pageerror]", e.message));

  // 書き込み要求は成功したあとで、トランザクションが中断される状況を再現する。
  // （容量不足や、元ファイルを保存時に読めなかった場合など。Chrome はこの場合、
  //  要求の success を返したあとでトランザクションを abort する）
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const req = put.apply(this, args);
      if (window.__failAudioSave) {
        const t = this.transaction;
        req.addEventListener("success", () => t.abort());
      }
      return req;
    };
  });

  const pickButton = () => page.getByRole("button", { name: "音声ファイルを選ぶ" }).count();
  const playButton = () => page.locator(".audiobar button", { hasText: "再生" }).count();
  const audioEl = () => page.locator("audio").count();
  const pick = async () => {
    await page.locator('input[type="file"][accept*="audio"]').setInputFiles(files.wav);
    await page.waitForSelector("audio", { state: "attached", timeout: 8000 });
  };
  const waitSaved = () =>
    page.waitForFunction(
      () =>
        !document.querySelector(".audiobar")?.textContent?.includes("保存中") &&
        document.querySelector(".save-state")?.textContent?.includes("保存済み"),
      null,
      { timeout: 10000 }
    );
  /** 整文画面へ移って戻る */
  const roundTrip = async (url) => {
    await page.goto(url + "/refine");
    await page.waitForSelector("table.refine-table");
    await page.goto(url);
    await page.waitForSelector("textarea.editor-input");
    await page.waitForTimeout(800);
  };

  try {
    const url = await newProject(page, "音声の保存のテスト");
    await importJson(page, files.sample);
    const close = page.getByRole("button", { name: "設定を閉じる" });
    if (await close.count()) await close.click();

    /* ---- 普通に保存できた場合：画面を移っても外れない ---- */
    await pick();
    await waitSaved();
    await roundTrip(url);
    r.check(
      "整文へ移って戻っても音声は付いたまま",
      (await audioEl()) === 1 && (await playButton()) === 1
    );
    await page.goto(`${BASE}/projects`);
    await page.waitForSelector(".project-row");
    await page.waitForTimeout(500);
    r.check(
      "一覧に「音声あり」が出る（このブラウザに保存されているとき）",
      (await page.locator(".project-row .badge", { hasText: "音声あり" }).count()) === 1
    );

    /* ---- このブラウザに本体が無い：音の出ない再生バーではなく、選び直す画面 ---- */
    await page.evaluate(
      (id) =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open("speaker-tagger-audio", 1);
          open.onsuccess = () => {
            const t = open.result.transaction("files", "readwrite");
            t.objectStore("files").delete(id);
            t.oncomplete = () => {
              open.result.close();
              resolve();
            };
            t.onerror = () => reject(t.error);
          };
        }),
      url.split("/").pop()
    );
    await page.reload();
    await page.waitForSelector(".project-row");
    await page.waitForTimeout(500);
    r.check(
      "本体が無いときは一覧に「音声あり」を出さない",
      (await page.locator(".project-row .badge", { hasText: "音声あり" }).count()) === 0
    );
    await page.goto(url);
    await page.waitForSelector("textarea.editor-input");
    await page.waitForTimeout(800);
    r.check(
      "本体が無いときは「音声ファイルを選ぶ」がすぐ出る（外す操作は要らない）",
      (await pickButton()) === 1 && (await playButton()) === 0 && (await audioEl()) === 0
    );
    r.check(
      "このブラウザに保存されていない旨とファイル名が出る",
      ((await page.locator(".audiobar").textContent()) ?? "").includes(
        "このブラウザには保存されていません"
      ) &&
        ((await page.locator(".audiobar").textContent()) ?? "").includes("meeting.wav")
    );
    await pick();
    await waitSaved();
    r.check("選び直すと、そのまま再生できる", (await playButton()) === 1);
    await roundTrip(url);
    r.check("選び直したあとは画面を移っても外れない", (await audioEl()) === 1);

    /* ---- 保存に失敗した場合：理由を出し、このページでは再生できる ---- */
    await page.getByRole("button", { name: "音声を外す" }).click();
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      window.__failAudioSave = true;
    });
    await pick();
    await page.waitForFunction(
      () => document.querySelector(".audiobar")?.textContent?.includes("保存できませんでした"),
      null,
      { timeout: 8000 }
    );
    r.check("保存に失敗したら、その旨と理由が出る", true);
    r.check(
      "保存に失敗しても、このページを開いている間は再生できる",
      (await audioEl()) === 1 && (await playButton()) === 1
    );
    await page.waitForFunction(
      () => document.querySelector(".save-state")?.textContent?.includes("保存済み"),
      null,
      { timeout: 10000 }
    );
    await roundTrip(url);
    r.check(
      "保存に失敗したまま画面を移ると、選び直す画面になる（音の出ない再生バーにならない）",
      (await pickButton()) === 1 && (await playButton()) === 0
    );
  } finally {
    await browser.close();
  }

  return r.finish();
}

if (import.meta.filename === process.argv[1]) {
  process.exit((await run()) ? 0 : 1);
}
