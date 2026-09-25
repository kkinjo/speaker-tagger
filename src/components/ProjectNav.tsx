/**
 * ①話者整理・②整文・③出力の3画面を行き来するための共通ナビゲーション。
 * 各画面の上部と、プロジェクト一覧の各行に置く。
 *
 * 番号付きのボタンとして並べ、作業の順番が一目で分かるようにする。
 * 画面の移動はリンクのまま（ブラウザの戻る・新しいタブで開く、が効くように）で、
 * 見た目だけブラウザ標準のボタンに揃える（.link-btn）。
 * 現在地はリンクにせず、選択中の見た目（薄い背景＋太字）で示す。
 */

type Screen = "editor" | "refine" | "export";

const SCREENS: { key: Screen; label: string; path: string }[] = [
  { key: "editor", label: "① 話者整理", path: "" },
  { key: "refine", label: "② 整文", path: "/refine" },
  { key: "export", label: "③ 出力", path: "/export" },
];

/** 3画面へのボタン。`current` を渡すと、その画面は現在地として表示する */
export function ScreenLinks({
  projectId,
  current,
}: {
  projectId: string;
  current?: Screen;
}) {
  return (
    <span className="screen-links">
      {SCREENS.map((screen) =>
        screen.key === current ? (
          <span key={screen.key} className="link-btn link-btn-current" aria-current="page">
            {screen.label}
          </span>
        ) : (
          <a
            key={screen.key}
            className="link-btn"
            href={`/projects/${projectId}${screen.path}`}
          >
            {screen.label}
          </a>
        )
      )}
    </span>
  );
}

export default function ProjectNav({
  projectId,
  current,
}: {
  projectId: string;
  current: Screen;
}) {
  return (
    <nav className="project-nav" aria-label="画面の切り替え">
      <a href="/projects" className="link-btn" title="一覧へ戻る">
        ← 一覧
      </a>
      <ScreenLinks projectId={projectId} current={current} />
    </nav>
  );
}
