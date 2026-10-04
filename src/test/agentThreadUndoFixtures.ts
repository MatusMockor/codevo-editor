import { vi } from "vitest";
import type { AgentThreadStoreGateway } from "../application/agentThreadPorts";
import type { AgentThreadsDependencies } from "../application/useAgentThreads";
import { agentRootOwnerId, type AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentTaskGateway } from "../domain/agentTask";
import type { AgentThread } from "../domain/agentThread";
import type { GitStatus } from "../domain/git";
import type { GitIntegrationOutcome, GitShipStatus } from "../domain/gitIntegration";
import type { GitWorktreeGateway } from "../domain/gitWorktree";

export const UNDO_FIXTURE_ROOT = "/workspace/app";
export const UNDO_FIXTURE_OWNER = "workspace-a";
const PERSISTENT_OWNER = agentRootOwnerId(UNDO_FIXTURE_ROOT);
const SHA = "a".repeat(40);

export function undoStoredThread(
  threadId: string,
  overrides: Partial<AgentThread> = {},
): AgentThread {
  return {
    threadId,
    owner: {
      rootKey: UNDO_FIXTURE_ROOT,
      ownerId: PERSISTENT_OWNER,
      repositoryRoot: UNDO_FIXTURE_ROOT,
    },
    target: { isolation: "worktree", worktreePath: `${UNDO_FIXTURE_ROOT}/.worktrees/${threadId}` },
    provider: { kind: "claudeCode", sessionId: "sess-0001-abcd" },
    title: `Thread ${threadId}`,
    pinned: false,
    archived: false,
    createdAtEpochMs: 1_000,
    updatedAtEpochMs: 2_000,
    turns: [
      {
        turnId: `${threadId}-turn-0001`,
        prompt: `Thread ${threadId}`,
        status: { kind: "exited", exitCode: 0 },
        startedAtEpochMs: 1_000,
        endedAtEpochMs: 2_000,
        events: [],
        eventsTruncated: false,
        lastStatusSequence: 1,
        lastOutputSequence: 0,
        launch: null,
        cliVersion: null,
      },
    ],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
    ...overrides,
  };
}

export const UNDO_FIXTURE_PROJECT: AgentProjectDescriptor = {
  rootKey: UNDO_FIXTURE_ROOT,
  rootPath: UNDO_FIXTURE_ROOT,
  ownerId: UNDO_FIXTURE_OWNER,
  label: "app",
  generation: 1,
  trust: "trusted",
  origin: "active-tab",
  repositories: [
    {
      mapping: { rootRelativePath: "" },
      repositoryRoot: UNDO_FIXTURE_ROOT,
      repositoryRelativePath: "",
    },
  ],
  isolationPolicy: "auto",
  leaseToken: 1,
};

export const UNDO_FIXTURE_PROJECTS: ReadonlyArray<AgentProjectDescriptor> = [UNDO_FIXTURE_PROJECT];

function gitStatus(rootPath: string): GitStatus {
  return { branch: "main", changes: [], isRepository: true, rootPath };
}

function shipStatus(): GitShipStatus {
  return {
    worktree: { branch: "agent/x", head: SHA, dirty: false, changeCount: 0 },
    primary: { branch: "main", head: SHA, dirty: false },
    relation: { aheadOfPrimary: 0, behindPrimary: 0, fastForwardable: true },
    remote: null,
  };
}

export function undoThreadGateways(storedThreads: ReadonlyArray<AgentThread>) {
  const agentTaskGateway = {
    startAgentTask: vi.fn<AgentTaskGateway["startAgentTask"]>(async (request) => ({
      taskId: request.taskId,
    })),
    acknowledgeAgentTaskStart: vi.fn<AgentTaskGateway["acknowledgeAgentTaskStart"]>(
      async () => undefined,
    ),
    stopAgentTask: vi.fn<AgentTaskGateway["stopAgentTask"]>(async () => undefined),
    stopAgentTasksForRoot: vi.fn<AgentTaskGateway["stopAgentTasksForRoot"]>(async () => undefined),
    steerAgentTask: vi.fn<AgentTaskGateway["steerAgentTask"]>(async () => ({ kind: "accepted" })),
    closeAgentTaskInput: vi.fn<AgentTaskGateway["closeAgentTaskInput"]>(async () => undefined),
    subscribeAgentTaskStatus: vi.fn<AgentTaskGateway["subscribeAgentTaskStatus"]>(
      async () => () => undefined,
    ),
    subscribeAgentTaskOutput: vi.fn<AgentTaskGateway["subscribeAgentTaskOutput"]>(
      async () => () => undefined,
    ),
  } satisfies AgentTaskGateway;
  const agentThreadStoreGateway = {
    loadAgentThreads: vi.fn<AgentThreadStoreGateway["loadAgentThreads"]>(async () => ({
      threads: storedThreads,
      unreadable: [],
      evicted: 0,
    })),
    saveAgentThread: vi.fn<AgentThreadStoreGateway["saveAgentThread"]>(async () => undefined),
    deleteAgentThread: vi.fn<AgentThreadStoreGateway["deleteAgentThread"]>(async () => undefined),
  } satisfies AgentThreadStoreGateway;
  const gitWorktreeGateway = {
    listWorktrees: vi.fn<GitWorktreeGateway["listWorktrees"]>(async () => []),
    addAgentWorktree: vi.fn<GitWorktreeGateway["addAgentWorktree"]>(
      async (repositoryRoot, threadId) => ({
        worktreePath: `${repositoryRoot}/.worktrees/${threadId}`,
        branch: `agent/${threadId}`,
        trusted: true,
      }),
    ),
    removeWorktree: vi.fn<GitWorktreeGateway["removeWorktree"]>(async () => undefined),
    pruneWorktrees: vi.fn<GitWorktreeGateway["pruneWorktrees"]>(async () => []),
  } satisfies GitWorktreeGateway;
  const gitGateway = {
    getStatus: vi.fn(async (rootPath: string) => gitStatus(rootPath)),
    getDiff: vi.fn(async () => Promise.reject(new Error("diff unavailable"))),
    stageFiles: vi.fn(async (rootPath: string) => gitStatus(rootPath)),
    commit: vi.fn(async (rootPath: string) => gitStatus(rootPath)),
    deleteBranch: vi.fn(async () => undefined),
  };
  const gitIntegrationGateway = {
    getShipStatus: vi.fn(async () => shipStatus()),
    pushBranchUpstream: vi.fn(async () => ({
      remote: "origin",
      branch: "agent/x",
      compareUrl: null,
    })),
    integrateWorktreeBranch: vi.fn(async (): Promise<GitIntegrationOutcome> => ({
      kind: "integrated",
      mergeSha: SHA,
      intoBranch: "main",
    })),
  };
  return {
    agentTaskGateway,
    agentThreadStoreGateway,
    gitWorktreeGateway,
    gitGateway,
    gitIntegrationGateway,
  };
}

export type UndoThreadGateways = ReturnType<typeof undoThreadGateways>;

export function undoThreadDependencies(gateways: UndoThreadGateways): AgentThreadsDependencies {
  return {
    agentTaskGateway: gateways.agentTaskGateway,
    agentThreadStoreGateway: gateways.agentThreadStoreGateway,
    gitWorktreeGateway: gateways.gitWorktreeGateway,
    gitGateway: gateways.gitGateway,
    gitIntegrationGateway: gateways.gitIntegrationGateway,
    externalUrlOpener: null,
    editorBridge: null,
    prompter: { confirm: () => true, prompt: () => null },
    projects: UNDO_FIXTURE_PROJECTS,
    agentModeActive: true,
    getAgentCliKind: () => "claudeCode",
    currentCliVersion: () => "1.4.2",
    getAgentProviderAdmissionAuthority: (provider) => ({
      provider,
      revision: 1,
      disposition: { kind: "ready" },
      providerGeneration: 1,
    }),
    getMaxConcurrentAgentTasks: () => 4,
    launchIdentityForProject: () => ({ workspaceId: UNDO_FIXTURE_OWNER, generation: 1 }),
    getRepositoryStatus: () => ({ known: true, dirty: false }),
    getDirtyEditorDocumentCount: () => 0,
    reportError: () => undefined,
    openAgentSettings: () => undefined,
  };
}
