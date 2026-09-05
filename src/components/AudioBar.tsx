"use client";

import { useRef } from "react";
import { formatTime } from "@/editor/format";

type Props = {
  hasAudio: boolean;
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

  if (!props.hasAudio) {
    return (
      <div className="audiobar">
        <span className="muted">
          音声ファイルを取り込むと、発言の時刻から再生できます。
        </span>
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
        title="再生 / 一時停止（Space）"
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
      <span className="muted" style={{ fontSize: 11 }} title={props.fileName ?? ""}>
        {props.fileName}
      </span>
      <button className="btn btn-sm" onClick={props.onRemoveAudio}>
        音声を外す
      </button>
    </div>
  );
}
