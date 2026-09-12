"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project, Refinements } from "@/lib/types";
import type { PromptPreset } from "@/lib/refine";
import { parseDoc, type Block } from "@/editor/parse";
import { blockSourceKey } from "@/editor/refine";
import { requestRefine, RefineRequestError } from "@/editor/refineClient";
import GlossaryPanel from "./GlossaryPanel";

type SaveState = "saved" | "dirty" | "saving" | "error";

/** クライアント側だけで持つ一時的な状態（保存しない。第3章 3.3） */
type Transient = "pending" | "error";

type RowStatus = "empty" | "pending" | "done" | "edited" | "error";

/** 「原文のまま確定しました（取り消す）」を出しておく時間 */
const UNDO_NOTICE_MS = 6000;

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
  /** 何も編集せずに閉じたとき（＝原文のまま確定。第4章 4.6） */
  onConfirmAsIs: (block: Block) => void;
  onRetry: (block: Block) => void;
};

/**
 * 1 行分。整文対象は数百行になり得るため、内容が変わった行だけ
 * 描き直されるよう memo する（TableView.tsx の Row と同じ考え方）。
 */
const Row = memo(function Row({
  block,
  status,
  text,
  running,
  onEdit,
  onConfirmAsIs,
  onRetry,
}: RowProps) {
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
   *
   * 1文字でも打てば onChange 側で確定済み（text が入っている）なので、
   * ここを通るのは「一度も編集しなかった」場合だけ。
   * 見るだけのつもりでクリックした誤操作もここに来るため、
   * 親に知らせて取り消しの案内を出してもらう。
   */
  const commitOnBlur = () => {
    if (text === null && draft !== null) onConfirmAsIs(block);
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

/** 一括変換ループがリトライ要否を判断するための結果 */
type RefineOutcome = { ok: true } | { ok: false; error: RefineRequestError };

/**
 * 整文画面（②）。第4章の UI を実装する。
 * 整文は `/api/refine` 経由で Anthropic API を呼ぶ（第5章）。
 *
 * `presets` はサーバーコンポーネント側（refine/page.tsx）から渡す。
 * プロンプト組み立てと API キーの読み取りを含む `@/lib/refine` を
 * クライアントバンドルへ持ち込まないため。
 */
export default function RefineApp({
  project,
  presets,
}: {
  project: Project;
  presets: PromptPreset[];
}) {
  const [refinements, setRefinements] = useState<Refinements>(project.refinements);
  /**
   * この会議固有の固有名詞（第6章）。整文で AI に渡す情報なので、
   * ①話者整理画面ではなくこの画面が持つ。保存先は `Project.glossary` のまま。
   */
  const [glossary, setGlossary] = useState<string[]>(project.glossary);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  /**
   * 整文プロンプトのプリセット（第5.4章）。既存プロジェクトには
   * promptPresetId が無いので、その場合は既定（先頭 = formal）に倒す。
   */
  const [presetId, setPresetId] = useState<string>(
    project.promptPresetId ?? presets[0].id
  );
  const [transient, setTransient] = useState<Record<string, Transient>>({});
  const [overwriteDone, setOverwriteDone] = useState(false);
  /** 表示の絞り込み（第4章 4.2）。true なら「原文のまま出力」の行だけ */
  const [onlyRaw, setOnlyRaw] = useState(false);
  const [running, setRunning] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  /**
   * 「原文のまま確定」の直後だけ出す取り消しの案内（第4章 4.6）。
   * 数秒で自動的に消える。永続的なボタンは置かない。
   */
  const [undoNotice, setUndoNotice] = useState<{ key: string; updatedAt: number } | null>(
    null
  );
  /** 直近の失敗の内容。理由が分からないまま「失敗」だけが並ぶのを避ける */
  const [lastError, setLastError] = useState<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoNoticeRef = useRef(undoNotice);
  undoNoticeRef.current = undoNotice;
  const abortRef = useRef(false);

  const doc = useMemo(
    () => parseDoc(project.rawText, project.participants),
    [project.rawText, project.participants]
  );

  const utteranceBlocks = useMemo(
    () => doc.blocks.filter((b) => b.kind === "utterance"),
    [doc.blocks]
  );

  /* ---- 保存（2秒デバウンス。第4章 4.4） ---- */
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const payloadRef = useRef({ refinements, glossary, presetId });
  payloadRef.current = { refinements, glossary, presetId };

  const savePayload = () =>
    JSON.stringify({
      refinements: payloadRef.current.refinements,
      glossary: payloadRef.current.glossary,
      promptPresetId: payloadRef.current.presetId,
    });
  const savePayloadRef = useRef(savePayload);
  savePayloadRef.current = savePayload;

  const save = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: savePayloadRef.current(),
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

  /**
   * デバウンス待ちの変更を先に送り切る。
   *
   * `/api/refine` は固有名詞とプリセットを保存済みのプロジェクトから読み直す
   * （クライアントから差し替えられないようにするため）。登録・切り替えた直後に
   * 変換を始めると保存前の内容で整文されてしまうので、変換を始める前に必ず通す。
   */
  const flushSave = useCallback(async () => {
    if (!dirtyRef.current) return;
    await save();
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
        body: savePayloadRef.current(),
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

  const handleGlossaryChange = useCallback(
    (next: string[]) => {
      setGlossary(next);
      scheduleSave();
    },
    [scheduleSave]
  );

  /**
   * プリセットの切り替え（第5.4章）。
   * 以後の変換にだけ効く。既にある refinements には手を触れない。
   */
  const handlePresetChange = useCallback(
    (next: string) => {
      setPresetId(next);
      scheduleSave();
    },
    [scheduleSave]
  );

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
    async (block: Block): Promise<RefineOutcome> => {
      const key = blockSourceKey(block);
      const idx = utteranceBlocks.indexOf(block);
      setTransient((t) => ({ ...t, [key]: "pending" }));
      try {
        const text = await requestRefine({
          projectId: project.id,
          body: block.body,
          prevBody: utteranceBlocks[idx - 1]?.body ?? null,
          nextBody: utteranceBlocks[idx + 1]?.body ?? null,
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
        return { ok: true };
      } catch (e) {
        // 「失敗」は保存しない一時状態。個別再変換ボタンから復旧できる（第5.5章）
        const error =
          e instanceof RefineRequestError
            ? e
            : new RefineRequestError(String(e));
        setTransient((t) => ({ ...t, [key]: "error" }));
        setLastError(error.message);
        return { ok: false, error };
      }
    },
    [utteranceBlocks, project.id, scheduleSave]
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

  /* ---- 原文のまま確定する（第4章 4.6） ---- */
  const handleConfirmAsIs = useCallback(
    (block: Block) => {
      const key = blockSourceKey(block);
      const updatedAt = Date.now();
      setRefinements((r) => ({
        ...r,
        [key]: { text: block.body, edited: true, updatedAt },
      }));
      scheduleSave();
      // 見るだけのつもりでクリックした場合に戻せるよう、直後だけ案内を出す
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndoNotice({ key, updatedAt });
      undoTimer.current = setTimeout(() => setUndoNotice(null), UNDO_NOTICE_MS);
    },
    [scheduleSave]
  );

  const undoConfirmAsIs = useCallback(() => {
    const notice = undoNoticeRef.current;
    if (!notice) return;
    setRefinements((r) => {
      const current = r[notice.key];
      // 案内を出したあとでその行を触っていたら、何もしない
      if (!current || current.updatedAt !== notice.updatedAt) return r;
      const next = { ...r };
      delete next[notice.key];
      return next;
    });
    scheduleSave();
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoNotice(null);
  }, [scheduleSave]);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    []
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
      setLastError(null);
      // 固有名詞・プリセットの変更が未保存なら先に送る（サーバーが読むのは保存済みの値）
      void flushSave().then(() => refineOne(block));
    },
    [refinements, refineOne, flushSave]
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

    // 登録・切り替えたばかりの固有名詞とプリセットで変換されるよう、保存を先に済ませる
    await flushSave();

    abortRef.current = false;
    setLastError(null);
    setRunning(true);
    for (const block of targets) {
      if (abortRef.current) break;

      let outcome = await refineOne(block);

      // 429（レート制限・利用上限）はリトライせず即座にループを停止する。
      // 上限に達している可能性があり、叩き続けると状況が悪化する（第5.5章）
      if (!outcome.ok && outcome.error.isRateLimited) {
        setLastError(
          `レート制限または利用上限に達したため中断しました。しばらく待ってから再開してください。（${outcome.error.message}）`
        );
        break;
      }

      // 5xx・接続失敗は1回だけリトライする（第5.5章）
      if (!outcome.ok && outcome.error.isRetryable) {
        if (abortRef.current) break;
        outcome = await refineOne(block);
        if (!outcome.ok && outcome.error.isRateLimited) {
          setLastError(
            `レート制限または利用上限に達したため中断しました。しばらく待ってから再開してください。（${outcome.error.message}）`
          );
          break;
        }
      }

      // それでも失敗した行は「失敗」のまま次へ進む。
      // 復旧は個別再変換ボタンから行う（第5.5章）
    }
    setRunning(false);
  }, [utteranceBlocks, refinements, overwriteDone, refineOne, flushSave]);

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  const selectedPreset =
    presets.find((p) => p.id === presetId) ?? presets[0];

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
          文体
          <select
            value={presetId}
            disabled={running}
            onChange={(e) => handlePresetChange(e.target.value)}
            aria-label="プロンプトのプリセット"
          >
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
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
        <button
          className={`btn btn-sm${glossaryOpen ? " btn-on" : ""}`}
          onClick={() => setGlossaryOpen((v) => !v)}
          aria-pressed={glossaryOpen}
        >
          {glossaryOpen ? "固有名詞を閉じる" : "固有名詞"}
        </button>
        <span
          className={`save-state ${
            saveState === "saved" ? "saved" : saveState === "error" ? "error" : "dirty"
          }`}
        >
          {saveLabel}
        </span>
      </div>

      {/* プリセットは以後の変換にだけ効く。既にある結果が書き換わると
          誤解されないよう、切り替え位置のすぐ下に明示する */}
      <div className="refine-note">
        <span>{selectedPreset.hint}</span>
        <span className="muted">
          切り替えても、変換済み・手修正済みの行はそのままです。新しい文体にするには、
          その行を再変換してください。
        </span>
      </div>

      {lastError ? (
        <div className="refine-error-note" role="alert">
          <span>{lastError}</span>
          <button className="btn btn-sm" onClick={() => setLastError(null)}>
            閉じる
          </button>
        </div>
      ) : null}

      {glossaryOpen ? (
        <div className="drawer">
          <GlossaryPanel glossary={glossary} onChange={handleGlossaryChange} />
        </div>
      ) : null}

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
                  onConfirmAsIs={handleConfirmAsIs}
                  onRetry={handleRetry}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 原文のまま確定した直後だけ出す取り消しの案内（第4章 4.6）。
          見るだけのつもりでクリックした誤操作を戻せるようにする。
          数秒で自動的に消え、あとに何も残らない */}
      {undoNotice ? (
        <div className="refine-undo" role="status">
          <span>原文のまま確定しました</span>
          <button className="btn btn-sm" onClick={undoConfirmAsIs}>
            取り消す
          </button>
        </div>
      ) : null}
    </div>
  );
}
