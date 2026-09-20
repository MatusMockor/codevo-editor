import { agentRootOwnerId, type AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentThread } from "../domain/agentThread";
export const catalogProject: AgentProjectDescriptor = {
  rootKey: "/workspace/app",
  rootPath: "/workspace/app",
  ownerId: "workspace-1",
  label: "app",
  generation: 1,
  trust: "trusted",
  origin: "active-tab",
  repositories: [],
  isolationPolicy: "auto",
  leaseToken: 1,
};
export function catalogThread(id = "agt-1-0a1b"): AgentThread {
  return {
    threadId: id,
    historyRevision: 7,
    owner: {
      rootKey: catalogProject.rootKey,
      ownerId: agentRootOwnerId(catalogProject.rootKey),
      repositoryRoot: catalogProject.rootPath,
    },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "codex", sessionId: null },
    title: id,
    pinned: false,
    archived: false,
    createdAtEpochMs: 1,
    updatedAtEpochMs: 2,
    turns: [],
    turnsTruncated: true,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
  };
}
