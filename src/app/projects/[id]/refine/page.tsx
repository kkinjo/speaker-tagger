import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { loadOwned } from "@/lib/projects";
import ProjectNav from "@/components/ProjectNav";

export const dynamic = "force-dynamic";

/**
 * 整文画面（②）。ステップ3時点ではナビゲーションのみの空ページ。
 * 中身（第4章・第5章）は次回以降に実装する。
 */
export default async function RefinePage({
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
        <ProjectNav projectId={project.id} current="refine" />
        <span style={{ fontWeight: 600 }}>{project.title}</span>
      </header>
      <div className="stub-page">
        <h1>整文画面</h1>
        <p className="muted">
          口語の簡素化・体言止め化を行う画面です。準備中のため、現在は表示できません。
        </p>
      </div>
    </>
  );
}
