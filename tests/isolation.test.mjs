import { BASE, reporter } from "./helpers.mjs";

/** ユーザーごとのデータ分離。他人の議事録は読めても書けてもいけない */
export default async function run() {
  const r = reporter("データ分離");

  async function signup(username) {
    const res = await fetch(`${BASE}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "password123" }),
    });
    return { ok: res.ok, cookie: res.headers.getSetCookie().join("; ") };
  }

  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const a = await signup(`iso-a-${stamp}`);
  const b = await signup(`iso-b-${stamp}`);
  r.check("2 ユーザーを登録できる", a.ok && b.ok);

  const created = await fetch(`${BASE}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: a.cookie },
    body: JSON.stringify({ title: "Aの議事録" }),
  }).then((res) => res.json());
  const id = created.project?.id;
  r.check("A が議事録を作成できる", Boolean(id));

  const status = async (path, init = {}) =>
    (await fetch(`${BASE}${path}`, init)).status;

  r.check(
    "B は A の議事録を取得できない",
    (await status(`/api/projects/${id}`, { headers: { cookie: b.cookie } })) === 404
  );
  r.check(
    "B は A の議事録を更新できない",
    (await status(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: b.cookie },
      body: JSON.stringify({ rawText: "書き換え" }),
    })) === 404
  );
  r.check(
    "B は A の議事録を削除できない",
    (await status(`/api/projects/${id}`, {
      method: "DELETE",
      headers: { cookie: b.cookie },
    })) === 404
  );
  r.check(
    "B は A の単語データを取得できない",
    (await status(`/api/projects/${id}/words`, { headers: { cookie: b.cookie } })) === 404
  );

  const bList = await fetch(`${BASE}/api/projects`, {
    headers: { cookie: b.cookie },
  }).then((res) => res.json());
  r.check("B の一覧に A の議事録は出ない", bList.projects.length === 0);

  r.check("未ログインは 401", (await status(`/api/projects/${id}`)) === 401);

  const tampered = a.cookie.replace(
    /st_session=([^;]+)/,
    (_m, v) => `st_session=${v.slice(0, -3)}xyz`
  );
  r.check(
    "署名を書き換えた cookie は通らない",
    (await status(`/api/projects/${id}`, { headers: { cookie: tampered } })) === 401
  );
  r.check(
    "本人は取得できる",
    (await status(`/api/projects/${id}`, { headers: { cookie: a.cookie } })) === 200
  );

  return r.finish();
}

if (import.meta.filename === process.argv[1]) {
  process.exit((await run()) ? 0 : 1);
}
