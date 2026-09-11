/**
 * ①話者整理・②整文・③出力の3画面を行き来するための共通ナビゲーション。
 * 各画面の上部に置く。現在地はリンクにせず、そのまま文字で示す。
 */

type Screen = "editor" | "refine" | "export";

const SCREENS: { key: Screen; label: string; path: string }[] = [
  { key: "editor", label: "話者整理", path: "" },
  { key: "refine", label: "整文", path: "/refine" },
  { key: "export", label: "出力", path: "/export" },
];

export default function ProjectNav({
  projectId,
  current,
}: {
  projectId: string;
  current: Screen;
}) {
  return (
    <nav className="project-nav" aria-label="画面の切り替え">
      <a href="/projects" className="btn btn-sm" title="一覧へ戻る">
        ← 一覧
      </a>
      {SCREENS.map((screen) =>
        screen.key === current ? (
          <span key={screen.key} className="project-nav-current" aria-current="page">
            {screen.label}
          </span>
        ) : (
          <a
            key={screen.key}
            className="project-nav-link"
            href={`/projects/${projectId}${screen.path}`}
          >
            {screen.label}
          </a>
        )
      )}
    </nav>
  );
}
