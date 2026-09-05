import { notFound, redirect } from "next/navigation";
import { kv, keys } from "@/lib/kv";
import { currentUser } from "@/lib/auth";
import { loadOwned } from "@/lib/projects";
import type { ProjectWords } from "@/lib/types";
import EditorApp from "@/components/EditorApp";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const project = await loadOwned(id, user.id);
  if (!project) notFound();
  const data = await kv.get<ProjectWords>(keys.projectWords(id));

  return (
    <EditorApp
      project={project}
      words={data}
      settings={user.settings}
      username={user.username}
    />
  );
}
