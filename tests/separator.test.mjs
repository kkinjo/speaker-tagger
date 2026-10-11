import { reporter } from "./helpers.mjs";
import { isSeparatorLine, parseDoc, separatorTime } from "../src/editor/parse.ts";

/**
 * 区切り行（`--@時刻`）の時刻の読み取り（ブラウザ不要・純粋関数のテスト）。
 * 秒（`--@83.5`）に加え、分:秒（`--@1:23.5`）と時:分:秒（`--@1:02:03`）も読める。
 */
export default async function run() {
  const r = reporter("区切りの時刻表記");

  const cases = [
    ["--", null, "時刻なし"],
    ["--@12.3", 12.3, "秒"],
    ["--@83", 83, "秒（整数）"],
    ["--@1:23", 83, "分:秒"],
    ["--@1:23.5", 83.5, "分:秒（小数）"],
    ["--@0:05", 5, "分:秒（0分）"],
    ["--@12:00", 720, "分:秒（2桁の分）"],
    ["--@75:30", 4530, "分:秒（60分を超える分も書ける）"],
    ["--@1:02:03", 3723, "時:分:秒"],
    ["--@1:02:03.25", 3723.25, "時:分:秒（小数）"],
    ["  ----  @ 1:23  ", 83, "前後や @ の後ろに空白があってもよい"],
  ];
  for (const [line, want, label] of cases) {
    const got = separatorTime(line);
    r.check(
      `${label}：${JSON.stringify(line)} → ${want}`,
      isSeparatorLine(line) && (want === null ? got === null : Math.abs(got - want) < 1e-9),
      `got=${got}`
    );
  }

  for (const [line, label] of [
    ["--@1:75", "秒の桁が 60 以上"],
    ["--@1:60:00", "分の桁が 60 以上"],
    ["--@1:2:3:4", "コロンが多すぎる"],
    ["--@1:", "コロンで終わる"],
    ["--@abc", "数字でない"],
  ]) {
    r.check(
      `${label}（${JSON.stringify(line)}）は区切りとして読まない（これまでの --@abc と同じ扱い）`,
      !isSeparatorLine(line)
    );
  }

  // 表の「時刻」列・再生の連動は Block.time を使う
  const doc = parseDoc(
    ["最初の発言", "--@1:23.5", "二つめの発言", "--@95", "三つめの発言", "--@1:02:03", "四つめ"].join(
      "\n"
    ),
    []
  );
  r.check(
    "各ブロックの時刻に、どの表記でも秒で入る",
    JSON.stringify(doc.blocks.map((b) => b.time)) === JSON.stringify([null, 83.5, 95, 3723]),
    JSON.stringify(doc.blocks.map((b) => b.time))
  );

  return r.finish();
}

if (import.meta.filename === process.argv[1]) {
  process.exit((await run()) ? 0 : 1);
}
