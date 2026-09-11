import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { loadOwned } from "@/lib/projects";
import ProjectNav from "@/components/ProjectNav";
import RefineApp from "@/components/RefineApp";

export const dynamic = "force-dynamic";

/**
 * 整文画面（②）。第4章の UI。
 * 実際の Anthropic API 連携（第8章 実装の順序 #7）はまだ行わず、
 * ダミー実装（src/editor/refineClient.ts）で代替している。
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
    <div className="screen-page">
      <header className="topbar">
        <ProjectNav projectId={project.id} current="refine" />
        <span style={{ fontWeight: 600 }}>{project.title}</span>
      </header>
      <RefineApp project={project} />
    </div>
  );
}
