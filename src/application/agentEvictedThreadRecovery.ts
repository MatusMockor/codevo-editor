import { agentRootOwnerId, type AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentThread } from "../domain/agentThread";
import { AGENT_TASKS_SOURCE } from "./agentProjectAuthority";
import type { AgentHistoryCatalogGateway } from "./useAgentHistoryCatalog";

export const MAX_AGENT_RECOVERY_CATALOG_PAGES = 8;

export type AgentRecoveryProject = Pick<
  AgentProjectDescriptor,
  "rootKey" | "ownerId" | "generation"
>;

export type AgentThreadRecovery =
  | { readonly kind: "foreign" }
  | { readonly kind: "restored" }
  | { readonly kind: "notRestored"; readonly title: string | null };

export interface AgentEvictedThreadPort {
  rootKeyOf(workspaceId: string): string | null;
  recover(threadId: string, workspaceId: string): Promise<AgentThreadRecovery>;
}

export interface AgentEvictedThreadRecoveryPorts {
  readonly catalog: AgentHistoryCatalogGateway | undefined;
  project(workspaceId: string): AgentRecoveryProject | undefined;
  restoreThread(thread: AgentThread): Promise<boolean>;
  reportError(source: string, error: unknown): void;
}

const FOREIGN: AgentThreadRecovery = { kind: "foreign" };
const RESTORED: AgentThreadRecovery = { kind: "restored" };

export async function recoverEvictedAgentThread(
  ports: AgentEvictedThreadRecoveryPorts,
  threadId: string,
  workspaceId: string,
): Promise<AgentThreadRecovery> {
  const project = ports.project(workspaceId);
  if (project === undefined) return FOREIGN;
  const { catalog } = ports;
  if (catalog === undefined) return notRestored(null);
  const owns = (): boolean => sameProject(ports.project(workspaceId), project);
  let saved: AgentThread | null = null;
  try {
    saved = await findSavedThread(catalog, project.rootKey, threadId, owns);
    if (!owns()) return FOREIGN;
    if (saved === null) return notRestored(null);
    if (saved.provider.kind !== "claudeCode" || saved.archived) return notRestored(saved.title);
    const latest = await catalog.readAgentHistoryTurns({
      rootKey: project.rootKey,
      ownerId: agentRootOwnerId(project.rootKey),
      threadId,
      beforeTurnId: null,
    });
    if (!owns()) return FOREIGN;
    if (saved.historyRevision !== latest.revision) return notRestored(saved.title);
    const restored = await ports.restoreThread({
      ...saved,
      turns: latest.turns,
      historyRevision: latest.revision,
      turnsTruncated: latest.hasEarlier,
      owner: { ...saved.owner, ownerId: project.ownerId },
    });
    if (!owns()) return FOREIGN;
    return restored ? RESTORED : notRestored(saved.title);
  } catch (error) {
    if (!owns()) return FOREIGN;
    ports.reportError(AGENT_TASKS_SOURCE, error);
    return notRestored(saved?.title ?? null);
  }
}

async function findSavedThread(
  catalog: AgentHistoryCatalogGateway,
  rootKey: string,
  threadId: string,
  owns: () => boolean,
): Promise<AgentThread | null> {
  let beforeThreadId: string | null = null;
  for (let page = 0; page < MAX_AGENT_RECOVERY_CATALOG_PAGES; page += 1) {
    const result = await catalog.readAgentHistoryThreads({
      rootKey,
      ownerId: agentRootOwnerId(rootKey),
      beforeThreadId,
    });
    if (!owns()) return null;
    const found = result.threads.find((thread) => thread.threadId === threadId);
    if (found !== undefined) return found;
    if (!result.hasEarlier || result.beforeThreadId === null) return null;
    beforeThreadId = result.beforeThreadId;
  }
  return null;
}

function sameProject(
  current: AgentRecoveryProject | undefined,
  captured: AgentRecoveryProject,
): boolean {
  if (current === undefined) return false;
  return (
    current.rootKey === captured.rootKey &&
    current.ownerId === captured.ownerId &&
    current.generation === captured.generation
  );
}

function notRestored(title: string | null): AgentThreadRecovery {
  return { kind: "notRestored", title };
}
