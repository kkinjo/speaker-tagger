import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listSummaries } from "@/lib/projects";
import ProjectList from "@/components/ProjectList";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const projects = await listSummaries(user.id);
  return <ProjectList username={user.username} initial={projects} />;
}
