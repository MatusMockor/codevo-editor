// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { agentRootOwnerId } from "../domain/agentProject";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import type {
  AgentTaskGateway,
  AgentTaskOutputEvent,
  AgentTaskStatus,
  AgentTaskStatusEvent,
  StartAgentTaskRequest,
} from "../domain/agentTask";
import type { AgentThread } from "../domain/agentThread";
import type { GitStatus } from "../domain/git";
import type { GitWorktreeDescriptor, GitWorktreeGateway } from "../domain/gitWorktree";
import { waitForReact } from "../test/reactTestLifecycle";
import type { AgentThreadStoreGateway, AgentThreadsSurface } from "./agentThreadPorts";
import { useAgentThreads, type AgentThreadsDependencies } from "./useAgentThreads";

const ROOT = "/workspace/app";
const OWNER = "workspace-a";
const PERSISTENT_OWNER = agentRootOwnerId(ROOT);
const CLI_PATH = "/usr/local/bin/claude";

interface Environment {
  generation: number;
  agentModeActive: boolean;
  worktrees: ReadonlyArray<GitWorktreeDescriptor>;
  storedThreads: ReadonlyArray<AgentThread>;
}

describe("useAgentThreads facade", () => {
  it("loads persisted threads on agent mode entry and presents them as settled views", async () => {
    const stored = storedThread("agt-stored-0001", "agt-stored-0002");
    const harness = renderThreads({ storedThreads: [stored] });

    await waitForReact(() => expect(harness.hook().threads).toHaveLength(1));

    const view = harness.hook().threads[0];
    expect(view?.thread.threadId).toBe(stored.threadId);
    expect(view?.lifecycle).toBe("settled");
    expect(view?.repositoryLabel).toBe("app");
    expect(view?.worktreeMissing).toBe(true);
    expect(harness.store.loadAgentThreads).toHaveBeenCalledWith({
      rootKey: ROOT,
      ownerId: PERSISTENT_OWNER,
    });
    harness.unmount();
  });

  it("starts a thread, tracks it as running, and settles it on the terminal status", async () => {
    const harness = renderThreads();
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());

    const result = await act(() => harness.hook().startThread(startRequest()));
    expect(result).not.toBeNull();
    const threadId = result?.threadId ?? "";

    expect(harness.hook().threads).toHaveLength(1);
    expect(harness.hook().threads[0]?.lifecycle).toBe("running");
    expect(harness.hook().liveTaskCount).toBe(1);
    expect(harness.hook().hasLiveTasksForOwner(OWNER)).toBe(true);
    expect(harness.hook().isolationPreview(ROOT).inPlaceGuard).toEqual({
      kind: "unsafe",
      reasons: ["agent-active"],
    });
    expect(harness.store.saveAgentThread).toHaveBeenCalled();

    act(() => harness.hook().remove(threadId));
    expect(harness.hook().notice?.message).toContain("Stop the agent");

    await act(async () => {
      harness.emitStatus(threadId, 1, { kind: "exited", exitCode: 0 });
    });

    expect(harness.hook().threads[0]?.lifecycle).toBe("settled");
    expect(harness.hook().liveTaskCount).toBe(0);
    expect(harness.hook().isolationPreview(ROOT).inPlaceGuard).toEqual({ kind: "safe" });
    harness.unmount();
  });

  it("removes a settled thread from the store and releases settled threads of an owner", async () => {
    const harness = renderThreads();
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());
    const first = (await act(() => harness.hook().startThread(startRequest())))?.threadId ?? "";
    await act(async () => {
      harness.emitStatus(first, 1, { kind: "exited", exitCode: 0 });
    });

    await act(async () => {
      harness.hook().remove(first);
    });
    await waitForReact(() => expect(harness.hook().threads).toHaveLength(0));
    expect(harness.store.deleteAgentThread).toHaveBeenCalledWith({
      rootKey: ROOT,
      ownerId: PERSISTENT_OWNER,
      threadId: first,
    });

    const second = (await act(() => harness.hook().startThread(startRequest())))?.threadId ?? "";
    await act(async () => {
      harness.emitStatus(second, 1, { kind: "stopped" });
    });
    await act(async () => {
      harness.hook().releaseProjectTasks(OWNER);
    });

    expect(harness.hook().threads).toHaveLength(0);
    harness.unmount();
  });

  it("stops a running thread through the task gateway and lists the repository", async () => {
    const harness = renderThreads();
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());
    const threadId = (await act(() => harness.hook().startThread(startRequest())))?.threadId ?? "";

    await act(() => harness.hook().stop(threadId));

    expect(harness.agent.stopAgentTask).toHaveBeenCalledWith({
      taskId: harness.startedRequests[0]?.taskId,
      workspaceId: OWNER,
    });
    expect(harness.hook().repositories.map((repository) => repository.repositoryRoot)).toEqual([
      ROOT,
    ]);
    expect(harness.hook().agentCliConfigured).toBe(true);
    harness.unmount();
  });
});

function startRequest() {
  return {
    projectRootKey: ROOT,
    repositoryRoot: ROOT,
    prompt: "Fix the failing test",
    isolation: "worktree" as const,
    unsafeInPlaceConfirmationKey: null,
  };
}

function storedThread(threadId: string, turnId: string): AgentThread {
  return {
    threadId,
    owner: { rootKey: ROOT, ownerId: PERSISTENT_OWNER, repositoryRoot: ROOT },
    target: { isolation: "worktree", worktreePath: `${ROOT}/.worktrees/${threadId}` },
    provider: { kind: "claudeCode", sessionId: "sess-0001-abcd" },
    title: "Stored thread",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1_000,
    updatedAtEpochMs: 2_000,
    turns: [
      {
        turnId,
        prompt: "Stored thread",
        status: { kind: "exited", exitCode: 0 },
        startedAtEpochMs: 1_000,
        endedAtEpochMs: 2_000,
        events: [],
        eventsTruncated: false,
        lastStatusSequence: 1,
        lastOutputSequence: 0,
      },
    ],
    turnsTruncated: false,
  };
}

function renderThreads(overrides: Partial<Environment> = {}) {
  const environment: Environment = {
    generation: 1,
    agentModeActive: true,
    worktrees: [],
    storedThreads: [],
    ...overrides,
  };
  const startedRequests: StartAgentTaskRequest[] = [];
  let statusHandler: ((event: AgentTaskStatusEvent) => void) | null = null;
  let entropy = 0;

  const agent = {
    startAgentTask: vi.fn(async (payload: StartAgentTaskRequest) => {
      startedRequests.push(payload);
      return { taskId: payload.taskId };
    }),
    acknowledgeAgentTaskStart: vi.fn(async () => undefined),
    stopAgentTask: vi.fn(async () => undefined),
    stopAgentTasksForRoot: vi.fn(async () => undefined),
    subscribeAgentTaskStatus: vi.fn(async (handler: (event: AgentTaskStatusEvent) => void) => {
      statusHandler = handler;
      return () => undefined;
    }),
    subscribeAgentTaskOutput: vi.fn(async (_handler: (event: AgentTaskOutputEvent) => void) => {
      return () => undefined;
    }),
  };
  const worktree = {
    listWorktrees: vi.fn(async () => environment.worktrees),
    addAgentWorktree: vi.fn(async (repositoryRoot: string, threadId: string) => ({
      worktreePath: `${repositoryRoot}/.worktrees/${threadId}`,
      branch: `agent/${threadId}`,
      trusted: true,
    })),
    removeWorktree: vi.fn(async () => undefined),
    pruneWorktrees: vi.fn(async () => []),
  };
  const store = {
    loadAgentThreads: vi.fn(async () => ({
      threads: environment.storedThreads,
      unreadable: [],
      evicted: 0,
    })),
    saveAgentThread: vi.fn(async () => undefined),
    deleteAgentThread: vi.fn(async () => undefined),
  };
  const git = {
    getStatus: vi.fn(async (rootPath: string): Promise<GitStatus> => ({
      branch: "main",
      changes: [],
      isRepository: true,
      rootPath,
    })),
    getDiff: vi.fn(async () => Promise.reject(new Error("diff not stubbed"))),
  };
  const reportError = vi.fn();
  const openAgentSettings = vi.fn();

  const project = (): AgentProjectDescriptor => ({
    rootKey: ROOT,
    rootPath: ROOT,
    ownerId: OWNER,
    label: "app",
    generation: environment.generation,
    trust: "trusted",
    origin: "active-tab",
    repositories: [
      { mapping: { rootRelativePath: "" }, repositoryRoot: ROOT, repositoryRelativePath: "" },
    ],
    isolationPolicy: "auto",
    leaseToken: 1,
  });

  let current: AgentThreadsSurface | null = null;

  function Harness() {
    const dependencies: AgentThreadsDependencies = {
      agentTaskGateway: agent as unknown as AgentTaskGateway,
      agentThreadStoreGateway: store as unknown as AgentThreadStoreGateway,
      gitWorktreeGateway: worktree as unknown as GitWorktreeGateway,
      gitGateway: git,
      prompter: { confirm: () => true, prompt: () => null },
      projects: [project()],
      agentModeActive: environment.agentModeActive,
      getAgentCliPath: () => CLI_PATH,
      getAgentCliKind: () => "claudeCode",
      getMaxConcurrentAgentTasks: () => 4,
      getRepositoryStatus: () => ({ known: true, dirty: false }),
      getDirtyEditorDocumentCount: () => 0,
      reportError,
      openAgentSettings,
      now: () => 1_700_000_000_000 + entropy,
      createEntropyHex4: () => {
        entropy += 1;
        return entropy.toString(16).padStart(4, "0");
      },
    };
    current = useAgentThreads(dependencies);
    return null;
  }

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(Harness)));

  return {
    agent,
    store,
    startedRequests,
    hook(): AgentThreadsSurface {
      expect(current).not.toBeNull();
      return current as AgentThreadsSurface;
    },
    emitStatus(threadId: string, sequence: number, status: AgentTaskStatus): void {
      expect(statusHandler).not.toBeNull();
      const view = (current as AgentThreadsSurface).threads.find(
        (candidate) => candidate.thread.threadId === threadId,
      );
      const turnId = view?.thread.turns[view.thread.turns.length - 1]?.turnId ?? "";
      statusHandler?.({
        taskId: turnId,
        workspaceId: OWNER,
        repositoryRoot: ROOT,
        isolation: "worktree",
        worktreePath: `${ROOT}/.worktrees/${threadId}`,
        sequence,
        status,
      });
    },
    unmount(): void {
      act(() => root.unmount());
      host.remove();
    },
  };
}
