"use client";

import { useEffect } from "react";

type Props = {
  onClose: () => void;
};

/**
 * 常時使えるショートカットだけを載せる。
 * ペイン表示(左/両方/右)・文字サイズ・スクロール連動は
 * 画面上に専用のボタン/表示があるため、ここには含めない。
 */
const SHORTCUTS: [string, string][] = [
  ["再生 / 一時停止", "Space（編集中は Ctrl+Space）"],
  ["3秒 戻す / 進める", "Alt+←/→"],
  ["再生速度", "Alt+↑/↓"],
  ["未割り当ての次へ", "Alt+J"],
  ["区切り(--)を入れる", "Alt+D"],
  ["話者を選ぶ(@)", "Alt+A"],
  ["取り消し / やり直し", "Ctrl+Z / Ctrl+Shift+Z"],
];

export default function HelpModal({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="help-modal-title">使い方</h2>
          <button className="btn btn-sm" onClick={onClose}>
            閉じる
          </button>
        </div>

        <div className="modal-body">
          <section>
            <h3>画面の見方</h3>
            <p>
              左側は文字起こしをそのまま編集するところです。右側の表には、
              左側の内容が話者ごとに自動で反映されます（右側は直接編集できません）。
              右側の「表をコピー」を使うと、Word に貼り付けられる表としてコピーできます。
            </p>
          </section>

          <section>
            <h3>入力のルール</h3>
            <ul>
              <li>
                <kbd>@</kbd>：話者を指定します。入力すると、あらかじめ登録した参加者の
                候補が出るので、そこから選んでください。
              </li>
              <li>
                <kbd>--</kbd>（ハイフンを2つ）：発言の区切りです。この行を境に、
                右側の表が1行ずつ分かれます。
              </li>
              <li>
                <kbd>#</kbd>：議題の見出しです。話者を持たない、見出し専用の行になります。
              </li>
            </ul>
          </section>

          <section>
            <h3>キーボードショートカット</h3>
            <table className="key-table">
              <thead>
                <tr>
                  <th>操作</th>
                  <th>キー</th>
                </tr>
              </thead>
              <tbody>
                {SHORTCUTS.map(([action, key]) => (
                  <tr key={action}>
                    <td>{action}</td>
                    <td>
                      <kbd>{key}</kbd>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
}
