"use client";

import { memo, useMemo, useState } from "react";
import type { ParsedDoc } from "@/editor/parse";
import type { BlockTime } from "@/editor/align";
import { formatTime } from "@/editor/format";
import { buildTableHtml, buildTableText, copyTable } from "@/editor/tableHtml";

type Props = {
  doc: ParsedDoc;
  times: BlockTime[];
  activeBlock: number | null;
  hasAudio: boolean;
  onSeek: (sec: number) => void;
  onSelectBlock: (blockIndex: number) => void;
  /** 左ペインとのスクロール連動に使う */
  scrollRef: React.RefObject<HTMLDivElement | null>;
};

type RowProps = {
  index: number;
  heading: string | null;
  speaker: string;
  body: string;
  time: number | null;
  active: boolean;
  includeTime: boolean;
  hasAudio: boolean;
  onSeek: (sec: number) => void;
  onSelectBlock: (blockIndex: number) => void;
};

/**
 * 1 行分。1 時間の会議だと数千行になるため、値が変わった行だけ描き直す。
 */
const Row = memo(function Row(props: RowProps) {
  const {
    index,
    heading,
    speaker,
    body,
    time,
    active,
    includeTime,
    hasAudio,
    onSeek,
    onSelectBlock,
  } = props;

  if (heading !== null) {
    return (
      <tr className="heading-row" onClick={() => onSelectBlock(index)}>
        <td colSpan={includeTime ? 3 : 2}>{heading}</td>
      </tr>
    );
  }

  const classes = [active ? "row-active" : "", speaker ? "row-done" : "row-todo"]
    .filter(Boolean)
    .join(" ");

  return (
    <tr className={classes} onClick={() => onSelectBlock(index)}>
      {includeTime ? (
        <td className="time">
          {hasAudio && time != null ? (
            <button
              className="time-link"
              onClick={(e) => {
                e.stopPropagation();
                onSeek(time);
              }}
              title="この位置から音声を再生"
            >
              {formatTime(time)}
            </button>
          ) : (
            formatTime(time)
          )}
        </td>
      ) : null}
      <td className="speaker">
        {speaker ? (
          <>
            <span aria-hidden>✓ </span>
            {speaker}
          </>
        ) : (
          <span className="muted">未割り当て</span>
        )}
      </td>
      <td className="body">{body}</td>
    </tr>
  );
});

export default function TableView({
  doc,
  times,
  activeBlock,
  hasAudio,
  onSeek,
  onSelectBlock,
  scrollRef,
}: Props) {
  const [includeTime, setIncludeTime] = useState(false);
  const [copied, setCopied] = useState("");

  const rows = useMemo(
    () =>
      doc.blocks.map((block) => ({
        block,
        time: times[block.index]?.start ?? null,
      })),
    [doc.blocks, times]
  );

  async function copy() {
    try {
      await copyTable(
        buildTableHtml(rows, { includeTime }),
        buildTableText(rows, { includeTime })
      );
      setCopied("コピーしました（Word に貼ると表になります）");
    } catch {
      setCopied("コピーできませんでした。表を選択して Ctrl+C をお試しください。");
    }
    setTimeout(() => setCopied(""), 4000);
  }

  return (
    <div className="pane">
      <div className="pane-header">
        <span className="pane-title">表形式ビュー</span>
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input
            type="checkbox"
            checked={includeTime}
            onChange={(e) => setIncludeTime(e.target.checked)}
          />
          時刻列
        </label>
        <button className="btn btn-sm" onClick={copy}>
          表をコピー
        </button>
        <div className="spacer" />
        {copied ? <span className="muted">{copied}</span> : null}
      </div>

      <div className="table-scroll" ref={scrollRef}>
        <table className="minutes">
          {/* 幅を固定しておかないと、長い話者名ひとつで列幅が崩れる */}
          <colgroup>
            {includeTime ? <col className="col-time" /> : null}
            <col className="col-speaker" />
            <col />
          </colgroup>
          <thead>
            <tr>
              {includeTime ? <th>時刻</th> : null}
              <th>話者</th>
              <th>発言内容</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={includeTime ? 3 : 2} className="muted">
                  左側にテキストを入力すると、ここに表が表示されます。
                </td>
              </tr>
            ) : null}
            {rows.map(({ block, time }) => (
              <Row
                key={block.index}
                index={block.index}
                heading={block.kind === "heading" ? block.heading : null}
                speaker={block.speakers.join(" / ")}
                body={block.body}
                time={time}
                active={block.index === activeBlock}
                includeTime={includeTime}
                hasAudio={hasAudio}
                onSeek={onSeek}
                onSelectBlock={onSelectBlock}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
