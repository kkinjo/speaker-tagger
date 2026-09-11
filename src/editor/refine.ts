import type { Block } from "./parse";

/**
 * 整文結果を紐づけるためのキー。
 *
 * ブロックの配列内位置 (Block.index) は、話者整理画面で行を挿入・削除
 * すると以降の全行がずれてしまい、永続的な ID として使えない。
 * 代わりに「本文が変わっていなければ同じキー」という性質を持つ
 * ハッシュ値を使う。speakers は整文対象外なのでキーに含めない。
 *
 * 実装は暗号強度を持たない軽量な同期ハッシュ (FNV-1a を種を変えて
 * 2 回かけ合わせたもの)。整文画面は最大で数千ブロックを毎レンダリング
 * 走査する可能性があり、Node 標準の sha256 はサーバー専用、ブラウザの
 * Web Crypto の sha256 は非同期呼び出ししか無い。非同期ハッシュを
 * 描画ループに混ぜると、既にチューニング済みの表示性能を壊しかねない
 * ため、同期・依存ライブラリなしの方式を選んだ。
 *
 * 衝突耐性は要求していない（仕様上、同じ本文の行は同じ整文結果で
 * よいとされている）。関数のシグネチャ (body: string) => string は
 * そのままに、内部実装だけを本物の SHA-256 へ後から差し替えられる。
 */
export function sourceKey(body: string): string {
  const a = fnv1a(body, 0x811c9dc5).toString(16).padStart(8, "0");
  const b = fnv1a(body, 0x9e3779b9).toString(16).padStart(8, "0");
  return a + b;
}

/** ブロックから整文対象の本文キーを求める */
export function blockSourceKey(block: Pick<Block, "body">): string {
  return sourceKey(block.body);
}

const FNV_PRIME = 0x01000193;

/** FNV-1a 32bit。seed を変えることで独立に近い 2 系統のハッシュを作る */
function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}
