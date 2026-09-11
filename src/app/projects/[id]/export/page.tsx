import { notFound, redirect } from "next/navigation";
import { kv, keys } from "@/lib/kv";
import { currentUser } from "@/lib/auth";
import { loadOwned } from "@/lib/projects";
import type { ProjectWords } from "@/lib/types";
import ProjectNav from "@/components/ProjectNav";
import ExportApp from "@/components/ExportApp";

export const dynamic = "force-dynamic";

/**
 * 出力画面（③）。第7章。
 * 列構成を選んで Word 用にコピーする、読み取り専用の画面。
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
  const words = await kv.get<ProjectWords>(keys.projectWords(id));

  return (
    <div className="screen-page">
      <header className="topbar">
        <ProjectNav projectId={project.id} current="export" />
        <span style={{ fontWeight: 600 }}>{project.title}</span>
      </header>
      <ExportApp project={project} words={words} settings={user.settings} />
    </div>
  );
}
