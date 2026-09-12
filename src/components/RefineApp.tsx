"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project, Refinements } from "@/lib/types";
import { parseDoc, type Block } from "@/editor/parse";
import { blockSourceKey } from "@/editor/refine";
import { requestRefine } from "@/editor/refineClient";
import { GLOBAL_GLOSSARY } from "@/lib/glossary";

type SaveState = "saved" | "dirty" | "saving" | "error";

/** クライアント側だけで持つ一時的な状態（保存しない。第3章 3.3） */
type Transient = "pending" | "error";

type RowStatus = "empty" | "pending" | "done" | "edited" | "error";

/**
 * 第3章 3.3 のラベル。
 *
 * 整文結果が無い行は、出力画面でそのまま原文が採用される（第7章）。
 * 「処理されていない」のではなく「原文を採用している」状態なので、
 * 「未変換」ではなく「原文のまま出力」と書く。
 */
const STATUS_LABEL: Record<RowStatus, string> = {
  empty: "原文のまま出力",
  pending: "変換中",
  done: "AI変換済み",
  edited: "手修正済み",
  error: "失敗",
};

type RowProps = {
  block: Block;
  status: RowStatus;
  /** 整文結果。無い行（＝原文がそのまま出力される行）は null */
  text: string | null;
  running: boolean;
  onEdit: (block: Block, value: string) => void;
  onRetry: (block: Block) => void;
};

/**
 * 1 行分。整文対象は数百行になり得るため、内容が変わった行だけ
 * 描き直されるよう memo する（TableView.tsx の Row と同じ考え方）。
 */
const Row = memo(function Row({ block, status, text, running, onEdit, onRetry }: RowProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  /**
   * 整文結果がまだ無い行を、原文を入れた状態で開いているときの下書き。
   * null なら開いていない（＝原文を薄いグレーで表示している状態）。
   */
  const [draft, setDraft] = useState<string | null>(null);
  const wantFocus = useRef(false);

  const speaker = block.speakers.join(" / ") || "未割り当て";
  // 整文結果があるか、原文を入れて開いている間は textarea で編集できる
  const editing = text !== null || draft !== null;
  const value = text ?? draft ?? "";

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, editing]);

  useEffect(() => {
    if (editing && wantFocus.current) {
      wantFocus.current = false;
      taRef.current?.focus();
    }
  }, [editing]);

  /** 薄いグレーの原文をクリックしたとき。原文が入った状態で編集を始める */
  const openWithOriginal = () => {
    wantFocus.current = true;
    setDraft(block.body);
  };

  /**
   * 何も直さずにフォーカスを外しただけでも確定させる（第4章 4.6）。
   * 「はい」のような整文不要の発言を、AI に投げずに処理済みにする経路。
   */
  const commitOnBlur = () => {
    if (text === null && draft !== null) onEdit(block, draft);
    setDraft(null);
  };

  return (
    <tr>
      <td className="refine-original">
        <div className="refine-speaker">{speaker}</div>
        <div className="refine-body">{block.body}</div>
      </td>
      <td className="refine-status-cell">
        <button
          className="btn btn-sm"
          onClick={() => onRetry(block)}
          disabled={running}
          title={
            status === "error"
              ? "この行を再変換（失敗した行はここから復旧できます）"
              : "この行を再変換"
          }
        >
          ↻
        </button>
      </td>
      <td className="refine-output">
        {/* 上段：話者とステータス。1列目と重複するが、3列目だけを見て
            出力内容が把握できる状態を保つため省略しない（第4章 4.1） */}
        <div className="refine-out-head">
          <span className="refine-out-speaker">{speaker}</span>
          <span className={`refine-status refine-status-${status}`}>
            {STATUS_LABEL[status]}
          </span>
        </div>
        {editing ? (
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => {
              setDraft(e.target.value);
              onEdit(block, e.target.value);
            }}
            onBlur={commitOnBlur}
            placeholder="整文後のテキスト"
            rows={1}
          />
        ) : (
          <div
            className="refine-out-original"
            role="button"
            tabIndex={0}
            onClick={openWithOriginal}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                openWithOriginal();
              }
            }}
            title="クリックすると編集できます。そのまま外すと、この原文で確定します"
          >
            {block.body}
          </div>
        )}
      </td>
    </tr>
  );
});

/**
 * 整文画面（②）。第4章の UI を実装する。
 * この段階では Anthropic API を呼ばず、`requestRefine`（ダミー実装。
 * src/editor/refineClient.ts）で代替する。
 */
export default function RefineApp({ project }: { project: Project }) {
  const [refinements, setRefinements] = useState<Refinements>(project.refinements);
  const [transient, setTransient] = useState<Record<string, Transient>>({});
  const [overwriteDone, setOverwriteDone] = useState(false);
  /** 表示の絞り込み（第4章 4.2）。true なら「原文のまま出力」の行だけ */
  const [onlyRaw, setOnlyRaw] = useState(false);
  const [running, setRunning] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const abortRef = useRef(false);

  const doc = useMemo(
    () => parseDoc(project.rawText, project.participants),
    [project.rawText, project.participants]
  );

  const utteranceBlocks = useMemo(
    () => doc.blocks.filter((b) => b.kind === "utterance"),
    [doc.blocks]
  );

  // 全体リストと会議固有リストを結合し、重複を取り除く（第6章 6.1）
  const combinedGlossary = useMemo(() => {
    return [...new Set([...GLOBAL_GLOSSARY, ...project.glossary])];
  }, [project.glossary]);

  /* ---- 保存（2秒デバウンス。第4章 4.4） ---- */
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refinementsRef = useRef(refinements);
  refinementsRef.current = refinements;

  const save = useCallback(async () => {
    setSaveState("saving");
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refinements: refinementsRef.current }),
      });
      if (!res.ok) throw new Error("save failed");
      dirtyRef.current = false;
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [project.id]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), 2000);
  }, [save]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  // ブラウザを閉じても失われないよう、閉じる直前に未保存分を送る
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    const pageHide = () => {
      if (!dirtyRef.current) return;
      void fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refinements: refinementsRef.current }),
        keepalive: true,
      });
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pagehide", pageHide);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pagehide", pageHide);
    };
  }, [project.id]);

  /* ---- 状態の導出（保存はしない。第3章 3.3） ---- */
  const statusOf = useCallback(
    (block: Block): RowStatus => {
      const key = blockSourceKey(block);
      const t = transient[key];
      if (t === "pending") return "pending";
      if (t === "error") return "error";
      const r = refinements[key];
      if (!r) return "empty";
      return r.edited ? "edited" : "done";
    },
    [transient, refinements]
  );

  const doneCount = useMemo(
    () => utteranceBlocks.filter((b) => Boolean(refinements[blockSourceKey(b)])).length,
    [utteranceBlocks, refinements]
  );

  /**
   * 3列目は未変換の行にも原文が入っているため、スクロールして残作業を
   * 目で数えることができない。絞り込んで0行になることをもって
   * 処理漏れが無いことを確認する（第4章 4.2）。
   *
   * 議題見出しは整文対象ではないので、絞り込み中は一緒に隠す。
   * 残さないと「0行になった」の確認が成立しない。
   */
  const visibleBlocks = useMemo(() => {
    if (!onlyRaw) return doc.blocks;
    return doc.blocks.filter(
      (b) => b.kind === "utterance" && !refinements[blockSourceKey(b)]
    );
  }, [doc.blocks, onlyRaw, refinements]);

  /* ---- 1行変換 ---- */
  const refineOne = useCallback(
    async (block: Block) => {
      const key = blockSourceKey(block);
      const idx = utteranceBlocks.indexOf(block);
      setTransient((t) => ({ ...t, [key]: "pending" }));
      try {
        const text = await requestRefine({
          body: block.body,
          prevBody: utteranceBlocks[idx - 1]?.body ?? null,
          nextBody: utteranceBlocks[idx + 1]?.body ?? null,
          participants: project.participants,
          glossary: combinedGlossary,
        });
        setRefinements((r) => ({
          ...r,
          [key]: { text, edited: false, updatedAt: Date.now() },
        }));
        setTransient((t) => {
          const next = { ...t };
          delete next[key];
          return next;
        });
        scheduleSave();
      } catch {
        setTransient((t) => ({ ...t, [key]: "error" }));
      }
    },
    [utteranceBlocks, project.participants, combinedGlossary, scheduleSave]
  );

  /* ---- 手で編集した場合 ---- */
  const handleEdit = useCallback(
    (block: Block, value: string) => {
      const key = blockSourceKey(block);
      setRefinements((r) => ({
        ...r,
        [key]: { text: value, edited: true, updatedAt: Date.now() },
      }));
      scheduleSave();
    },
    [scheduleSave]
  );

  /* ---- 個別再変換（第4章 4.5） ---- */
  const handleRetry = useCallback(
    (block: Block) => {
      const key = blockSourceKey(block);
      if (refinements[key]?.edited) {
        const ok = window.confirm(
          "この行は手動で修正済みです。上書きして再変換しますか？"
        );
        if (!ok) return;
      }
      void refineOne(block);
    },
    [refinements, refineOne]
  );

  /* ---- 一括変換（第4章 4.3） ---- */
  const runBulk = useCallback(async () => {
    const editedAmongTargets = overwriteDone
      ? utteranceBlocks.filter((b) => refinements[blockSourceKey(b)]?.edited)
      : [];

    let includeEdited = false;
    if (editedAmongTargets.length > 0) {
      includeEdited = window.confirm(
        `手動修正済みの行が ${editedAmongTargets.length} 件あります。\n` +
          "これらも上書きしてやり直しますか？\n" +
          "（OK: 上書きする / キャンセル: 手動修正済みの行は保護して進める）"
      );
    }

    const targets = utteranceBlocks.filter((b) => {
      const r = refinements[blockSourceKey(b)];
      if (!r) return true; // 未変換は常に対象
      if (r.edited) return overwriteDone && includeEdited;
      return overwriteDone; // 変換済み（未編集）
    });

    if (targets.length === 0) return;

    abortRef.current = false;
    setRunning(true);
    for (const block of targets) {
      if (abortRef.current) break;
      await refineOne(block);
    }
    setRunning(false);
  }, [utteranceBlocks, refinements, overwriteDone, refineOne]);

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  const saveLabel =
    saveState === "saved"
      ? "保存済み"
      : saveState === "saving"
        ? "保存中…"
        : saveState === "error"
          ? "保存できませんでした"
          : "未保存の変更あり";

  return (
    <div className="refine-app">
      <div className="refine-toolbar">
        {running ? (
          <button className="btn btn-sm btn-danger" onClick={abort}>
            中断
          </button>
        ) : (
          <button className="btn btn-sm btn-primary" onClick={() => void runBulk()}>
            一括変換
          </button>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={overwriteDone}
            disabled={running}
            onChange={(e) => setOverwriteDone(e.target.checked)}
          />
          変換済みの行もやり直す
        </label>
        <span className="refine-progress">
          <strong>{doneCount}</strong> / {utteranceBlocks.length} 行 完了
        </span>
        <label className="refine-filter">
          表示
          <select
            value={onlyRaw ? "raw" : "all"}
            onChange={(e) => setOnlyRaw(e.target.value === "raw")}
            aria-label="表示の絞り込み"
          >
            <option value="all">すべて</option>
            <option value="raw">「原文のまま出力」の行だけ</option>
          </select>
        </label>
        <div className="spacer" />
        <span
          className={`save-state ${
            saveState === "saved" ? "saved" : saveState === "error" ? "error" : "dirty"
          }`}
        >
          {saveLabel}
        </span>
      </div>

      <div className="refine-table-scroll">
        <table className="refine-table">
          <colgroup>
            <col />
            <col className="refine-col-status" />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th>話者 ／ 原文</th>
              <th></th>
              <th>出力される内容（クリックで編集）</th>
            </tr>
          </thead>
          <tbody>
            {visibleBlocks.length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">
                  {onlyRaw
                    ? "「原文のまま出力」の行はありません。処理漏れはありません。"
                    : "話者整理画面でテキストを編集すると、ここに発言が表示されます。"}
                </td>
              </tr>
            ) : null}
            {visibleBlocks.map((block) => {
              if (block.kind === "heading") {
                return (
                  <tr key={block.index} className="refine-heading-row">
                    <td colSpan={3}>{block.heading}</td>
                  </tr>
                );
              }
              const key = blockSourceKey(block);
              return (
                <Row
                  key={block.index}
                  block={block}
                  status={statusOf(block)}
                  text={refinements[key]?.text ?? null}
                  running={running}
                  onEdit={handleEdit}
                  onRetry={handleRetry}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
