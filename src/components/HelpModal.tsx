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
  ["再生 / 一時停止", "Space（編集中は Shift+Space）"],
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
                <kbd>--@12.3</kbd>：区切りのうしろの数字は、その発言が音声のどこから
                始まるかです。取り込み時に自動で付き、表の「時刻」列と再生の連動に
                使われます。本文をいくら直しても時刻はずれません（区切りごと消すと
                無くなります）。手で書き足すこともでき、秒（<kbd>--@83.5</kbd>）・
                分:秒（<kbd>--@1:23.5</kbd>）・時:分:秒（<kbd>--@1:02:03</kbd>）の
                どの書き方でも読み取ります。再生バーや表の「時刻」列の表示を、
                そのまま写して書けます。
              </li>
              <li>
                <kbd>Alt+D</kbd> で区切りを入れると、時刻が時:分:秒（<kbd>--@0:01:23</kbd>）で
                付きます。音声を再生・頭出ししているときは、再生位置の<strong>2秒前</strong>の
                時刻です（話者が替わったのを聞いてから押すため。0秒より前にはなりません）。
                再生していないときは、カーソル位置の単語の時刻がそのまま付きます。
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
            <p style={{ marginTop: 8 }}>
              Mac では <kbd>Alt</kbd> の代わりに <kbd>Option（⌥）</kbd>キーを使います。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
