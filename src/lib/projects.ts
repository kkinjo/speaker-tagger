import { kv, keys } from "./kv";
import type { Project, ProjectSummary } from "./types";

/** 指定ユーザーのものであることを確認したうえでプロジェクトを返す */
export async function loadOwned(
  projectId: string,
  userId: string
): Promise<Project | null> {
  const project = await kv.get<Project>(keys.project(projectId));
  if (!project || project.userId !== userId) return null;
  return project;
}

export async function listSummaries(userId: string): Promise<ProjectSummary[]> {
  const index = (await kv.get<ProjectSummary[]>(keys.projectIndex(userId))) ?? [];
  return [...index].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function toSummary(project: Project): ProjectSummary {
  return {
    id: project.id,
    title: project.title,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    hasAudio: Boolean(project.audio),
  };
}

/** 一覧用インデックスを最新の内容へ差し替える */
export async function upsertIndex(project: Project): Promise<void> {
  const index = (await kv.get<ProjectSummary[]>(keys.projectIndex(project.userId))) ?? [];
  const summary = toSummary(project);
  const at = index.findIndex((s) => s.id === project.id);
  if (at >= 0) index[at] = summary;
  else index.push(summary);
  await kv.set(keys.projectIndex(project.userId), index);
}

export async function removeFromIndex(
  userId: string,
  projectId: string
): Promise<void> {
  const index = (await kv.get<ProjectSummary[]>(keys.projectIndex(userId))) ?? [];
  await kv.set(
    keys.projectIndex(userId),
    index.filter((s) => s.id !== projectId)
  );
}
