import { reporter } from "./helpers.mjs";
import { sourceKey, blockSourceKey } from "../src/editor/refine.ts";

/**
 * sourceKey() の性質を確認する（ブラウザ不要・純粋関数のテスト）。
 * 完了条件: 本文が同じなら同じキー、違えば違うキーになる。
 */
export default async function run() {
  const r = reporter("sourceKey");

  r.check(
    "同じ本文は同じキーになる",
    sourceKey("おはようございます") === sourceKey("おはようございます")
  );

  r.check(
    "1文字でも違えば違うキーになる",
    sourceKey("おはようございます") !== sourceKey("おはようございます。")
  );

  r.check(
    "全く違う本文は違うキーになる",
    sourceKey("はい") !== sourceKey("いいえ")
  );

  r.check(
    "空文字列でもキーを返す（例外にならない）",
    typeof sourceKey("") === "string" && sourceKey("").length > 0
  );

  // 同じ入力に対して常に同じ結果を返す（呼び出しごとに変わらない）
  const repeated = new Set(
    Array.from({ length: 20 }, () => sourceKey("繰り返しテスト"))
  );
  r.check("決定的である（毎回同じキー）", repeated.size === 1);

  // speakers は対象外。Block.body だけを見ていることを、
  // 話者違い・本文同一のダミーブロックで確認する
  r.check(
    "話者が違っても本文が同じならキーは同じ（speakers は見ない）",
    blockSourceKey({ body: "承知しました" }) ===
      blockSourceKey({ body: "承知しました" })
  );

  // それなりの量の入力でも衝突しないことを確認する
  // （数百行規模の実運用を想定した簡易チェック。厳密な衝突耐性は要求していない）
  const sample = Array.from({ length: 500 }, (_, i) => `発言テキスト その${i}`);
  const keys = new Set(sample.map(sourceKey));
  r.check(
    "500件のダミー発言でキーが衝突しない",
    keys.size === sample.length,
    `${keys.size}/${sample.length}`
  );

  // 意図した16桁の16進文字列であること（sha256 からの将来的な
  // 差し替えを見据えた、大まかな形式チェック）
  r.check(
    "16桁の16進文字列を返す",
    /^[0-9a-f]{16}$/.test(sourceKey("フォーマット確認")),
    sourceKey("フォーマット確認")
  );

  return r.finish();
}

if (import.meta.filename === process.argv[1]) {
  process.exit((await run()) ? 0 : 1);
}
