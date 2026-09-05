/**
 * テキストエリアへの書き込みは、ブラウザ標準の取り消し履歴 (Ctrl+Z) を
 * 壊さない方法で行う。プログラムから value を差し替えると履歴が消えて
 * しまい、「戻す」が効かなくなるため。
 */
export function insertAtSelection(
  ta: HTMLTextAreaElement,
  text: string
): void {
  ta.focus();
  let ok = false;
  try {
    ok = document.execCommand("insertText", false, text);
  } catch {
    ok = false;
  }
  if (!ok) {
    // execCommand が使えない環境向けのフォールバック
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    ta.setRangeText(text, start, end, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

export function replaceRange(
  ta: HTMLTextAreaElement,
  start: number,
  end: number,
  text: string
): void {
  ta.focus();
  ta.setSelectionRange(start, end);
  insertAtSelection(ta, text);
}

/** 本文全体を置き換える (取り消し可能) */
export function replaceAll(ta: HTMLTextAreaElement, text: string): void {
  replaceRange(ta, 0, ta.value.length, text);
}

/**
 * 指定位置へカーソルを移動する。
 * `focus` を渡さない場合はフォーカスを奪わないので、表をクリックしただけで
 * Space が「空白の入力」に化けてしまうことがない。
 */
export function moveCaret(
  ta: HTMLTextAreaElement,
  index: number,
  focus = false
): void {
  if (focus) ta.focus();
  const at = Math.max(0, Math.min(ta.value.length, index));
  ta.setSelectionRange(at, at);
}
