"use client";

import { useEffect } from "react";

type Props = {
  /** 確認文言。改行を含めたい場合は `\n` を使う */
  message: string;
  /** 押すと破棄・保存内容が失われるなど、取り返しのつかない操作かどうか */
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * 整文画面で「AI による上書き」の前に必ず挟む確認モーダル。
 *
 * AI はあくまで補助という位置づけを明確にするため、一括変換・手動修正済みの
 * 上書きの前には必ずこのモーダルを経由させる。`window.confirm()` を使わない
 * のは、ブラウザ標準のダイアログはスタイルを統一できず、アプリの一部として
 * 見えないため。背景を覆うオーバーレイの上に確認ダイアログを出す点は
 * HelpModal.tsx と同じ作りにしてある。
 *
 * 「キャンセル」「実行」の2択のみ。実行を押すまで何も起こさない。
 * 背景クリック・Escape も「キャンセル」と同じ扱いにする（誤操作で
 * 実行側に倒れることがないよう、安全側にしてある）。
 */
export default function ConfirmModal({ message, danger, onCancel, onConfirm }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-describedby="confirm-modal-message"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="confirm-modal-message" className="confirm-modal-message">
          {message}
        </p>
        <div className="confirm-modal-actions">
          {/* 誤って Enter で確定しないよう、既定のフォーカスはキャンセル側に置く */}
          <button className="btn btn-sm" onClick={onCancel} autoFocus>
            キャンセル
          </button>
          <button
            className={`btn btn-sm ${danger ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm}
          >
            実行
          </button>
        </div>
      </div>
    </div>
  );
}
