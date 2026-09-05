import { NextResponse } from "next/server";
import { kv, keys } from "@/lib/kv";
import { createSession, verifyPassword } from "@/lib/auth";
import type { User } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { username, password } = (await req.json()) as {
    username?: string;
    password?: string;
  };
  const name = (username ?? "").trim();
  const invalid = NextResponse.json(
    { error: "ユーザー名またはパスワードが違います。" },
    { status: 401 }
  );

  if (!name || !password) return invalid;

  const userId = await kv.get<string>(keys.userByName(name));
  if (!userId) return invalid;
  const user = await kv.get<User>(keys.user(userId));
  if (!user || !verifyPassword(password, user)) return invalid;

  await createSession(user.id);
  return NextResponse.json({ username: user.username, settings: user.settings });
}
