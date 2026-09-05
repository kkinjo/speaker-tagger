import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * ごく小さな KV 抽象。
 *
 * - 既定はファイルシステム (`.data/`)。ローカル開発や VPS ではこれで動く。
 * - `KV_REST_API_URL` / `KV_REST_API_TOKEN` (Vercel KV) もしくは
 *   `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` が設定されていれば
 *   Upstash Redis の REST API を使う。Vercel などの読み取り専用 FS ではこちら。
 */
export interface Kv {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
}

const restUrl =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const restToken =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

class RedisRestKv implements Kv {
  constructor(private url: string, private token: string) {}

  private async cmd(args: (string | number)[]): Promise<unknown> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`KV request failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { result?: unknown; error?: string };
    if (json.error) throw new Error(`KV error: ${json.error}`);
    return json.result ?? null;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.cmd(["GET", key]);
    if (raw == null) return null;
    // Vercel KV は JSON を自動でパースして返すことがあるため両対応にする
    if (typeof raw !== "string") return raw as T;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.cmd(["SET", key, JSON.stringify(value)]);
  }

  async del(key: string): Promise<void> {
    await this.cmd(["DEL", key]);
  }
}

class FileKv implements Kv {
  private dir = process.env.DATA_DIR || path.join(process.cwd(), ".data");

  private file(key: string) {
    return path.join(this.dir, `${key.replace(/[^a-zA-Z0-9_.-]/g, "_")}.json`);
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      return JSON.parse(await fs.readFile(this.file(key), "utf8")) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const target = this.file(key);
    // 書き込み途中で壊れたファイルを残さないよう一時ファイル経由で置き換える
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value), "utf8");
    await fs.rename(tmp, target);
  }

  async del(key: string): Promise<void> {
    try {
      await fs.unlink(this.file(key));
    } catch {
      /* すでに無ければ何もしない */
    }
  }
}

export const kv: Kv =
  restUrl && restToken ? new RedisRestKv(restUrl, restToken) : new FileKv();

export const usingRemoteKv = Boolean(restUrl && restToken);

/* ---- キーの組み立て ---- */
export const keys = {
  userByName: (username: string) => `u_name_${username.toLowerCase()}`,
  user: (userId: string) => `u_${userId}`,
  projectIndex: (userId: string) => `u_${userId}_projects`,
  project: (projectId: string) => `p_${projectId}`,
  projectWords: (projectId: string) => `p_${projectId}_words`,
};
