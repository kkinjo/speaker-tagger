"use client";

import { useRef, useState } from "react";
import type { ProjectWords } from "@/lib/types";
import { importWhisperX, type ImportResult } from "@/editor/whisperx";
import { formatTime } from "@/editor/format";

type Props = {
  projectId: string;
  imported: boolean;
  onImported: (result: ImportResult) => void;
};

export default function ImportPanel({ projectId, imported, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [insertSeparators, setInsertSeparators] = useState(true);
  const [summary, setSummary] = useState<ImportResult["summary"] | null>(null);

  async function handleFile(file: File) {
    setError("");
    setBusy(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text) as unknown;
      const result = importWhisperX(json, {
        insertSeparatorsAtSpeakerChange: insertSeparators,
      });

      const data: ProjectWords = {
        words: result.words,
        norm: result.norm,
        normWordIdx: result.normWordIdx,
      };
      const res = await fetch(`/api/projects/${projectId}/words`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data,
          rawText: result.rawText,
          hints: result.hints,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "保存に失敗しました。");
      }

      setSummary(result.summary);
      onImported(result);
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? "JSON として読み取れませんでした。ファイルをご確認ください。"
          : e instanceof Error
            ? e.message
            : "取り込みに失敗しました。"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>
          WhisperX の JSON を取り込む
          {imported ? "（取り込み済み）" : ""}
        </strong>
        <label
          style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}
        >
          <input
            type="checkbox"
            checked={insertSeparators}
            onChange={(e) => setInsertSeparators(e.target.checked)}
          />
          自動話者分離の切れ目に <code>--</code> をあらかじめ入れる
        </label>
      </div>

      <div
        className={`dropzone${over ? " over" : ""}`}
        style={{ marginTop: 10, padding: 18 }}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
      >
        {busy ? (
          <span>取り込んでいます…</span>
        ) : (
          <>
            <div>JSON ファイルをここへドラッグ、またはクリックして選択</div>
            <div className="hint-note" style={{ marginTop: 4 }}>
              {imported
                ? "再度取り込むと、左側のテキストは取り込んだ内容で置き換わります。"
                : "Google Colab の WhisperX が出力した JSON をそのまま使えます。"}
            </div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
      </div>

      {error ? (
        <p className="error-text" style={{ marginBottom: 0 }}>
          {error}
        </p>
      ) : null}

      {summary ? (
        <p className="hint-note" style={{ margin: "8px 0 0" }}>
          単語 {summary.wordCount.toLocaleString()} 件 / セグメント{" "}
          {summary.segmentCount.toLocaleString()} 件 / 自動判定された話者{" "}
          {summary.speakerCount} 名 / 長さ {formatTime(summary.duration)}
          {summary.hasWordTimestamps
            ? ""
            : " ／ 単語単位のタイムスタンプが見つかりませんでした（時刻はセグメント単位になります）"}
        </p>
      ) : null}
    </div>
  );
}
