"use client";

import { useRef } from "react";
import { formatTime } from "@/editor/format";

type Props = {
  /** 再生できる音声がある */
  hasAudio: boolean;
  /** このブラウザから音声を読み込んでいる途中 */
  loading: boolean;
  /**
   * 「音声あり」と記録されているのに、このブラウザに本体が無いときのファイル名。
   * このときは選び直す画面を出す（「音声を外す」を押さなくてよい）
   */
  missingName: string | null;
  /** このブラウザへ保存している途中 */
  saving: boolean;
  /** このブラウザへの保存に失敗したときの理由 */
  saveError: string | null;
  fileName: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  rate: number;
  follow: boolean;
  onToggle: () => void;
  onSeek: (sec: number) => void;
  onSkip: (delta: number) => void;
  onRateChange: (rate: number) => void;
  onFollowChange: (follow: boolean) => void;
  onPickFile: (file: File) => void;
  onRemoveAudio: () => void;
};

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

export default function AudioBar(props: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  if (!props.hasAudio && props.loading) {
    return (
      <div className="audiobar">
        <span className="muted">音声を読み込み中…</span>
      </div>
    );
  }

  if (!props.hasAudio) {
    return (
      <div className="audiobar">
        {props.missingName ? (
          <span className="audiobar-note">
            「{props.missingName}」はこのブラウザには保存されていません。もう一度選んでください
            （ブラウザのデータを消した・別の端末やブラウザで開いた・保存に失敗した、などの場合）。
          </span>
        ) : (
          <span className="muted">
            音声ファイルを取り込むと、発言の時刻から再生できます。
          </span>
        )}
        <button className="btn btn-sm" onClick={() => inputRef.current?.click()}>
          音声ファイルを選ぶ
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,video/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) props.onPickFile(file);
            e.target.value = "";
          }}
        />
        <span className="muted" style={{ fontSize: 11 }}>
          （音声はこのブラウザ内にのみ保存され、サーバーへは送信されません）
        </span>
      </div>
    );
  }

  return (
    <div className="audiobar">
      <button
        className="btn btn-sm btn-primary"
        onClick={props.onToggle}
        title="再生 / 一時停止（Space。編集中は Shift+Space）"
        style={{ minWidth: 84, justifyContent: "center" }}
      >
        {props.playing ? "⏸ 一時停止" : "▶ 再生"}
      </button>
      <button
        className="btn btn-sm"
        onClick={() => props.onSkip(-3)}
        title="3秒戻す（Alt+←）"
      >
        ◀ 3秒
      </button>
      <button
        className="btn btn-sm"
        onClick={() => props.onSkip(3)}
        title="3秒進める（Alt+→）"
      >
        3秒 ▶
      </button>

      <span className="time">
        {formatTime(props.currentTime)} / {formatTime(props.duration)}
      </span>

      <input
        type="range"
        min={0}
        max={Math.max(props.duration, 0.1)}
        step={0.1}
        value={Math.min(props.currentTime, props.duration || 0)}
        onChange={(e) => props.onSeek(Number(e.target.value))}
        aria-label="再生位置"
      />

      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        速度
        <select
          value={props.rate}
          onChange={(e) => props.onRateChange(Number(e.target.value))}
        >
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r}倍
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type="checkbox"
          checked={props.follow}
          onChange={(e) => props.onFollowChange(e.target.checked)}
        />
        再生に合わせて追従
      </label>

      <div className="spacer" />
      {props.saving ? (
        <span className="audiobar-note">
          このブラウザに保存中…（終わるまで画面を移らないでください）
        </span>
      ) : null}
      {props.saveError ? (
        <span className="audiobar-error" role="alert">
          このブラウザに保存できませんでした（{props.saveError}）。
          このページを開いている間は再生できますが、画面を移ると選び直しが必要です。
        </span>
      ) : null}
      <span className="muted" style={{ fontSize: 11 }} title={props.fileName ?? ""}>
        {props.fileName}
      </span>
      <button className="btn btn-sm" onClick={props.onRemoveAudio}>
        音声を外す
      </button>
    </div>
  );
}
