"use client";

import { useMemo, useState } from "react";
import type { Project, UserSettings } from "@/lib/types";
import { parseDoc } from "@/editor/parse";
import { blockSourceKey } from "@/editor/refine";
import { buildTableHtml, buildTableText, copyTable, type TableRow } from "@/editor/tableHtml";
import { formatBlockTime } from "@/editor/format";

/**
 * 出力画面（③、第7章）。
 *
 * 完成した議事録の表を、列構成を選んだうえで Word へコピーする。
 * 読み取り専用（編集はしない）。表をコピーする機能は①から移した
 * ここに一本化されている（第7章 7.4）。
 */
export default function ExportApp({
  project,
  settings,
}: {
  project: Project;
  settings: UserSettings;
}) {
  const [includeTime, setIncludeTime] = useState(settings.exportIncludeTime);
  const [includeSpeaker, setIncludeSpeaker] = useState(settings.exportIncludeSpeaker);
  const [useRefined, setUseRefined] = useState(settings.exportUseRefined);
  const [copied, setCopied] = useState("");

  const doc = useMemo(
    () => parseDoc(project.rawText, project.participants),
    [project.rawText, project.participants]
  );

  const utteranceBlocks = useMemo(
    () => doc.blocks.filter((b) => b.kind === "utterance"),
    [doc.blocks]
  );

  // 「整文後」を選んだとき、整文結果が無い行が何件あるか（第7章 7.2）
  const unrefinedCount = useMemo(
    () =>
      utteranceBlocks.filter((b) => !project.refinements[blockSourceKey(b)]).length,
    [utteranceBlocks, project.refinements]
  );

  const rows: TableRow[] = useMemo(
    () =>
      doc.blocks.map((block) => {
        // 時刻は区切り記号に書かれているものをそのまま使う
        const time = block.time;
        if (block.kind === "heading" || !useRefined) return { block, time };
        // 整文結果が無ければ原文で補う（空セルにはしない）
        const text = project.refinements[blockSourceKey(block)]?.text ?? block.body;
        return { block, time, text };
      }),
    [doc.blocks, useRefined, project.refinements]
  );

  function persistSetting(patch: Partial<UserSettings>) {
    void fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async function copy() {
    try {
      await copyTable(
        buildTableHtml(rows, { includeTime, includeSpeaker }),
        buildTableText(rows, { includeTime, includeSpeaker })
      );
      setCopied("コピーしました（Word に貼ると表になります）");
    } catch {
      setCopied("コピーできませんでした。表を選択して Ctrl+C をお試しください。");
    }
    setTimeout(() => setCopied(""), 4000);
  }

  const colCount = (includeTime ? 1 : 0) + (includeSpeaker ? 1 : 0) + 1;

  return (
    <div className="export-app">
      <div className="export-toolbar">
        <label className="export-toggle">
          <input
            type="checkbox"
            checked={includeTime}
            onChange={(e) => {
              setIncludeTime(e.target.checked);
              persistSetting({ exportIncludeTime: e.target.checked });
            }}
          />
          時刻列
        </label>
        <label className="export-toggle">
          <input
            type="checkbox"
            checked={includeSpeaker}
            onChange={(e) => {
              setIncludeSpeaker(e.target.checked);
              persistSetting({ exportIncludeSpeaker: e.target.checked });
            }}
          />
          話者列
        </label>
        <label className="export-toggle">
          <input
            type="checkbox"
            checked={useRefined}
            onChange={(e) => {
              setUseRefined(e.target.checked);
              persistSetting({ exportUseRefined: e.target.checked });
            }}
          />
          整文後のテキストを使う（原文ではなく）
        </label>
        <button className="btn btn-sm btn-primary" onClick={() => void copy()}>
          表をコピー
        </button>
        <div className="spacer" />
        {useRefined && unrefinedCount > 0 ? (
          <span className="muted" style={{ fontSize: 12 }}>
            未整文の行が {unrefinedCount} 件あります（その行は原文がそのまま使われます）
          </span>
        ) : null}
        {copied ? <span className="muted">{copied}</span> : null}
      </div>

      <div className="export-table-scroll">
        <table className="minutes">
          <colgroup>
            {includeTime ? <col className="col-time" /> : null}
            {includeSpeaker ? <col className="col-speaker" /> : null}
            <col />
          </colgroup>
          <thead>
            <tr>
              {includeTime ? <th>時刻</th> : null}
              {includeSpeaker ? <th>話者</th> : null}
              <th>発言内容</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="muted">
                  話者整理画面でテキストを編集すると、ここに表が表示されます。
                </td>
              </tr>
            ) : null}
            {rows.map((row) => {
              if (row.block.kind === "heading") {
                return (
                  <tr key={row.block.index} className="heading-row">
                    <td colSpan={colCount}>{row.block.heading}</td>
                  </tr>
                );
              }
              return (
                <tr key={row.block.index}>
                  {includeTime ? <td className="time">{formatBlockTime(row.time)}</td> : null}
                  {includeSpeaker ? (
                    <td className="speaker">
                      {row.block.speakers.length > 0 ? (
                        row.block.speakers.join(" / ")
                      ) : (
                        <span className="muted">未割り当て</span>
                      )}
                    </td>
                  ) : null}
                  <td className="body">{row.text ?? row.block.body}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
