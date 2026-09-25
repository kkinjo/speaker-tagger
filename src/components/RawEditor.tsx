"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Participant } from "@/lib/types";
import { participantLabel, type ParsedDoc } from "@/editor/parse";
import { buildOverlayLines, patchOverlay } from "@/editor/overlay";
import { activeMentionQuery, caretPosition } from "@/editor/caret";
import { replaceRange } from "@/editor/textEdit";

type Props = {
  value: string;
  onChange: (next: string) => void;
  participants: Participant[];
  /** 直近に選んだ話者 id。候補の並び順に使う */
  mru: string[];
  onUseSpeaker: (participantId: string) => void;
  doc: ParsedDoc;
  /** 話者交代ヒントの位置 (rawText 内オフセット) */
  hints: number[];
  activeBlock: number | null;
  caretBlock: number | null;
  onCaretChange: (offset: number) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
};

type SuggestState = {
  open: boolean;
  start: number;
  query: string;
  index: number;
  top: number;
  left: number;
};

const CLOSED: SuggestState = {
  open: false,
  start: 0,
  query: "",
  index: 0,
  top: 0,
  left: 0,
};

export default function RawEditor({
  value,
  onChange,
  participants,
  mru,
  onUseSpeaker,
  doc,
  hints,
  activeBlock,
  caretBlock,
  onCaretChange,
  textareaRef,
  scrollRef,
}: Props) {
  const mirrorRef = useRef<HTMLDivElement>(null);
  const suggestRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const [suggest, setSuggest] = useState<SuggestState>(CLOSED);
  /**
   * Escape で閉じた `@` の位置。同じ `@` の入力が続いている間は開き直さない。
   *
   * Escape は keydown で閉じるが、そのあとの keyup で refreshSuggest が走り、
   * カーソルがまだ `@…` の直後にあるため即座に開き直してしまっていた。
   * 結果として Escape が効かず、上下キーも候補選択に取られたままになる。
   * カーソルがその `@` から離れたら（改行・空白をまたぐ、`@` を消すなど）解除する。
   */
  const dismissedStartRef = useRef<number | null>(null);

  // テキストエリアは非制御。React に value を渡すと、更新のたびに
  // textarea の defaultValue が入れ直され、長い議事録では本文全体の
  // 再レイアウトが走って 1 文字あたり数百 ms かかってしまう。
  // 本文の持ち主は DOM 側とし、外から差し替わったときだけ書き戻す。
  const initialValueRef = useRef(value);
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (ta && ta.value !== value) ta.value = value;
  }, [value, textareaRef]);

  const overlayRef = useRef<HTMLDivElement>(null);
  const prevLinesRef = useRef<string[]>([]);

  const overlayLines = useMemo(
    () => buildOverlayLines({ raw: value, doc, hints, activeBlock, caretBlock }),
    [value, doc, hints, activeBlock, caretBlock]
  );

  // 装飾レイヤは React ではなく差分で書き換える。まるごと入れ替えると
  // 数千行のレイアウト計算が毎回走り、長い議事録で入力が引っかかるため。
  useLayoutEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    patchOverlay(el, prevLinesRef.current, overlayLines);
    prevLinesRef.current = overlayLines;
  }, [overlayLines]);

  /** 候補は MRU 順 → 登録順。事前登録した参加者以外は出さない */
  const candidates = useMemo(() => {
    const query = suggest.query.trim().toLowerCase();
    const ordered = [
      ...mru
        .map((id) => participants.find((p) => p.id === id))
        .filter((p): p is Participant => Boolean(p)),
      ...participants.filter((p) => !mru.includes(p.id)),
    ];
    if (!query) return ordered;
    return ordered.filter((p) => {
      const label = participantLabel(p).toLowerCase();
      return (
        label.includes(query) ||
        p.name.toLowerCase().includes(query) ||
        p.org.toLowerCase().includes(query)
      );
    });
  }, [participants, mru, suggest.query]);

  const refreshSuggest = useCallback(
    (ta: HTMLTextAreaElement) => {
      if (composingRef.current) return;
      const caret = ta.selectionStart;
      const found =
        ta.selectionStart === ta.selectionEnd
          ? activeMentionQuery(ta.value, caret)
          : null;
      if (!found || participants.length === 0) {
        dismissedStartRef.current = null;
        setSuggest((s) => (s.open ? CLOSED : s));
        return;
      }
      // Escape で閉じた書きかけの `@` は、未登録の @ と同じく本文として残す
      if (found.start === dismissedStartRef.current) {
        setSuggest((s) => (s.open ? CLOSED : s));
        return;
      }
      dismissedStartRef.current = null;
      const mirror = mirrorRef.current;
      const pos = mirror
        ? caretPosition(mirror, ta.value, found.start)
        : { top: 0, left: 0, height: 20 };
      setSuggest((prev) => ({
        open: true,
        start: found.start,
        query: found.query,
        index: prev.open && prev.start === found.start ? prev.index : 0,
        top: pos.top + pos.height,
        left: pos.left,
      }));
    },
    [participants.length]
  );

  /**
   * ピッカーが開いた瞬間に1回だけ、候補全体が見えるまで左ペインを
   * スクロールする。画面の下のほうで `@` を打つと候補がはみ出すため。
   *
   * 依存は open と start だけにしてある。絞り込みで候補や query が
   * 変わって再描画されても、ここは再発火させない。
   * 左右のスクロール連動はそのまま効く（右ペインも一緒に動いてよい）。
   */
  useLayoutEffect(() => {
    if (!suggest.open) return;
    const box = suggestRef.current;
    const scroller = scrollRef.current;
    if (!box || !scroller) return;
    const MARGIN = 8;
    const boxRect = box.getBoundingClientRect();
    const viewRect = scroller.getBoundingClientRect();
    const overflow = boxRect.bottom + MARGIN - viewRect.bottom;
    if (overflow <= 0) return;
    // 候補の上端（＝入力中の行のすぐ下）が画面上端より上へ行くほどは動かさない
    const room = boxRect.top - MARGIN - viewRect.top;
    const delta = Math.min(overflow, Math.max(0, room));
    if (delta > 0) scroller.scrollTop += delta;
  }, [suggest.open, suggest.start, scrollRef]);

  const commit = useCallback(
    (participant: Participant) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const label = participantLabel(participant);
      const caret = ta.selectionStart;
      // 1ブロック = 話者1人を徹底するため、メンション確定時は無条件で
      // 改行を入れる（1ブロックに @ を2つ書いて重ねて表示する運用は廃止）。
      // カーソル直後にすでに改行があるならそれ以上は足さない。常に足すと、
      // 話者を付け替える場面（既存の @ を消して打ち直すなど）で元々あった
      // 改行がそのまま残り、空行が増えてしまうため
      const suffix = ta.value[caret] === "\n" ? "" : "\n";
      replaceRange(ta, suggest.start, caret, `@${label}${suffix}`);
      onUseSpeaker(participant.id);
      setSuggest(CLOSED);
    },
    [onUseSpeaker, suggest.start, textareaRef]
  );

  /** Escape でピッカーを閉じる。以降、上下キーは本文のカーソル移動に戻る */
  function dismissSuggest() {
    dismissedStartRef.current = suggest.start;
    setSuggest(CLOSED);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!suggest.open || candidates.length === 0) {
      if (suggest.open && e.key === "Escape") {
        e.preventDefault();
        dismissSuggest();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSuggest((s) => ({ ...s, index: (s.index + 1) % candidates.length }));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSuggest((s) => ({
        ...s,
        index: (s.index - 1 + candidates.length) % candidates.length,
      }));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      commit(candidates[Math.min(suggest.index, candidates.length - 1)]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      dismissSuggest();
    }
  }

  function syncCaret() {
    const ta = textareaRef.current;
    if (!ta) return;
    onCaretChange(ta.selectionStart);
  }

  return (
    <div className="editor-scroll" ref={scrollRef}>
      <div className="editor-inner">
        <div className="editor-overlay" aria-hidden ref={overlayRef} />
        <div className="editor-mirror" aria-hidden ref={mirrorRef} />
        <textarea
          ref={textareaRef}
          className="editor-input"
          defaultValue={initialValueRef.current}
          spellCheck={false}
          placeholder="ここに文字起こしが入ります。@ で話者、-- で発言の区切り、# で議題見出しになります。"
          onChange={(e) => {
            onChange(e.target.value);
            onCaretChange(e.target.selectionStart);
            refreshSuggest(e.target);
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={(e) => {
            syncCaret();
            refreshSuggest(e.currentTarget);
          }}
          onClick={(e) => {
            syncCaret();
            refreshSuggest(e.currentTarget);
          }}
          onSelect={syncCaret}
          onBlur={() => setSuggest(CLOSED)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            composingRef.current = false;
            refreshSuggest(e.currentTarget);
          }}
        />

        {suggest.open ? (
          <div
            ref={suggestRef}
            className="suggest"
            style={{ top: suggest.top, left: suggest.left }}
            // 候補クリックでテキストエリアのフォーカスが外れないようにする
            onMouseDown={(e) => e.preventDefault()}
          >
            {candidates.length === 0 ? (
              <div className="suggest-empty">
                一致する参加者がいません。上の「参加者」から登録してください。
              </div>
            ) : (
              candidates.map((p, i) => (
                <div
                  key={p.id}
                  className="suggest-item"
                  aria-selected={i === suggest.index}
                  onMouseEnter={() => setSuggest((s) => ({ ...s, index: i }))}
                  onClick={() => commit(p)}
                >
                  <span className="org">{p.org || "（所属なし）"}</span>
                  <span>{p.name}</span>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
