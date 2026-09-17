import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  MAX_AGENT_PROJECT_ROOTS,
  agentProjectOwnsLaunchRoot,
  type AgentProjectDescriptor,
} from "../../domain/agentProject";

export interface AgentProjectSelection {
  readonly projectOwnerId: string;
  readonly threadId: string | null;
  readonly threadOwnerKey: string | null;
}

export type AgentProjectSelectionMemory = Map<string, AgentProjectSelection>;

export function rememberProjectSelection(
  memory: AgentProjectSelectionMemory,
  project: AgentProjectDescriptor,
  threadId: string | null,
  threadOwnerKey: string | null,
): void {
  memory.delete(project.rootKey);
  memory.set(project.rootKey, { projectOwnerId: project.ownerId, threadId, threadOwnerKey });
  while (memory.size > MAX_AGENT_PROJECT_ROOTS) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

export function recalledProjectSelection(
  memory: AgentProjectSelectionMemory | undefined,
  project: AgentProjectDescriptor,
): AgentProjectSelection | null {
  const entry = memory?.get(project.rootKey);
  if (entry === undefined) return null;
  if (
    entry.projectOwnerId !== project.ownerId &&
    !project.runtimeOwnerIds?.includes(entry.projectOwnerId)
  )
    return null;
  return entry;
}

export function restorableProjectThread(
  selection: AgentProjectSelection | null,
  project: AgentProjectDescriptor,
  threads: ReadonlyArray<AgentThreadView>,
  authoritativeInventory = false,
): AgentProjectSelection | null {
  if (selection === null || selection.threadId === null) return null;
  const candidate = threads.find((view) => view.thread.threadId === selection.threadId);
  if (candidate === undefined)
    return !authoritativeInventory && selection.threadId.startsWith("remote-thread:")
      ? selection
      : null;
  const thread = candidate.thread;
  return projectOwnsRememberedThread(project, candidate) &&
    !thread.archived &&
    thread.owner.rootKey === project.rootKey &&
    JSON.stringify(thread.owner) === selection.threadOwnerKey
    ? selection
    : null;
}

export function projectOwnsRememberedThread(
  project: AgentProjectDescriptor,
  view: AgentThreadView,
): boolean {
  const owner = view.thread.owner;
  return (
    owner.rootKey === project.rootKey &&
    agentProjectOwnsLaunchRoot(project, owner.repositoryRoot) &&
    (owner.ownerId === project.ownerId || project.runtimeOwnerIds?.includes(owner.ownerId) === true)
  );
}
