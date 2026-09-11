import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { loadOwned } from "@/lib/projects";
import ProjectNav from "@/components/ProjectNav";

export const dynamic = "force-dynamic";

/**
 * 出力画面（③）。ステップ3時点ではナビゲーションのみの空ページ。
 * 中身（第7章）は次回以降に実装する。
 */
export default async function ExportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const project = await loadOwned(id, user.id);
  if (!project) notFound();

  return (
    <>
      <header className="topbar">
        <ProjectNav projectId={project.id} current="export" />
        <span style={{ fontWeight: 600 }}>{project.title}</span>
      </header>
      <div className="stub-page">
        <h1>出力画面</h1>
        <p className="muted">
          列構成を選んで Word 用にコピーする、読み取り専用の画面です。
          準備中のため、現在は表示できません。
        </p>
      </div>
    </>
  );
}
