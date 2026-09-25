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
   * Escape で閉じた `@` の位置。同じ `@` に続けて文字を打っても開き直さない
   * （書きかけの `@…` は未登録の @ と同じく本文として残す）。
   * カーソルがその `@` から離れたら（改行・空白をまたぐ、`@` を消すなど）解除する。
   */
  const dismissedStartRef = useRef<number | null>(null);
  /**
   * ピッカーを開いた（または絞り込んだ）ときのカーソル位置。
   * これと違う位置へカーソルが動いたら、入力以外の操作で動かしたとみなして閉じる。
   */
  const typedCaretRef = useRef<number | null>(null);

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

  /**
   * ピッカーの開閉を判定する。
   *
   * 開くのは文字を入力したとき（`typed`）だけ。カーソル移動（矢印キー・
   * クリック・確定や Escape の keyup）では閉じることはあっても開かない。
   * 以前はカーソル移動でも開いていたため、カーソルが `@所属/氏名` の直後や
   * 途中に来るたびに開き、上下キーを候補選択に取られて本文へ戻れなかった
   * （Escape や Enter で閉じても、その keyup で即座に開き直していた）。
   */
  const refreshSuggest = useCallback(
    (ta: HTMLTextAreaElement, typed: boolean) => {
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
      if (!typed) {
        // 入力以外でカーソルが動いたら（矢印キー・Home/End・クリック）閉じる。
        // 同じ `@…` の中での移動でも閉じる。開いたままだと、移動先で Enter を
        // 押したときにそこで候補が確定してしまう。日本語は語の間に空白が無く、
        // `@山` の後ろに本文が続いていると → で本文側へ動かしても同じ `@…` の
        // 続きに見えるため、位置が変わったかどうかで判断する
        if (caret !== typedCaretRef.current) setSuggest((s) => (s.open ? CLOSED : s));
        return;
      }
      // Escape で閉じた書きかけの `@` は、未登録の @ と同じく本文として残す
      if (found.start === dismissedStartRef.current) {
        setSuggest((s) => (s.open ? CLOSED : s));
        return;
      }
      dismissedStartRef.current = null;
      typedCaretRef.current = caret;
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

  /**
   * ↑↓ で選んだ候補が、候補の枠（最大 260px）の外に出たら枠の中をスクロールする。
   * 左ペイン自体は動かさない（開いた瞬間の1回だけ、という上の決めごとを崩さない）。
   */
  useLayoutEffect(() => {
    if (!suggest.open) return;
    const box = suggestRef.current;
    const item = box?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!box || !item) return;
    const PAD = 4; // .suggest の padding
    if (item.offsetTop < box.scrollTop + PAD) {
      box.scrollTop = item.offsetTop - PAD;
    } else if (item.offsetTop + item.offsetHeight > box.scrollTop + box.clientHeight - PAD) {
      box.scrollTop = item.offsetTop + item.offsetHeight - box.clientHeight + PAD;
    }
  }, [suggest.open, suggest.index, candidates]);

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
    // IME で変換中のキー（変換確定の Enter など）は IME に任せる
    if (e.nativeEvent.isComposing || composingRef.current) return;
    // 念のための安全策：カーソルが候補を開いた位置から動いていたら
    // （マウス・トラックパッド・IME などで閉じる処理をすり抜けた場合）、
    // Enter や ↑↓ を候補の操作に使わず、閉じて普通のキーとして通す。
    // 通してしまうと `@` から今のカーソル位置までが候補で上書きされる
    const ta = e.currentTarget;
    if (
      suggest.open &&
      (ta.selectionStart !== ta.selectionEnd || ta.selectionStart !== typedCaretRef.current)
    ) {
      setSuggest(CLOSED);
      return;
    }
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
            refreshSuggest(e.target, true);
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={(e) => {
            syncCaret();
            refreshSuggest(e.currentTarget, false);
          }}
          onClick={(e) => {
            syncCaret();
            refreshSuggest(e.currentTarget, false);
          }}
          onSelect={syncCaret}
          onBlur={() => setSuggest(CLOSED)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            composingRef.current = false;
            refreshSuggest(e.currentTarget, true);
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
