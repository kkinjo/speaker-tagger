import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { loadOwned } from "@/lib/projects";
import { PROMPT_PRESETS } from "@/lib/refine";
import ProjectNav from "@/components/ProjectNav";
import RefineApp from "@/components/RefineApp";

export const dynamic = "force-dynamic";

/**
 * 整文画面（②）。第4章の UI。
 *
 * プリセットの一覧はここで読んで props で渡す。`@/lib/refine` は
 * API キーの読み取りと Anthropic API 呼び出しを含むサーバー側のモジュールなので、
 * クライアントコンポーネントから直接 import しない（第5.1章）。
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
      <RefineApp project={project} presets={PROMPT_PRESETS} />
    </div>
  );
}
