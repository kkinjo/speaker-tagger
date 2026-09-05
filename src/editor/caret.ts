/**
 * テキストエリア内のカーソル位置の座標を測る。
 * 同じ書式を持つミラー要素へ本文の前半だけを流し込み、
 * 目印の位置を読み取ることで求める。
 */
export function caretPosition(
  mirror: HTMLElement,
  value: string,
  index: number
): { top: number; left: number; height: number } {
  mirror.textContent = value.slice(0, index);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.appendChild(marker);
  const top = marker.offsetTop;
  const left = marker.offsetLeft;
  const height = marker.offsetHeight || 20;
  mirror.textContent = "";
  return { top, left, height };
}

/** カーソル直前で入力中の `@メンション` を取り出す */
export function activeMentionQuery(
  value: string,
  caret: number
): { start: number; query: string } | null {
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i];
    if (ch === "@") {
      return { start: i, query: value.slice(i + 1, caret) };
    }
    // 空白・改行・別の @ をまたいだらメンション入力ではない
    if (ch === "\n" || ch === " " || ch === "　" || ch === "\t") return null;
    if (caret - i > 30) return null;
    i--;
  }
  return null;
}
