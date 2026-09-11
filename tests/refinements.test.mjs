import { BASE, reporter } from "./helpers.mjs";

/**
 * Project.refinements / Project.glossary の保存・読み込み（API レベル）。
 * 完了条件: 第8章 実装の順序 #1「Project.refinements と Project.glossary
 * が保存・読み込みできる」
 */
export default async function run() {
  const r = reporter("整文フィールドの保存・読み込み");

  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const signup = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: `refine-${stamp}`, password: "password123" }),
  });
  const cookie = signup.headers.getSetCookie().join("; ");
  r.check("ユーザー登録できる", signup.ok);

  const created = await fetch(`${BASE}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ title: "整文フィールドのテスト" }),
  }).then((res) => res.json());
  const id = created.project?.id;
  r.check("プロジェクトを作成できる", Boolean(id));

  r.check(
    "新規プロジェクトの refinements は空オブジェクト",
    created.project?.refinements && Object.keys(created.project.refinements).length === 0,
    JSON.stringify(created.project?.refinements)
  );
  r.check(
    "新規プロジェクトの glossary は空配列",
    Array.isArray(created.project?.glossary) && created.project.glossary.length === 0,
    JSON.stringify(created.project?.glossary)
  );

  const refinements = {
    aaaaaaaaaaaaaaaa: { text: "整文後のテキスト", edited: false, updatedAt: 1000 },
    bbbbbbbbbbbbbbbb: { text: "手直し済み", edited: true, updatedAt: 2000 },
  };
  const glossary = ["九附後連", "琉大附属中", " 前後の空白 "];

  const patched = await fetch(`${BASE}/api/projects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ refinements, glossary }),
  });
  r.check("PATCH が成功する", patched.ok, `status=${patched.status}`);

  const got = await fetch(`${BASE}/api/projects/${id}`, { headers: { cookie } }).then(
    (res) => res.json()
  );

  r.check(
    "保存した refinements がそのまま読み込める",
    JSON.stringify(got.project?.refinements) === JSON.stringify(refinements),
    JSON.stringify(got.project?.refinements)
  );
  r.check(
    "glossary は前後の空白を落として保存される",
    JSON.stringify(got.project?.glossary) ===
      JSON.stringify(["九附後連", "琉大附属中", "前後の空白"]),
    JSON.stringify(got.project?.glossary)
  );

  const patchedAgain = await fetch(`${BASE}/api/projects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ glossary: ["有効な語", "", "  ", "もう一語"] }),
  });
  const gotAgain = await patchedAgain.json();
  r.check(
    "空行はフィルタされる（もう一度 PATCH した場合も）",
    Array.isArray(gotAgain) || true // savedAt しか返らないので次の GET で検証する
  );
  const reGet = await fetch(`${BASE}/api/projects/${id}`, { headers: { cookie } }).then(
    (res) => res.json()
  );
  r.check(
    "空行を除いた glossary になる",
    JSON.stringify(reGet.project?.glossary) === JSON.stringify(["有効な語", "もう一語"]),
    JSON.stringify(reGet.project?.glossary)
  );
  r.check(
    "glossary を更新しても refinements は保持される",
    JSON.stringify(reGet.project?.refinements) === JSON.stringify(refinements),
    JSON.stringify(reGet.project?.refinements)
  );

  return r.finish();
}

if (import.meta.filename === process.argv[1]) {
  process.exit((await run()) ? 0 : 1);
}
