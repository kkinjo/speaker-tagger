import { cookies } from "next/headers";
import crypto from "node:crypto";
import { kv, keys } from "./kv";
import { DEFAULT_SETTINGS, type User } from "./types";

const COOKIE = "st_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 日

let cachedSecret: string | null = null;

/** 署名用の秘密鍵。環境変数が無ければ生成して KV に保存する */
async function secret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.APP_SECRET;
  if (fromEnv) {
    cachedSecret = fromEnv;
    return fromEnv;
  }
  const stored = await kv.get<string>("app_secret");
  if (stored) {
    cachedSecret = stored;
    return stored;
  }
  const generated = crypto.randomBytes(32).toString("hex");
  await kv.set("app_secret", generated);
  cachedSecret = generated;
  return generated;
}

export function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

export function newSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function verifyPassword(password: string, user: User): boolean {
  const candidate = Buffer.from(hashPassword(password, user.salt), "hex");
  const expected = Buffer.from(user.hash, "hex");
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

export function newId(): string {
  return crypto.randomBytes(9).toString("base64url");
}

function b64u(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

async function sign(payload: string): Promise<string> {
  return crypto
    .createHmac("sha256", await secret())
    .update(payload)
    .digest("base64url");
}

export async function createSession(userId: string): Promise<void> {
  const payload = b64u(JSON.stringify({ id: userId, t: Date.now() }));
  const token = `${payload}.${await sign(payload)}`;
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** セッション cookie からユーザ ID を取り出す。改竄されていれば null */
export async function currentUserId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = await sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as { id?: string; t?: number };
    if (!parsed.id || !parsed.t) return null;
    if (Date.now() - parsed.t > MAX_AGE * 1000) return null;
    return parsed.id;
  } catch {
    return null;
  }
}

export async function currentUser(): Promise<User | null> {
  const id = await currentUserId();
  if (!id) return null;
  const user = await kv.get<User>(keys.user(id));
  if (!user) return null;
  // 後から設定項目が増えても既存ユーザが壊れないように既定値で埋める
  user.settings = { ...DEFAULT_SETTINGS, ...(user.settings ?? {}) };
  return user;
}
