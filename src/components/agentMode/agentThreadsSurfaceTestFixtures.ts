import type { AgentThreadsSurface } from "../../application/agentThreadPorts";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { ResolvedGitRepository } from "../../domain/gitRepositoryMapping";
import { SURFACE_FIXTURE_ROOT } from "./agentSurfaceTestFixtures";

export const FIXTURE_NESTED_ROOT = `${SURFACE_FIXTURE_ROOT}/packages/api`;

export function fixtureRepository(
  repositoryRoot: string,
  rootRelativePath: string,
): ResolvedGitRepository {
  return { mapping: { rootRelativePath }, repositoryRoot, repositoryRelativePath: "" };
}

export function projectFixture(
  overrides: Partial<AgentProjectDescriptor> = {},
): AgentProjectDescriptor {
  return {
    rootKey: SURFACE_FIXTURE_ROOT,
    rootPath: SURFACE_FIXTURE_ROOT,
    ownerId: "agent-root:app",
    label: "app",
    generation: 0,
    trust: "trusted",
    origin: "active-tab",
    repositories: [
      fixtureRepository(SURFACE_FIXTURE_ROOT, ""),
      fixtureRepository(FIXTURE_NESTED_ROOT, "packages/api"),
    ],
    isolationPolicy: "auto",
    leaseToken: null,
    ...overrides,
  };
}

export function threadsSurfaceFixture(
  overrides: Partial<AgentThreadsSurface> = {},
): AgentThreadsSurface {
  return {
    threads: [],
    repositories: [
      fixtureRepository(SURFACE_FIXTURE_ROOT, ""),
      fixtureRepository(FIXTURE_NESTED_ROOT, "packages/api"),
    ],
    orphanedWorktrees: [],
    notice: null,
    dispatching: false,
    agentCliConfigured: true,
    agentCliKind: "claudeCode",
    agentCliVersion: null,
    liveTaskCount: 0,
    maxConcurrentAgentTasks: 4,
    pendingTurnCount: () => 0,
    isolationPreview: (repositoryRoot: string) => ({
      repositoryRoot,
      recommended: { kind: "in-place" },
      inPlaceGuard: { kind: "safe" },
      inPlaceAllowed: true,
      confirmationKey: null,
    }),
    refreshIsolationStatus: async () => undefined,
    startThread: async () => ({ threadId: "agt-default" }),
    sendFollowUp: async () => true,
    stop: async () => undefined,
    togglePin: () => undefined,
    archive: () => undefined,
    remove: () => undefined,
    hasLiveTasksForOwner: () => false,
    stopProjectTasks: async () => undefined,
    releaseProjectTasks: () => undefined,
    removeOrphanedWorktree: async () => undefined,
    pruneOrphanedWorktrees: async () => undefined,
    showChanges: async () => undefined,
    hideChanges: () => undefined,
    showFileDiff: async () => undefined,
    hideFileDiff: () => undefined,
    removeWorktree: async () => undefined,
    refreshShipStatus: async () => undefined,
    commitThreadChanges: async () => undefined,
    pushThreadBranch: async () => undefined,
    openThreadCompareUrl: async () => undefined,
    integrateThreadBranch: async () => undefined,
    removeThreadWorktree: async () => undefined,
    resetThreadShip: () => undefined,
    openChangedFile: async () => undefined,
    openChangedFileDiff: async () => undefined,
    configureAgentCli: () => undefined,
    dismissNotice: () => undefined,
    markThreadViewed: () => undefined,
    markThreadUnread: () => undefined,
    renameThread: () => undefined,
    threadCopyDetail: () => null,
    lastUsedLaunch: () => null,
    ...overrides,
  };
}
