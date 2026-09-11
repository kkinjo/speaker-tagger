import type { Block } from "./parse";
import { formatBlockTime } from "./format";

export type TableRow = {
  block: Block;
  time: number | null;
  /**
   * 発言内容として表示する文字列の上書き。
   * 未指定なら `block.body`（原文）を使う。
   * 出力画面（③）が「整文後」を選んだときに、整文結果（無ければ原文）を
   * ここへ入れて渡す。tableHtml.ts 自体は整文結果の解決方法を知らない。
   */
  text?: string;
};

export type TableOptions = {
  includeTime: boolean;
  /** 既定 true。出力画面（③）で「話者列を含めない」を選んだときに false にする */
  includeSpeaker?: boolean;
};

const TAB = "\t";

function bodyOf(row: TableRow): string {
  return row.text ?? row.block.body;
}

/**
 * Word に貼ったときに表として認識される HTML を作る。
 * Word はスタイルシートを参照しないため、罫線などは全てインラインで指定する。
 */
export function buildTableHtml(rows: TableRow[], options: TableOptions): string {
  const includeSpeaker = options.includeSpeaker ?? true;
  const cell =
    "border:1px solid #000000;padding:4px 6px;vertical-align:top;font-family:'Yu Gothic','Meiryo',sans-serif;font-size:10.5pt;";
  const head = `${cell}background-color:#efefef;font-weight:bold;`;
  const colCount = (options.includeTime ? 1 : 0) + (includeSpeaker ? 1 : 0) + 1;

  const parts: string[] = [];
  parts.push(
    '<table border="1" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;">'
  );
  parts.push("<thead><tr>");
  if (options.includeTime) parts.push(`<th style="${head}width:8%;">時刻</th>`);
  if (includeSpeaker) parts.push(`<th style="${head}width:20%;">話者</th>`);
  parts.push(`<th style="${head}">発言内容</th>`);
  parts.push("</tr></thead><tbody>");

  for (const row of rows) {
    if (row.block.kind === "heading") {
      parts.push(
        `<tr><td colspan="${colCount}" style="${cell}background-color:#e8eef7;font-weight:bold;">${escapeHtml(
          row.block.heading
        )}</td></tr>`
      );
      continue;
    }
    parts.push("<tr>");
    if (options.includeTime) {
      parts.push(`<td style="${cell}">${formatBlockTime(row.time)}</td>`);
    }
    if (includeSpeaker) {
      parts.push(
        `<td style="${cell}">${escapeHtml(row.block.speakers.join(" / "))}</td>`
      );
    }
    // セル内の改行は <br> にして、箇条書きなど意味のある行分けを保つ
    parts.push(`<td style="${cell}">${escapeHtml(bodyOf(row)).replace(/\n/g, "<br>")}</td>`);
    parts.push("</tr>");
  }

  parts.push("</tbody></table>");
  return parts.join("");
}

/** HTML を受け付けない貼り付け先向けのタブ区切り版 */
export function buildTableText(rows: TableRow[], options: TableOptions): string {
  const includeSpeaker = options.includeSpeaker ?? true;
  const lines: string[] = [];
  lines.push(
    [
      ...(options.includeTime ? ["時刻"] : []),
      ...(includeSpeaker ? ["話者"] : []),
      "発言内容",
    ].join(TAB)
  );
  for (const row of rows) {
    if (row.block.kind === "heading") {
      lines.push(
        [
          ...(options.includeTime ? [""] : []),
          ...(includeSpeaker ? [""] : []),
          `【${row.block.heading}】`,
        ].join(TAB)
      );
      continue;
    }
    lines.push(
      [
        ...(options.includeTime ? [formatBlockTime(row.time)] : []),
        ...(includeSpeaker ? [row.block.speakers.join(" / ")] : []),
        bodyOf(row).replace(/\n/g, " "),
      ].join(TAB)
    );
  }
  return lines.join("\n");
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** HTML とプレーンテキストの両方をクリップボードへ書き込む */
export async function copyTable(html: string, text: string): Promise<void> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
    return;
  }
  // ClipboardItem 非対応ブラウザ向けのフォールバック
  const holder = document.createElement("div");
  holder.contentEditable = "true";
  holder.style.position = "fixed";
  holder.style.left = "-9999px";
  holder.innerHTML = html;
  document.body.appendChild(holder);
  const range = document.createRange();
  range.selectNodeContents(holder);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  document.execCommand("copy");
  sel?.removeAllRanges();
  holder.remove();
}
