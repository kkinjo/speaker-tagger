import fs from "node:fs";
import path from "node:path";
import { FIXTURES } from "./helpers.mjs";

/**
 * テスト用の入力ファイルを作る。
 * WhisperX が出す JSON の形（segments[].words[] に単語ごとの時刻と話者）
 * を模したものと、音声連動の確認に使う無音に近い WAV。
 */

const SHORT = [
  ["SPEAKER_00", "おはようございます。本日はお忙しい中お集まりいただきありがとうございます。"],
  ["SPEAKER_00", "それでは第一回の打合せを始めさせていただきます。"],
  ["SPEAKER_01", "よろしくお願いします。資料は事前に共有いただいたもので大丈夫でしょうか。"],
  ["SPEAKER_00", "はい、そちらで問題ありません。"],
  ["SPEAKER_02", "一点確認なのですが、来月の日程は変更になる可能性はありますか。"],
  ["SPEAKER_00", "現時点では予定どおりです。変更があれば速やかにご連絡します。"],
  ["SPEAKER_01", "承知しました。ではこちらでも準備を進めます。"],
  ["SPEAKER_02", "ありがとうございます。もう一点、研修の対象者について伺えますか。"],
  ["SPEAKER_00", "対象は各校の担当者一名を想定しています。"],
  ["SPEAKER_01", "分かりました。名簿は後ほど送ります。"],
];

const LONG = [
  "本日はお忙しい中お集まりいただきありがとうございます。",
  "それでは資料の三ページ目をご覧ください。",
  "この点については前回の会議でも議論がありました。",
  "来年度の予算については現在調整中でございます。",
  "各校の担当者にはあらためて通知いたします。",
  "研修の日程は七月の第二週を予定しております。",
  "ご不明な点があればいつでもご連絡ください。",
  "その件については持ち帰って検討させていただきます。",
  "はい、承知いたしました。ありがとうございます。",
  "それでは次の議題に移らせていただきます。",
];

function buildTranscript(rows, chunkSize, gap) {
  let t = 0;
  const segments = rows.map(([speaker, text], id) => {
    const chunks = text.match(new RegExp(`.{1,${chunkSize}}`, "gu")) ?? [text];
    const start = t;
    const words = chunks.map((word) => {
      const s = Math.round(t * 1000) / 1000;
      t += gap;
      return { word, start: s, end: Math.round(t * 1000) / 1000, score: 0.9, speaker };
    });
    t += gap * 3;
    return { id, start, end: Math.round(t * 1000) / 1000, text, speaker, words };
  });
  return {
    segments,
    word_segments: segments.flatMap((s) => s.words),
    language: "ja",
  };
}

/** 44.1kHz は大きすぎるので、確認に足る最小限の WAV を作る */
function buildWav(seconds) {
  const rate = 8000;
  const n = rate * seconds;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 220 * i) / rate)), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVE", 8);
  head.write("fmt ", 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

export function buildFixtures() {
  fs.mkdirSync(FIXTURES, { recursive: true });

  const short = buildTranscript(SHORT, 4, 0.22);
  fs.writeFileSync(
    path.join(FIXTURES, "sample.json"),
    JSON.stringify(short, null, 1)
  );

  // 1 時間規模。2500 発言・約 2 万語で、実際の会議の上限に近い量
  const longRows = Array.from({ length: 2500 }, (_, i) => [
    `SPEAKER_0${i % 4}`,
    LONG[i % LONG.length],
  ]);
  fs.writeFileSync(
    path.join(FIXTURES, "big.json"),
    JSON.stringify(buildTranscript(longRows, 3, 0.14))
  );

  fs.writeFileSync(path.join(FIXTURES, "meeting.wav"), buildWav(25));

  return {
    sample: path.join(FIXTURES, "sample.json"),
    big: path.join(FIXTURES, "big.json"),
    wav: path.join(FIXTURES, "meeting.wav"),
  };
}

if (import.meta.filename === process.argv[1]) {
  const files = buildFixtures();
  for (const [k, v] of Object.entries(files)) {
    console.log(k, fs.statSync(v).size, "bytes", v);
  }
}
