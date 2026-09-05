import { NextResponse } from "next/server";
import { kv, keys } from "@/lib/kv";
import { createSession, hashPassword, newId, newSalt } from "@/lib/auth";
import { DEFAULT_SETTINGS, type User } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { username, password } = (await req.json()) as {
    username?: string;
    password?: string;
  };
  const name = (username ?? "").trim();

  if (name.length < 2 || name.length > 32) {
    return NextResponse.json(
      { error: "ユーザー名は2〜32文字で入力してください。" },
      { status: 400 }
    );
  }
  if (!/^[\w.@-]+$/.test(name)) {
    return NextResponse.json(
      { error: "ユーザー名は半角英数字と . _ - @ が使えます。" },
      { status: 400 }
    );
  }
  if (!password || password.length < 8) {
    return NextResponse.json(
      { error: "パスワードは8文字以上にしてください。" },
      { status: 400 }
    );
  }

  const existing = await kv.get<string>(keys.userByName(name));
  if (existing) {
    return NextResponse.json(
      { error: "そのユーザー名は既に使われています。" },
      { status: 409 }
    );
  }

  const salt = newSalt();
  const user: User = {
    id: newId(),
    username: name,
    salt,
    hash: hashPassword(password, salt),
    createdAt: Date.now(),
    settings: DEFAULT_SETTINGS,
  };

  await kv.set(keys.user(user.id), user);
  await kv.set(keys.userByName(name), user.id);
  await kv.set(keys.projectIndex(user.id), []);
  await createSession(user.id);

  return NextResponse.json({ username: user.username, settings: user.settings });
}
