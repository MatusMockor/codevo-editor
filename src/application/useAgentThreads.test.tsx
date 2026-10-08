// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { agentThreadNotificationState } from "../domain/agentNotification";
import { agentRootOwnerId } from "../domain/agentProject";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import type {
  AgentCliKind,
  AgentTaskGateway,
  AgentTaskOutputEvent,
  AgentTaskStatus,
  AgentTaskStatusEvent,
  StartAgentTaskRequest,
} from "../domain/agentTask";
import { agentSessionBackgroundIsLive } from "../domain/agentSessionBackground";
import { parseAgentThread, serializeAgentThread, type AgentThread } from "../domain/agentThread";
import type {
  AgentBackgroundTaskStopOutcome,
  AgentSessionBackgroundTasksEvent,
  AgentSessionBackgroundTurnEvent,
  AgentSessionEndedEvent,
  AgentThreadSessionGateway,
} from "../domain/agentThreadSession";
import type { ExternalSessionImportGateway } from "../domain/externalSessionImport";
import type { GitStatus } from "../domain/git";
import type { GitIntegrationOutcome, GitShipStatus } from "../domain/gitIntegration";
import type { GitWorktreeDescriptor, GitWorktreeGateway } from "../domain/gitWorktree";
import { waitForReact } from "../test/reactTestLifecycle";
import type {
  AgentSessionEndResult,
  AgentSessionTaskStopResult,
  AgentThreadStartRequest,
  AgentThreadStoreGateway,
  AgentThreadsSurface,
  ExternalSessionImportRequest,
  ExternalSessionGateway,
  SaveAgentThreadRequest,
} from "./agentThreadPorts";
import {
  IMPORT_DUPLICATE_NOTICE,
  IMPORT_INVALID_SESSION_NOTICE,
  IMPORT_PROJECT_UNAVAILABLE_NOTICE,
  IMPORT_PROVIDER_MISMATCH_NOTICE,
  IMPORT_STORE_NOT_READY_NOTICE,
  useAgentThreads,
  type AgentThreadsDependencies,
  type AgentThreadsHookSurface,
} from "./useAgentThreads";
import type { AgentLaunchOptions } from "../domain/agentLaunch";
import type { AgentQuestionGateway } from "./agentQuestionPorts";
import type { AgentQuestionRequest } from "../domain/agentQuestion";

const ROOT = "/workspace/app";
const OWNER = "workspace-a";
const PERSISTENT_OWNER = agentRootOwnerId(ROOT);
const CLI_VERSION = "1.4.2";

interface Environment {
  generation: number;
  rootKey: string;
  ownerId: string;
  agentModeActive: boolean;
  worktrees: ReadonlyArray<GitWorktreeDescriptor>;
  storedThreads: ReadonlyArray<AgentThread>;
  shipStatus: GitShipStatus;
  withEditor: boolean;
  cliVersion: string | null;
  cliKind: AgentCliKind;
  repositoryRoots: ReadonlyArray<string>;
  externalSessionGateway?: ExternalSessionGateway;
  agentQuestionGateway?: AgentQuestionGateway;
  externalSessionImportGateway?: ExternalSessionImportGateway;
  agentThreadSessionGateway?: AgentThreadSessionGateway;
  onProviderTurnCompleted?: (provider: AgentCliKind) => void;
  durableHistory?: boolean;
}

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function shipStatus(): GitShipStatus {
  return {
    worktree: { branch: "agent/x", head: SHA_A, dirty: false, changeCount: 1 },
    primary: { branch: "main", head: SHA_B, dirty: false },
    relation: { aheadOfPrimary: 1, behindPrimary: 0, fastForwardable: true },
    remote: null,
  };
}

function gitStatusOf(rootPath: string, changeCount: number): GitStatus {
  return {
    branch: "main",
    changes: Array.from({ length: changeCount }, (_unused, index) => ({
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: `${rootPath}/src/file-${index}.ts`,
      relativePath: `src/file-${index}.ts`,
      status: "modified" as const,
    })),
    isRepository: true,
    rootPath,
  };
}

describe("useAgentThreads facade", () => {
  it("keeps immediate steering until the exact running task's pending question is answered", async () => {
    const list = vi.fn<AgentQuestionGateway["list"]>();
    const harness = renderThreads({ agentQuestionGateway: { list, answer: vi.fn() } });
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());
    const threadId = (await act(() => harness.hook().startThread(startRequest())))!.threadId;
    act(() => harness.emitStatus(threadId, 1, { kind: "running" }));
    const question: AgentQuestionRequest = {
      id: "question",
      taskId: harness.turnIdOf(threadId),
      provider: "claudeCode",
      status: "pending",
      questions: [
        {
          id: "q",
          header: "Choose",
          prompt: "Which?",
          multiple: false,
          allowCustom: true,
          options: [{ id: "a", label: "A", description: "" }],
        },
      ],
    };
    list.mockResolvedValue([question]);
    const request = { threadId, prompt: "Use the selected option", delivery: "immediate" as const };
    expect(await act(() => harness.hook().steer(request))).toBe("kept");
    expect(harness.agent.steerAgentTask).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledWith({
      kind: "local",
      workspaceId: OWNER,
      repositoryRoot: ROOT,
      taskId: harness.turnIdOf(threadId),
    });
    list.mockResolvedValue([]);
    expect(await act(() => harness.hook().steer(request))).toBe("sent");
    expect(harness.agent.steerAgentTask).toHaveBeenCalledTimes(1);
    harness.unmount();
  });
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

  it("exposes the per-draft dispatch keys while a new thread is still starting", async () => {
    const harness = renderThreads();
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    harness.agent.startAgentTask.mockImplementationOnce(async (payload: StartAgentTaskRequest) => {
      harness.startedRequests.push(payload);
      await gate;
      return { taskId: payload.taskId };
    });
    expect(harness.hook().dispatchingKeys?.size).toBe(0);

    let started!: ReturnType<AgentThreadsHookSurface["startThread"]>;
    await act(async () => {
      started = harness.hook().startThread(startRequest());
      await vi.waitFor(() => expect(harness.startedRequests).toHaveLength(1));
    });
    expect(harness.hook().dispatchingKeys).toEqual(new Set([`new:${ROOT}`]));

    await act(async () => {
      release();
      await started;
    });
    expect(harness.hook().dispatchingKeys?.size).toBe(0);
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
    expect(harness.hook().threads[0]?.worktreeMissing).toBe(false);
    expect(harness.hook().liveTaskCount).toBe(1);
    expect(harness.startedRequests[0]?.providerGeneration).toBe(1);
    expect(harness.hook().hasLiveTasksForOwner(OWNER)).toBe(true);
    expect(harness.hook().isolationPreview(ROOT).inPlaceGuard).toEqual({ kind: "safe" });
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

  it("shows why a turn ended when project trust was revoked and restarts nothing from its queue", async () => {
    const trustRevoked =
      "This turn was stopped because trust in its project was revoked. Trust the project again to continue.";
    const harness = renderThreads();
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());
    const threadId = (await act(() => harness.hook().startThread(startRequest())))!.threadId;
    act(() => harness.emitStatus(threadId, 1, { kind: "running" }));
    const queued = { threadId, prompt: "Then run the tests", delivery: "queued" as const };
    expect(await act(() => harness.hook().steer(queued))).toBe("deferred");

    await act(async () => {
      harness.emitStatus(threadId, 2, { kind: "failed", message: trustRevoked });
    });

    const view = harness.hook().threads[0];
    expect(view?.lifecycle).toBe("settled");
    expect(view?.thread.turns[0]?.status).toEqual({ kind: "failed", message: trustRevoked });
    expect(harness.hook().liveTaskCount).toBe(0);
    const queue = harness.hook().deferredFollowUps.get(threadId) ?? [];
    expect(queue.map((entry) => entry.state)).toEqual(["paused"]);
    expect(harness.startedRequests).toHaveLength(1);
    expect(harness.agent.steerAgentTask).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("starts concurrent local threads in one checkout and isolates their output and status", async () => {
    const harness = renderThreads();
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());
    const request = startRequest({ isolation: "in-place" });
    const first = (await act(() => harness.hook().startThread(request)))!.threadId;
    act(() => harness.emitStatus(first, 1, { kind: "running" }));

    const additional = [
      await act(() => harness.hook().startThread({ ...request, prompt: "Second task" })),
      await act(() => harness.hook().startThread({ ...request, prompt: "Third task" })),
    ];
    expect(additional.every((result) => result !== null)).toBe(true);
    const second = additional[0]!.threadId;
    const third = additional[1]!.threadId;
    expect(new Set([first, second, third]).size).toBe(3);
    expect(harness.hook().liveTaskCount).toBe(3);
    expect(harness.startedRequests).toHaveLength(3);
    for (const started of harness.startedRequests) {
      expect(started).toMatchObject({ repositoryRoot: ROOT, isolation: "in-place" });
    }
    expect(harness.hook().isolationPreview(ROOT).inPlaceGuard).toEqual({ kind: "safe" });

    await act(async () => {
      harness.emitStatus(second, 1, { kind: "running" });
      harness.emitStatus(third, 1, { kind: "running" });
      harness.emitOutput(harness.turnIdOf(second), 1, `${assistantLine("Second task output")}\n`);
      harness.emitStatus(second, 2, { kind: "exited", exitCode: 0 });
    });
    const viewOf = (threadId: string) =>
      harness.hook().threads.find((view) => view.thread.threadId === threadId)!;
    expect(viewOf(second).lifecycle).toBe("settled");
    expect(viewOf(second).thread.turns[0].events).toContainEqual({
      kind: "assistantText",
      text: "Second task output",
    });
    for (const threadId of [first, third]) {
      expect(viewOf(threadId).lifecycle).toBe("running");
      expect(viewOf(threadId).thread.turns[0].events).toEqual([]);
    }
    expect(harness.hook().liveTaskCount).toBe(2);
    harness.unmount();
  });

  it("starts a local thread while an isolated worktree agent is running", async () => {
    const harness = renderThreads();
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());
    const isolated = (await act(() => harness.hook().startThread(startRequest())))!.threadId;
    act(() => harness.emitStatus(isolated, 1, { kind: "running" }));

    const local = await act(() =>
      harness.hook().startThread(startRequest({ isolation: "in-place" })),
    );
    expect(local).not.toBeNull();
    expect(harness.startedRequests).toHaveLength(2);
    expect(harness.startedRequests.map((request) => request.isolation)).toEqual([
      "worktree",
      "in-place",
    ]);
    expect(harness.hook().liveTaskCount).toBe(2);
    expect(harness.hook().notice).toBeNull();
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

function worktreeOf(threadId: string): GitWorktreeDescriptor {
  return {
    worktreePath: `${ROOT}/.worktrees/${threadId}`,
    branch: `agent/${threadId}`,
    head: "abc",
    isPrimary: false,
    locked: false,
    prunable: false,
  };
}

function startRequest(overrides: Partial<AgentThreadStartRequest> = {}): AgentThreadStartRequest {
  return {
    projectRootKey: ROOT,
    repositoryRoot: ROOT,
    prompt: "Fix the failing test",
    isolation: "worktree" as const,
    unsafeInPlaceConfirmationKey: null,
    launch: concreteLaunch("claudeCode"),
    ...overrides,
  };
}

function assistantLine(text: string): string {
  return JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text }] },
  });
}

function storedThread(
  threadId: string,
  turnId: string,
  integration: AgentThread["integration"] = null,
): AgentThread {
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
        launch: null,
        cliVersion: null,
      },
    ],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration,
  };
}

function renderThreads(overrides: Partial<Environment> = {}) {
  const environment: Environment = {
    generation: 1,
    rootKey: ROOT,
    ownerId: OWNER,
    agentModeActive: true,
    worktrees: [],
    storedThreads: [],
    shipStatus: shipStatus(),
    withEditor: true,
    cliVersion: CLI_VERSION,
    cliKind: "claudeCode",
    repositoryRoots: [ROOT],
    ...overrides,
  };
  const startedRequests: StartAgentTaskRequest[] = [];
  let statusHandler: ((event: AgentTaskStatusEvent) => void) | null = null;
  let outputHandler: ((event: AgentTaskOutputEvent) => void) | null = null;
  let entropy = 0;
  const entropyScript: string[] = [];

  const agent = {
    startAgentTask: vi.fn(async (payload: StartAgentTaskRequest) => {
      startedRequests.push(payload);
      return { taskId: payload.taskId };
    }),
    acknowledgeAgentTaskStart: vi.fn(async () => undefined),
    stopAgentTask: vi.fn(async () => undefined),
    stopAgentTasksForRoot: vi.fn(async () => undefined),
    steerAgentTask: vi.fn(async () => ({ kind: "accepted" }) as const),
    closeAgentTaskInput: vi.fn(async () => undefined),
    subscribeAgentTaskStatus: vi.fn(async (handler: (event: AgentTaskStatusEvent) => void) => {
      statusHandler = handler;
      return () => undefined;
    }),
    subscribeAgentTaskOutput: vi.fn(async (handler: (event: AgentTaskOutputEvent) => void) => {
      outputHandler = handler;
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
  const readAgentHistoryTurns = vi.fn(async () => ({
    turns: [],
    hasEarlier: false,
    beforeTurnId: null,
    revision: 1,
  }));
  const findAgentHistoryImport = vi.fn<
    NonNullable<AgentThreadStoreGateway["findAgentHistoryImport"]>
  >(async () => null);
  const store = {
    ...(environment.durableHistory ? { readAgentHistoryTurns, findAgentHistoryImport } : {}),
    loadAgentThreads: vi.fn(async () => ({
      threads: environment.storedThreads,
      unreadable: [],
      evicted: 0,
    })),
    saveAgentThread: vi.fn(async (_request: SaveAgentThreadRequest): Promise<void> => undefined),
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
    stageFiles: vi.fn(async (rootPath: string): Promise<GitStatus> => gitStatusOf(rootPath, 0)),
    commit: vi.fn(async (rootPath: string): Promise<GitStatus> => gitStatusOf(rootPath, 0)),
    deleteBranch: vi.fn(async () => undefined),
  };
  const gitIntegration = {
    getShipStatus: vi.fn(async (): Promise<GitShipStatus> => environment.shipStatus),
    pushBranchUpstream: vi.fn(async () => ({
      remote: "origin",
      branch: "agent/x",
      compareUrl: null,
    })),
    integrateWorktreeBranch: vi.fn(async (): Promise<GitIntegrationOutcome> => ({
      kind: "integrated",
      mergeSha: SHA_B,
      intoBranch: "main",
    })),
  };
  const editor = {
    openFile: vi.fn(async () => true),
    openGitChange: vi.fn(async () => undefined),
    openSurface: vi.fn(),
  };
  const reportError = vi.fn();
  const openAgentSettings = vi.fn();

  const project = (): AgentProjectDescriptor => ({
    rootKey: environment.rootKey,
    rootPath: environment.rootKey,
    ownerId: environment.ownerId,
    label: "app",
    generation: environment.generation,
    trust: "trusted",
    origin: "active-tab",
    repositories: environment.repositoryRoots.map((repositoryRoot) => ({
      mapping: { rootRelativePath: "" },
      repositoryRoot,
      repositoryRelativePath: "",
    })),
    isolationPolicy: "auto",
    leaseToken: 1,
  });

  let current: AgentThreadsHookSurface | null = null;

  function Harness() {
    const dependencies: AgentThreadsDependencies = {
      agentTaskGateway: agent as unknown as AgentTaskGateway,
      agentQuestionGateway: environment.agentQuestionGateway,
      agentThreadSessionGateway: environment.agentThreadSessionGateway,
      agentThreadStoreGateway: store as unknown as AgentThreadStoreGateway,
      externalSessionGateway: environment.externalSessionGateway,
      externalSessionImportGateway: environment.externalSessionImportGateway,
      gitWorktreeGateway: worktree as unknown as GitWorktreeGateway,
      gitGateway: git,
      gitIntegrationGateway: gitIntegration,
      externalUrlOpener: null,
      editorBridge: environment.withEditor ? editor : null,
      prompter: { confirm: () => true, prompt: () => null },
      projects: [project()],
      agentModeActive: environment.agentModeActive,
      getAgentCliKind: () => environment.cliKind,
      currentCliVersion: () => environment.cliVersion,
      getAgentProviderAdmissionAuthority: (provider) => ({
        provider,
        revision: 1,
        disposition: { kind: "ready" },
        providerGeneration: 1,
      }),
      getMaxConcurrentAgentTasks: () => 4,
      launchIdentityForProject: () => ({ workspaceId: environment.ownerId, generation: 1 }),
      getRepositoryStatus: () => ({ known: true, dirty: false }),
      getDirtyEditorDocumentCount: () => 0,
      reportError,
      openAgentSettings,
      onProviderTurnCompleted: environment.onProviderTurnCompleted,
      now: () => 1_700_000_000_000 + entropy,
      createEntropyHex4: () => {
        const scripted = entropyScript.shift();
        if (scripted !== undefined) return scripted;
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
  const render = (): void => act(() => root.render(createElement(Harness)));
  render();

  return {
    agent,
    store,
    findAgentHistoryImport,
    git,
    gitIntegration,
    editor,
    startedRequests,
    scriptEntropy(values: ReadonlyArray<string>): void {
      entropyScript.push(...values);
    },
    set(next: Partial<Environment>): void {
      Object.assign(environment, next);
      render();
    },
    turnIdOf(threadId: string): string {
      const view = (current as AgentThreadsSurface).threads.find(
        (candidate) => candidate.thread.threadId === threadId,
      );
      return view?.thread.turns[view.thread.turns.length - 1]?.turnId ?? "";
    },
    emitOutput(turnId: string, sequence: number, chunk: string): void {
      expect(outputHandler).not.toBeNull();
      outputHandler?.({ taskId: turnId, sequence, stream: "stdout", chunk, truncated: false });
    },
    hook(): AgentThreadsHookSurface {
      expect(current).not.toBeNull();
      return current as AgentThreadsHookSurface;
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
        isolation: view!.thread.target.isolation,
        worktreePath: view!.thread.target.worktreePath,
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

describe("useAgentThreads Claude session lifecycle", () => {
  function sessionGateway() {
    return {
      listAgentSessionBackgrounds: vi.fn(async () => []),
      interruptAgentTask: vi.fn(async () => ({ kind: "unsupported" }) as const),
      inspectAgentThreadSession: vi.fn(async () => ({ kind: "none" }) as const),
      endAgentThreadSession: vi.fn(async () => true),
      stopAgentBackgroundTask: vi.fn(async () => ({ kind: "noSession" }) as const),
      subscribeAgentSessionEnded: vi.fn(async () => () => undefined),
      subscribeAgentSessionBackgroundTurn: vi.fn(async () => () => undefined),
      subscribeAgentSessionBackgroundTasks: vi.fn(async () => () => undefined),
    } satisfies AgentThreadSessionGateway;
  }

  it.each([
    [1, 0],
    [0, 1],
  ])(
    "counts a provider turn as completed only for a clean exit (exit code %i)",
    async (exitCode, completions) => {
      const onProviderTurnCompleted = vi.fn();
      const harness = renderThreads({ onProviderTurnCompleted });
      await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());
      const threadId =
        (await act(() => harness.hook().startThread(startRequest())))?.threadId ?? "";

      await act(async () => {
        harness.emitStatus(threadId, 1, { kind: "exited", exitCode });
      });

      expect(harness.hook().threads[0]?.lifecycle).toBe("settled");
      expect(onProviderTurnCompleted).toHaveBeenCalledTimes(completions);
      if (completions > 0) expect(onProviderTurnCompleted).toHaveBeenCalledWith("claudeCode");
      harness.unmount();
    },
  );

  it("asks before a follow-up restarts a Claude session with background work and starts no turn", async () => {
    const session = {
      ...sessionGateway(),
      inspectAgentThreadSession: vi.fn(
        async () => ({ kind: "restart", backgroundTasks: true }) as const,
      ),
    } satisfies AgentThreadSessionGateway;
    const harness = renderThreads({ agentThreadSessionGateway: session });
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());
    const threadId = (await act(() => harness.hook().startThread(startRequest())))?.threadId ?? "";
    harness.set({ worktrees: [worktreeOf(threadId)] });
    await act(async () => {
      harness.emitStatus(threadId, 1, { kind: "exited", exitCode: 0 });
    });

    const sent = await act(() =>
      harness.hook().sendFollowUp({
        threadId,
        prompt: "/compact",
        launch: concreteLaunch("claudeCode"),
      }),
    );

    expect(sent).toBe(false);
    expect(session.inspectAgentThreadSession).toHaveBeenCalledTimes(1);
    expect(harness.startedRequests).toHaveLength(1);
    expect(harness.hook().threads[0]?.thread.turns).toHaveLength(1);
    expect(harness.hook().followUpNeedsSessionRestart?.(threadId)).toBe(true);
    expect(harness.hook().notice?.action).toMatchObject({ kind: "restartFollowUp", threadId });
    harness.unmount();
  });

  it("ends the local Claude session once when its settled thread is archived or removed", async () => {
    const session = sessionGateway();
    const harness = renderThreads({ agentThreadSessionGateway: session });
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());
    const threadId = (await act(() => harness.hook().startThread(startRequest())))?.threadId ?? "";

    act(() => {
      harness.hook().archive(threadId);
      harness.hook().remove(threadId);
    });
    expect(session.endAgentThreadSession).not.toHaveBeenCalled();

    await act(async () => {
      harness.emitStatus(threadId, 1, { kind: "exited", exitCode: 0 });
    });
    await act(async () => {
      harness.hook().archive(threadId);
      harness.hook().archive(threadId);
    });
    expect(session.endAgentThreadSession).toHaveBeenCalledTimes(1);
    expect(session.endAgentThreadSession).toHaveBeenLastCalledWith({
      workspaceId: OWNER,
      threadId,
    });

    await act(async () => {
      harness.hook().remove(threadId);
    });
    await waitForReact(() => expect(harness.hook().threads).toHaveLength(0));
    expect(session.endAgentThreadSession).toHaveBeenCalledTimes(2);
    expect(session.endAgentThreadSession).toHaveBeenLastCalledWith({
      workspaceId: OWNER,
      threadId,
    });
    harness.unmount();
  });

  it("shows a resumed agent's live session level on the settled thread until its session ends", async () => {
    let level: ((event: AgentSessionBackgroundTasksEvent) => void) | null = null;
    const ended: Array<(event: AgentSessionEndedEvent) => void> = [];
    const session = {
      ...sessionGateway(),
      subscribeAgentSessionEnded: vi.fn(
        async (handler: (event: AgentSessionEndedEvent) => void) => {
          ended.push(handler);
          return () => undefined;
        },
      ),
      subscribeAgentSessionBackgroundTasks: vi.fn(
        async (handler: (event: AgentSessionBackgroundTasksEvent) => void) => {
          level = handler;
          return () => undefined;
        },
      ),
    } satisfies AgentThreadSessionGateway;
    const harness = renderThreads({ agentThreadSessionGateway: session });
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());
    const threadId = (await act(() => harness.hook().startThread(startRequest())))?.threadId ?? "";
    harness.set({ worktrees: [worktreeOf(threadId)] });
    await act(async () => {
      harness.emitStatus(threadId, 1, { kind: "exited", exitCode: 0 });
    });
    await waitForReact(() => expect(level).not.toBeNull());
    const resumed: AgentSessionBackgroundTasksEvent = {
      workspaceId: OWNER,
      threadId,
      total: 1,
      agents: 1,
      tasks: [
        {
          taskId: "a4b355dcf6056a875",
          taskType: "agent",
          description: "Live Codex model catalog like Claude",
        },
      ],
      reply: "none",
    };
    const foreign = { workspaceId: "agent-root:/elsewhere", threadId };
    act(() => level?.({ ...resumed, ...foreign }));
    expect(harness.hook().threads[0]?.sessionBackground).toBeUndefined();
    act(() => level?.(resumed));
    const view = harness.hook().threads[0];
    expect(view?.sessionBackground).toMatchObject({ ownerId: OWNER, agents: 1, total: 1 });
    expect(view?.sessionBackground?.tasks).toEqual(resumed.tasks);
    const end = (session: typeof foreign) =>
      act(() =>
        ended.forEach((handler) =>
          handler({ ...session, reason: "stopped", backgroundTasksLive: true }),
        ),
      );
    end(foreign);
    expect(harness.hook().threads[0]?.sessionBackground).toBe(view?.sessionBackground);
    end({ workspaceId: OWNER, threadId });
    expect(harness.hook().threads[0]?.sessionBackground).toBeUndefined();
    harness.unmount();
  });

  it("stops a native background task left live after an interrupted turn through the exact owner's session", async () => {
    let level: ((event: AgentSessionBackgroundTasksEvent) => void) | null = null;
    const stopAgentBackgroundTask = vi.fn<AgentThreadSessionGateway["stopAgentBackgroundTask"]>(
      async () => ({ kind: "stopping" }),
    );
    const session = {
      ...sessionGateway(),
      stopAgentBackgroundTask,
      subscribeAgentSessionBackgroundTasks: vi.fn(
        async (handler: (event: AgentSessionBackgroundTasksEvent) => void) => {
          level = handler;
          return () => undefined;
        },
      ),
    } satisfies AgentThreadSessionGateway;
    const harness = renderThreads({ agentThreadSessionGateway: session });
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());
    const threadId = (await act(() => harness.hook().startThread(startRequest())))?.threadId ?? "";
    harness.set({ worktrees: [worktreeOf(threadId)] });
    await act(async () => {
      harness.emitStatus(threadId, 1, { kind: "exited", exitCode: 130 });
    });
    await waitForReact(() => expect(level).not.toBeNull());
    expect(harness.hook().threads[0]?.lifecycle).not.toBe("running");
    const watch: AgentSessionBackgroundTasksEvent = {
      workspaceId: OWNER,
      threadId,
      total: 1,
      agents: 0,
      tasks: [
        { taskId: "b8kzpiexm", taskType: "shell", description: "Watch beta.75 release workflow" },
      ],
      reply: "none",
    };
    act(() => level?.(watch));
    expect(harness.hook().threads[0]?.sessionBackground?.tasks).toEqual(watch.tasks);

    await act(async () => {
      await expect(
        harness.hook().stopSessionBackgroundTask?.(threadId, "b8kzpiexm"),
      ).resolves.toEqual({ kind: "stopping" });
    });
    expect(stopAgentBackgroundTask).toHaveBeenCalledTimes(1);
    expect(stopAgentBackgroundTask).toHaveBeenCalledWith({
      workspaceId: OWNER,
      threadId,
      taskId: "b8kzpiexm",
    });
    expect(harness.hook().threads[0]?.sessionBackground?.tasks).toEqual(watch.tasks);

    act(() => level?.({ ...watch, workspaceId: "agent-root:/elsewhere", total: 0, tasks: [] }));
    expect(harness.hook().threads[0]?.sessionBackground?.tasks).toEqual(watch.tasks);
    act(() => level?.({ ...watch, total: 0, tasks: [] }));
    expect(harness.hook().threads[0]?.sessionBackground).toBeUndefined();
    harness.unmount();
  });

  it("holds the settled turn's completion from the agent drain until the follow-up reply is recorded", async () => {
    let level: ((event: AgentSessionBackgroundTasksEvent) => void) | null = null;
    let background: ((event: AgentSessionBackgroundTurnEvent) => void) | null = null;
    const session = {
      ...sessionGateway(),
      subscribeAgentSessionBackgroundTurn: vi.fn(
        async (handler: (event: AgentSessionBackgroundTurnEvent) => void) => {
          background = handler;
          return () => undefined;
        },
      ),
      subscribeAgentSessionBackgroundTasks: vi.fn(
        async (handler: (event: AgentSessionBackgroundTasksEvent) => void) => {
          level = handler;
          return () => undefined;
        },
      ),
    } satisfies AgentThreadSessionGateway;
    const harness = renderThreads({ agentThreadSessionGateway: session });
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());
    const threadId = (await act(() => harness.hook().startThread(startRequest())))?.threadId ?? "";
    harness.set({ worktrees: [worktreeOf(threadId)] });
    await waitForReact(() => {
      expect(level).not.toBeNull();
      expect(background).not.toBeNull();
    });
    expect(session.subscribeAgentSessionBackgroundTurn).toHaveBeenCalledTimes(1);
    const working: AgentSessionBackgroundTasksEvent = {
      workspaceId: OWNER,
      threadId,
      total: 1,
      agents: 1,
      tasks: [{ taskId: "a4b355dcf6056a875", taskType: "agent" }],
      reply: "none",
    };
    const drained: AgentSessionBackgroundTasksEvent = {
      ...working,
      total: 0,
      agents: 0,
      tasks: [],
    };
    const observed = () => {
      const view = harness.hook().threads[0];
      if (view === undefined) return null;
      return {
        reply: view.sessionBackground?.reply.kind ?? null,
        notification: agentThreadNotificationState(
          view.thread,
          null,
          agentSessionBackgroundIsLive(view.sessionBackground) ? "live" : "idle",
        ),
      };
    };

    act(() => level?.(working));
    await act(async () => {
      harness.emitStatus(threadId, 1, { kind: "exited", exitCode: 0 });
    });
    const originalTurnId = harness.hook().threads[0]?.thread.turns[0]?.turnId ?? "";
    const original = { kind: "completed", key: `${originalTurnId}:completed` };
    const steps = [observed()];
    act(() => level?.({ ...drained, workspaceId: "agent-root:/elsewhere" }));
    steps.push(observed());
    act(() => level?.({ ...drained, reply: "expected" }));
    steps.push(observed());
    act(() => level?.({ ...drained, reply: "expected" }));
    steps.push(observed());
    act(() => level?.({ ...drained, reply: "inProgress" }));
    steps.push(observed());
    expect(steps).toEqual([
      { reply: "none", notification: { kind: "held", signal: original } },
      { reply: "none", notification: { kind: "held", signal: original } },
      { reply: "expected", notification: { kind: "held", signal: original } },
      { reply: "expected", notification: { kind: "held", signal: original } },
      { reply: "inProgress", notification: { kind: "held", signal: original } },
    ]);

    act(() =>
      background?.({
        workspaceId: OWNER,
        threadId,
        output: `${assistantLine("background-finished")}\n`,
        truncated: false,
        complete: true,
      }),
    );
    const turns = harness.hook().threads[0]?.thread.turns ?? [];
    expect(turns.map((turn) => turn.origin)).toEqual([undefined, "background"]);
    const followUp = { kind: "completed", key: `${turns[1]?.turnId ?? ""}:completed` };
    expect(followUp.key).not.toBe(original.key);
    expect(observed()).toEqual({
      reply: "inProgress",
      notification: { kind: "held", signal: followUp },
    });
    act(() => level?.(drained));
    expect(harness.hook().threads[0]?.sessionBackground).toBeUndefined();
    expect(observed()).toEqual({
      reply: null,
      notification: { kind: "signal", signal: followUp },
    });
    harness.unmount();
  });

  it("holds the settled turn's completion while a background shell runs and through its drain until the follow-up reply is recorded", async () => {
    let level: ((event: AgentSessionBackgroundTasksEvent) => void) | null = null;
    let background: ((event: AgentSessionBackgroundTurnEvent) => void) | null = null;
    const session = {
      ...sessionGateway(),
      subscribeAgentSessionBackgroundTurn: vi.fn(
        async (handler: (event: AgentSessionBackgroundTurnEvent) => void) => {
          background = handler;
          return () => undefined;
        },
      ),
      subscribeAgentSessionBackgroundTasks: vi.fn(
        async (handler: (event: AgentSessionBackgroundTasksEvent) => void) => {
          level = handler;
          return () => undefined;
        },
      ),
    } satisfies AgentThreadSessionGateway;
    const harness = renderThreads({ agentThreadSessionGateway: session });
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());
    const threadId = (await act(() => harness.hook().startThread(startRequest())))?.threadId ?? "";
    harness.set({ worktrees: [worktreeOf(threadId)] });
    await waitForReact(() => {
      expect(level).not.toBeNull();
      expect(background).not.toBeNull();
    });
    const shell: AgentSessionBackgroundTasksEvent = {
      workspaceId: OWNER,
      threadId,
      total: 1,
      agents: 0,
      tasks: [{ taskId: "b7sh0uutx", taskType: "shell" }],
      reply: "none",
    };
    const drained: AgentSessionBackgroundTasksEvent = { ...shell, total: 0, tasks: [] };
    const observed = () => {
      const view = harness.hook().threads[0];
      if (view === undefined) return null;
      const state = agentThreadNotificationState(
        view.thread,
        null,
        agentSessionBackgroundIsLive(view.sessionBackground) ? "live" : "idle",
      );
      return [view.sessionBackground?.reply.kind ?? null, state.kind];
    };

    act(() => level?.(shell));
    await act(async () => {
      harness.emitStatus(threadId, 1, { kind: "exited", exitCode: 0 });
    });
    const steps = [observed()];
    act(() => level?.({ ...drained, reply: "expected" }));
    steps.push(observed());
    act(() => level?.({ ...drained, reply: "inProgress" }));
    steps.push(observed());
    act(() =>
      background?.({
        workspaceId: OWNER,
        threadId,
        output: `${assistantLine("background-finished")}\n`,
        truncated: false,
        complete: true,
      }),
    );
    steps.push(observed());
    expect(steps).toEqual([
      ["none", "held"],
      ["expected", "held"],
      ["inProgress", "held"],
      ["inProgress", "held"],
    ]);

    act(() => level?.(drained));
    const turns = harness.hook().threads[0]?.thread.turns ?? [];
    expect(turns.map((turn) => turn.origin)).toEqual([undefined, "background"]);
    expect(observed()).toEqual([null, "signal"]);
    harness.unmount();
  });

  it("clears a stranded session level only when ending or stopping finds no session for that owner and thread", async () => {
    let level: ((event: AgentSessionBackgroundTasksEvent) => void) | null = null;
    const endAgentThreadSession = vi.fn<AgentThreadSessionGateway["endAgentThreadSession"]>();
    const stopAgentBackgroundTask = vi.fn<AgentThreadSessionGateway["stopAgentBackgroundTask"]>();
    const session = {
      ...sessionGateway(),
      endAgentThreadSession,
      stopAgentBackgroundTask,
      subscribeAgentSessionBackgroundTasks: vi.fn(
        async (handler: (event: AgentSessionBackgroundTasksEvent) => void) => {
          level = handler;
          return () => undefined;
        },
      ),
    } satisfies AgentThreadSessionGateway;
    const harness = renderThreads({ agentThreadSessionGateway: session });
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());
    const threadId = (await act(() => harness.hook().startThread(startRequest())))?.threadId ?? "";
    harness.set({ worktrees: [worktreeOf(threadId)] });
    await act(async () => {
      harness.emitStatus(threadId, 1, { kind: "exited", exitCode: 0 });
    });
    await waitForReact(() => expect(level).not.toBeNull());
    const stranded: AgentSessionBackgroundTasksEvent = {
      workspaceId: OWNER,
      threadId,
      total: 1,
      agents: 0,
      tasks: [{ taskId: "b7sh0uutx", taskType: "shell" }],
      reply: "none",
    };
    const retained = () => harness.hook().threads[0]?.sessionBackground?.tasks;
    const end = async () => {
      let result: AgentSessionEndResult | undefined;
      await act(async () => {
        result = await harness.hook().endSession?.(threadId);
      });
      return result;
    };
    const stop = async () => {
      let result: AgentSessionTaskStopResult | undefined;
      await act(async () => {
        result = await harness.hook().stopSessionBackgroundTask?.(threadId, "b7sh0uutx");
      });
      return result;
    };
    act(() => level?.(stranded));

    endAgentThreadSession.mockRejectedValueOnce(new Error("ipc unavailable"));
    expect(await end()).toBe("failed");
    expect(retained()).toEqual(stranded.tasks);
    endAgentThreadSession.mockResolvedValueOnce(true);
    expect(await end()).toBe("ended");
    expect(retained()).toEqual(stranded.tasks);
    stopAgentBackgroundTask.mockRejectedValueOnce(new Error("ipc unavailable"));
    expect(await stop()).toEqual({ kind: "unavailable" });
    expect(retained()).toEqual(stranded.tasks);
    for (const outcome of [
      { kind: "stopping" },
      { kind: "refused", reason: "Claude refused to stop this task." },
      { kind: "unconfirmed" },
      { kind: "notLive" },
      { kind: "unavailable" },
    ] as const) {
      stopAgentBackgroundTask.mockResolvedValueOnce(outcome);
      expect(await stop()).toEqual(outcome);
      expect(retained()).toEqual(stranded.tasks);
    }

    stopAgentBackgroundTask.mockResolvedValueOnce({ kind: "noSession" });
    expect(await stop()).toEqual({ kind: "noSession" });
    expect(harness.hook().threads[0]?.sessionBackground).toBeUndefined();
    expect(stopAgentBackgroundTask).toHaveBeenLastCalledWith({
      workspaceId: OWNER,
      threadId,
      taskId: "b7sh0uutx",
    });

    act(() => level?.(stranded));
    expect(retained()).toEqual(stranded.tasks);
    endAgentThreadSession.mockResolvedValueOnce(false);
    expect(await end()).toBe("none");
    expect(harness.hook().threads[0]?.sessionBackground).toBeUndefined();
    expect(endAgentThreadSession).toHaveBeenLastCalledWith({ workspaceId: OWNER, threadId });
    harness.unmount();
  });

  function deferred<Answer>() {
    let resolve!: (value: Answer) => void;
    const promise = new Promise<Answer>((settle) => {
      resolve = settle;
    });
    return { promise, resolve };
  }

  async function strandedSession() {
    let level: ((event: AgentSessionBackgroundTasksEvent) => void) | null = null;
    const endAgentThreadSession = vi.fn<AgentThreadSessionGateway["endAgentThreadSession"]>();
    const stopAgentBackgroundTask = vi.fn<AgentThreadSessionGateway["stopAgentBackgroundTask"]>();
    const session = {
      ...sessionGateway(),
      endAgentThreadSession,
      stopAgentBackgroundTask,
      subscribeAgentSessionBackgroundTasks: vi.fn(
        async (handler: (event: AgentSessionBackgroundTasksEvent) => void) => {
          level = handler;
          return () => undefined;
        },
      ),
    } satisfies AgentThreadSessionGateway;
    const harness = renderThreads({ agentThreadSessionGateway: session });
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());
    const threadId = (await act(() => harness.hook().startThread(startRequest())))?.threadId ?? "";
    harness.set({ worktrees: [worktreeOf(threadId)] });
    await act(async () => {
      harness.emitStatus(threadId, 1, { kind: "exited", exitCode: 0 });
    });
    await waitForReact(() => expect(level).not.toBeNull());
    const shell = (taskId: string): AgentSessionBackgroundTasksEvent => ({
      workspaceId: OWNER,
      threadId,
      total: 1,
      agents: 0,
      tasks: [{ taskId, taskType: "shell" }],
      reply: "none",
    });
    const observed = () => {
      const view = harness
        .hook()
        .threads.find((candidate) => candidate.thread.threadId === threadId);
      if (view === undefined) return null;
      const live = agentSessionBackgroundIsLive(view.sessionBackground);
      return {
        tasks: view.sessionBackground?.tasks.map((task) => task.taskId) ?? null,
        live,
        completion: agentThreadNotificationState(view.thread, null, live ? "live" : "idle").kind,
      };
    };
    const answerLate = async <Answer,>(
      ask: () => Promise<unknown> | undefined,
      answer: { resolve(value: Answer): void },
      value: Answer,
      meanwhile: () => void,
    ) => {
      let asked: Promise<unknown> | undefined;
      await act(async () => {
        asked = ask();
      });
      meanwhile();
      await act(async () => {
        answer.resolve(value);
        await asked;
      });
    };
    act(() => level?.(shell("b-stranded")));
    return {
      harness,
      threadId,
      endAgentThreadSession,
      stopAgentBackgroundTask,
      observed,
      answerLate,
      publish: (taskId: string) => act(() => level?.(shell(taskId))),
      end: () => harness.hook().endSession?.(threadId),
      stop: () => harness.hook().stopSessionBackgroundTask?.(threadId, "b-stranded"),
    };
  }

  const heldBy = (taskId: string) => ({ tasks: [taskId], live: true, completion: "held" });
  const RELEASED = { tasks: null, live: false, completion: "signal" };

  it("keeps a replacement session's level when a late end-session answer reports the old session missing", async () => {
    const stranded = await strandedSession();
    const answer = deferred<boolean>();
    stranded.endAgentThreadSession.mockReturnValueOnce(answer.promise);

    await stranded.answerLate(stranded.end, answer, false, () => {
      stranded.publish("b-replacement");
      expect(stranded.observed()).toEqual(heldBy("b-replacement"));
    });

    expect(stranded.observed()).toEqual(heldBy("b-replacement"));
    stranded.harness.unmount();
  });

  it("keeps a replacement session's level when a late stop-task answer reports the old session missing", async () => {
    const stranded = await strandedSession();
    const answer = deferred<AgentBackgroundTaskStopOutcome>();
    stranded.stopAgentBackgroundTask.mockReturnValueOnce(answer.promise);

    await stranded.answerLate(stranded.stop, answer, { kind: "noSession" }, () => {
      stranded.publish("b-replacement");
      expect(stranded.observed()).toEqual(heldBy("b-replacement"));
    });

    expect(stranded.observed()).toEqual(heldBy("b-replacement"));
    stranded.harness.unmount();
  });

  it("clears the stranded level on a late missing answer when no level arrived while it was in flight", async () => {
    const stranded = await strandedSession();
    const ended = deferred<boolean>();
    stranded.endAgentThreadSession.mockReturnValueOnce(ended.promise);
    await stranded.answerLate(stranded.end, ended, false, () =>
      expect(stranded.observed()).toEqual(heldBy("b-stranded")),
    );
    expect(stranded.observed()).toEqual(RELEASED);

    stranded.publish("b-stranded");
    const stopped = deferred<AgentBackgroundTaskStopOutcome>();
    stranded.stopAgentBackgroundTask.mockReturnValueOnce(stopped.promise);
    await stranded.answerLate(stranded.stop, stopped, { kind: "noSession" }, () =>
      expect(stranded.observed()).toEqual(heldBy("b-stranded")),
    );
    expect(stranded.observed()).toEqual(RELEASED);
    stranded.harness.unmount();
  });

  it("lists the live session levels when it mounts and says when that recovery has settled", async () => {
    const listed = deferred<ReadonlyArray<AgentSessionBackgroundTasksEvent>>();
    const session = {
      ...sessionGateway(),
      listAgentSessionBackgrounds: vi.fn(() => listed.promise),
    } satisfies AgentThreadSessionGateway;
    const harness = renderThreads({ agentThreadSessionGateway: session });
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());
    const threadId = (await act(() => harness.hook().startThread(startRequest())))?.threadId ?? "";
    harness.set({ worktrees: [worktreeOf(threadId)] });
    await act(async () => {
      harness.emitStatus(threadId, 1, { kind: "exited", exitCode: 0 });
    });
    expect(session.listAgentSessionBackgrounds).toHaveBeenCalledTimes(1);
    expect(harness.hook().sessionBackgroundsRecovered).toBe(false);
    expect(harness.hook().threads[0]?.sessionBackground).toBeUndefined();

    await act(async () => {
      listed.resolve([
        {
          workspaceId: OWNER,
          threadId,
          total: 1,
          agents: 0,
          tasks: [{ taskId: "b7sh0uutx", taskType: "shell" }],
          reply: "none",
        },
        {
          workspaceId: "agent-root:/elsewhere",
          threadId,
          total: 1,
          agents: 1,
          tasks: [{ taskId: "a4b355dcf6056a875", taskType: "agent" }],
          reply: "none",
        },
      ]);
      await listed.promise;
    });

    expect(harness.hook().sessionBackgroundsRecovered).toBe(true);
    expect(harness.hook().threads[0]?.sessionBackground).toMatchObject({
      ownerId: OWNER,
      total: 1,
      agents: 0,
    });
    harness.unmount();
  });

  it("counts as recovered at once without a session gateway", async () => {
    const harness = renderThreads({});
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());

    expect(harness.hook().sessionBackgroundsRecovered).toBe(true);
    harness.unmount();
  });

  it("never gives a background reply the turn id a pending follow-up already minted", async () => {
    let background: ((event: AgentSessionBackgroundTurnEvent) => void) | null = null;
    const session = {
      ...sessionGateway(),
      subscribeAgentSessionBackgroundTurn: vi.fn(
        async (handler: (event: AgentSessionBackgroundTurnEvent) => void) => {
          background = handler;
          return () => undefined;
        },
      ),
    } satisfies AgentThreadSessionGateway;
    const harness = renderThreads({ agentThreadSessionGateway: session });
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());
    const threadId = (await act(() => harness.hook().startThread(startRequest())))?.threadId ?? "";
    harness.set({ worktrees: [worktreeOf(threadId)] });
    await act(async () => {
      harness.emitStatus(threadId, 1, { kind: "exited", exitCode: 0 });
    });
    await waitForReact(() => expect(background).not.toBeNull());

    harness.scriptEntropy(["0aaa", "0aaa", "0bbb"]);
    let sent!: Promise<boolean>;
    await act(async () => {
      sent = harness.hook().sendFollowUp({
        threadId,
        prompt: "What did the build report?",
        launch: concreteLaunch("claudeCode"),
      });
      background?.({
        workspaceId: OWNER,
        threadId,
        output: `${assistantLine("background-finished")}\n`,
        truncated: false,
        complete: true,
      });
      expect(await sent).toBe(true);
    });

    const turns = harness.hook().threads[0]?.thread.turns ?? [];
    expect(turns.map((turn) => turn.origin)).toEqual([undefined, "background", undefined]);
    expect(new Set(turns.map((turn) => turn.turnId)).size).toBe(3);
    expect(harness.startedRequests[harness.startedRequests.length - 1]?.taskId).toBe(
      turns[2]?.turnId,
    );
    harness.unmount();
  });

  it("records a background reply that survives a reload while dispatched turns keep their launch", async () => {
    let background: ((event: AgentSessionBackgroundTurnEvent) => void) | null = null;
    const session = {
      ...sessionGateway(),
      subscribeAgentSessionBackgroundTurn: vi.fn(
        async (handler: (event: AgentSessionBackgroundTurnEvent) => void) => {
          background = handler;
          return () => undefined;
        },
      ),
    } satisfies AgentThreadSessionGateway;
    const harness = renderThreads({ agentThreadSessionGateway: session });
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());
    const threadId = (await act(() => harness.hook().startThread(startRequest())))?.threadId ?? "";
    harness.set({ worktrees: [worktreeOf(threadId)] });
    await act(async () => {
      harness.emitStatus(threadId, 1, { kind: "exited", exitCode: 0 });
    });
    await waitForReact(() => expect(background).not.toBeNull());

    act(() =>
      background?.({
        workspaceId: OWNER,
        threadId,
        output: `${assistantLine("background-finished")}\n`,
        truncated: false,
        complete: true,
      }),
    );
    const sent = await act(() =>
      harness.hook().sendFollowUp({
        threadId,
        prompt: "What did the build report?",
        launch: concreteLaunch("claudeCode"),
      }),
    );
    expect(sent).toBe(true);
    await act(async () => {
      harness.emitStatus(threadId, 1, { kind: "exited", exitCode: 0 });
    });

    const live = harness.hook().threads[0]?.thread;
    expect(live?.turns.map((turn) => turn.origin)).toEqual([undefined, "background", undefined]);
    await waitForReact(() =>
      expect(
        harness.store.saveAgentThread.mock.calls.some(
          ([request]) => request.thread.turns.length === 3,
        ),
      ).toBe(true),
    );
    for (const [request] of harness.store.saveAgentThread.mock.calls) {
      for (const turn of request.thread.turns) {
        if (turn.origin === "background") continue;
        expect(turn.launch).not.toBeNull();
      }
    }
    const saves = harness.store.saveAgentThread.mock.calls;
    const lastSaved = saves[saves.length - 1]?.[0].thread;
    const wire = JSON.stringify(serializeAgentThread(lastSaved as AgentThread));
    expect(wire).not.toContain('"origin"');
    const reloaded = parseAgentThread(JSON.parse(wire));
    expect(reloaded.turns.map((turn) => turn.origin)).toEqual([undefined, "background", undefined]);
    harness.unmount();
  });

  it("never ends sessions for Codex threads or threads of a foreign owner", async () => {
    const session = sessionGateway();
    const claude = storedThread("agt-stored-0001", "agt-stored-0002");
    const codex: AgentThread = {
      ...storedThread("agt-stored-0003", "agt-stored-0004"),
      provider: { kind: "codex", sessionId: null },
    };
    const harness = renderThreads({
      agentThreadSessionGateway: session,
      storedThreads: [claude, codex],
    });
    await waitForReact(() => expect(harness.hook().threads).toHaveLength(2));

    await act(async () => {
      harness.hook().archive(codex.threadId);
      harness.hook().remove(codex.threadId);
    });
    harness.set({ rootKey: "/workspace/other", ownerId: "workspace-b", generation: 2 });
    await act(async () => {
      harness.hook().archive(claude.threadId);
      harness.hook().remove(claude.threadId);
    });

    expect(session.endAgentThreadSession).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("records an interrupt request on the exact turn before the runtime answers, even when refused", async () => {
    let answer: (outcome: { readonly kind: "unsupported" }) => void = () => undefined;
    const session = {
      ...sessionGateway(),
      interruptAgentTask: vi.fn(
        () =>
          new Promise<{ readonly kind: "unsupported" }>((resolve) => {
            answer = resolve;
          }),
      ),
    } satisfies AgentThreadSessionGateway;
    const harness = renderThreads({ agentThreadSessionGateway: session });
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());
    const threadId = (await act(() => harness.hook().startThread(startRequest())))?.threadId ?? "";
    act(() => harness.emitStatus(threadId, 1, { kind: "running" }));

    let interrupted: Promise<boolean> = Promise.resolve(true);
    act(() => {
      interrupted = harness.hook().interrupt?.(threadId) ?? Promise.resolve(true);
    });
    expect(session.interruptAgentTask).toHaveBeenCalledTimes(1);
    expect(lastTurnOf(harness.hook(), threadId)?.haltRequested).toBe(true);

    await act(async () => answer({ kind: "unsupported" }));
    await expect(interrupted).resolves.toBe(false);
    expect(lastTurnOf(harness.hook(), threadId)?.haltRequested).toBe(true);
    harness.unmount();
  });

  it("records a hard stop request on the exact turn and never carries it to the next turn", async () => {
    let settle: () => void = () => undefined;
    const harness = renderThreads({ agentThreadSessionGateway: sessionGateway() });
    harness.agent.stopAgentTask.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          settle = () => resolve(undefined);
        }),
    );
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());
    const threadId = (await act(() => harness.hook().startThread(startRequest())))?.threadId ?? "";
    harness.set({ worktrees: [worktreeOf(threadId)] });
    act(() => harness.emitStatus(threadId, 1, { kind: "running" }));

    let stopped: Promise<void> = Promise.resolve();
    act(() => {
      stopped = harness.hook().stop(threadId);
    });
    expect(lastTurnOf(harness.hook(), threadId)?.haltRequested).toBe(true);
    await act(async () => settle());
    await act(() => stopped);
    await act(async () => {
      harness.emitStatus(threadId, 2, { kind: "stopped" });
    });

    const sent = await act(() =>
      harness
        .hook()
        .sendFollowUp({ threadId, prompt: "again", launch: concreteLaunch("claudeCode") }),
    );
    expect(sent).toBe(true);
    const turns = harness.hook().threads[0]?.thread.turns ?? [];
    expect(turns.map((turn) => turn.haltRequested)).toEqual([true, undefined]);
    const saves = harness.store.saveAgentThread.mock.calls;
    const lastSaved = saves[saves.length - 1]?.[0].thread;
    expect(JSON.stringify(serializeAgentThread(lastSaved as AgentThread))).not.toContain(
      "haltRequested",
    );
    harness.unmount();
  });
});

function lastTurnOf(hook: AgentThreadsHookSurface, threadId: string) {
  const turns = hook.threads.find((view) => view.thread.threadId === threadId)?.thread.turns ?? [];
  return turns[turns.length - 1];
}

describe("useAgentThreads views and viewed marks", () => {
  it("keeps view identity for untouched threads across a burst of output events", async () => {
    const stored = storedThread("agt-stored-0001", "agt-stored-0002");
    const harness = renderThreads({ storedThreads: [stored] });
    await waitForReact(() => expect(harness.hook().threads).toHaveLength(1));
    const running = (await act(() => harness.hook().startThread(startRequest())))?.threadId ?? "";
    await waitForReact(() => expect(harness.hook().threads).toHaveLength(2));
    const turnId = harness.turnIdOf(running);
    const storedBefore = harness
      .hook()
      .threads.find((view) => view.thread.threadId === stored.threadId);
    const runningBefore = harness.hook().threads.find((view) => view.thread.threadId === running);
    expect(storedBefore).toBeDefined();

    for (let sequence = 1; sequence <= 100; sequence += 1) {
      await act(async () => {
        harness.emitOutput(turnId, sequence, `${assistantLine(`line ${sequence}`)}\n`);
      });
    }
    await waitForReact(() =>
      expect(
        harness.hook().threads.find((view) => view.thread.threadId === running)?.thread.turns[0]
          ?.lastOutputSequence,
      ).toBe(100),
    );

    const storedAfter = harness
      .hook()
      .threads.find((view) => view.thread.threadId === stored.threadId);
    const runningAfter = harness.hook().threads.find((view) => view.thread.threadId === running);
    expect(storedAfter).toBe(storedBefore);
    expect(runningAfter).not.toBe(runningBefore);
    harness.unmount();
  });

  it("marks an unread thread viewed once, ignores repeats, and coalesces the save", async () => {
    const stored = storedThread("agt-stored-0001", "agt-stored-0002");
    const harness = renderThreads({ storedThreads: [stored] });
    await waitForReact(() => expect(harness.hook().threads[0]?.unread).toBe(true));
    harness.store.saveAgentThread.mockClear();

    act(() => harness.hook().markThreadViewed(stored.threadId));
    act(() => harness.hook().markThreadViewed(stored.threadId));
    act(() => harness.hook().markThreadViewed(stored.threadId));
    act(() => harness.hook().markThreadViewed("agt-missing-0000"));

    await waitForReact(() => expect(harness.hook().threads[0]?.unread).toBe(false));
    expect(harness.hook().threads[0]?.thread.viewedAtEpochMs).toBeGreaterThan(2_000);
    await waitForReact(() => expect(harness.store.saveAgentThread).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    });
    expect(harness.store.saveAgentThread).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("ignores a viewed mark while another project owns the tab and honours it after A to B to A", async () => {
    const stored = storedThread("agt-stored-0001", "agt-stored-0002");
    const harness = renderThreads({ storedThreads: [stored] });
    await waitForReact(() => expect(harness.hook().threads[0]?.unread).toBe(true));
    harness.store.saveAgentThread.mockClear();

    harness.set({ rootKey: "/workspace/other", ownerId: "workspace-b", generation: 2 });
    act(() => harness.hook().markThreadViewed(stored.threadId));
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    });
    expect(harness.store.saveAgentThread).not.toHaveBeenCalled();

    harness.set({ rootKey: ROOT, ownerId: OWNER, generation: 3 });
    await waitForReact(() => expect(harness.hook().threads[0]?.unread).toBe(true));
    act(() => harness.hook().markThreadViewed(stored.threadId));
    await waitForReact(() => expect(harness.hook().threads[0]?.unread).toBe(false));
    await waitForReact(() => expect(harness.store.saveAgentThread).toHaveBeenCalledTimes(1));
    expect(harness.hook().lastUsedLaunch(ROOT)).toBeNull();
    harness.unmount();
  });

  it("marks a viewed thread unread again, coalesces the save, and ignores unknown threads", async () => {
    const stored = storedThread("agt-stored-0001", "agt-stored-0002");
    const harness = renderThreads({ storedThreads: [{ ...stored, viewedAtEpochMs: 2_500 }] });
    await waitForReact(() => expect(harness.hook().threads[0]?.unread).toBe(false));
    harness.store.saveAgentThread.mockClear();

    act(() => harness.hook().markThreadUnread("agt-missing-0000"));
    act(() => harness.hook().markThreadUnread(stored.threadId));
    act(() => harness.hook().markThreadUnread(stored.threadId));

    await waitForReact(() => expect(harness.hook().threads[0]?.unread).toBe(true));
    expect(harness.hook().threads[0]?.thread.viewedAtEpochMs).toBeNull();
    await waitForReact(() => expect(harness.store.saveAgentThread).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    });
    expect(harness.store.saveAgentThread).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("renames a thread with an immediate save and rejects the rename while another project owns the tab", async () => {
    const stored = storedThread("agt-stored-0001", "agt-stored-0002");
    const harness = renderThreads({ storedThreads: [stored] });
    await waitForReact(() => expect(harness.hook().threads).toHaveLength(1));
    harness.store.saveAgentThread.mockClear();

    harness.set({ rootKey: "/workspace/other", ownerId: "workspace-b", generation: 2 });
    act(() => harness.hook().renameThread(stored.threadId, "Foreign rename"));
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    });
    expect(harness.store.saveAgentThread).not.toHaveBeenCalled();

    harness.set({ rootKey: ROOT, ownerId: OWNER, generation: 3 });
    await waitForReact(() => expect(harness.hook().threads[0]?.thread.title).toBe("Stored thread"));
    act(() => harness.hook().renameThread(stored.threadId, "  Renamed thread  "));
    act(() => harness.hook().renameThread(stored.threadId, "   "));
    await waitForReact(() =>
      expect(harness.hook().threads[0]?.thread.title).toBe("Renamed thread"),
    );
    await waitForReact(() => expect(harness.store.saveAgentThread).toHaveBeenCalledTimes(1));
    expect(harness.store.saveAgentThread.mock.calls[0]?.[0]?.thread.title).toBe("Renamed thread");
    harness.unmount();
  });

  it("archives, unarchives and pins only threads of the owning project and reports the outcome", async () => {
    const stored = storedThread("agt-stored-0001", "agt-stored-0002");
    const harness = renderThreads({ storedThreads: [stored] });
    await waitForReact(() => expect(harness.hook().threads).toHaveLength(1));
    harness.store.saveAgentThread.mockClear();

    harness.set({ rootKey: "/workspace/other", ownerId: "workspace-b", generation: 2 });
    let outcome: boolean | null = null;
    act(() => {
      outcome = harness.hook().archive(stored.threadId);
    });
    act(() => harness.hook().togglePin(stored.threadId));
    expect(outcome).toBe(false);
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    });
    expect(harness.store.saveAgentThread).not.toHaveBeenCalled();

    harness.set({ rootKey: ROOT, ownerId: OWNER, generation: 3 });
    await waitForReact(() => expect(harness.hook().threads).toHaveLength(1));
    act(() => {
      outcome = harness.hook().archive(stored.threadId);
    });
    expect(outcome).toBe(true);
    await waitForReact(() => expect(harness.hook().threads[0]?.thread.archived).toBe(true));
    expect(harness.hook().threads[0]?.unread).toBe(false);
    act(() => {
      outcome = harness.hook().archive(stored.threadId);
    });
    expect(outcome).toBe(true);
    act(() => {
      outcome = harness.hook().unarchive(stored.threadId);
    });
    expect(outcome).toBe(true);
    await waitForReact(() => expect(harness.hook().threads[0]?.thread.archived).toBe(false));
    expect(harness.hook().threads[0]?.unread).toBe(true);
    await waitForReact(() => expect(harness.store.saveAgentThread).toHaveBeenCalledTimes(2));
    expect(harness.store.saveAgentThread.mock.calls[1]?.[0]?.thread.archived).toBe(false);
    harness.unmount();
  });

  it("returns copy details for the owned thread only and fails closed for foreign owners", async () => {
    const stored = storedThread("agt-stored-0001", "agt-stored-0002");
    const harness = renderThreads({
      storedThreads: [stored],
      worktrees: [worktreeOf(stored.threadId)],
    });
    await waitForReact(() => expect(harness.hook().threads).toHaveLength(1));
    await waitForReact(() => expect(harness.hook().threads[0]?.worktreeMissing).toBe(false));

    expect(harness.hook().threadCopyDetail(stored.threadId, "threadId")).toBe(stored.threadId);
    expect(harness.hook().threadCopyDetail(stored.threadId, "path")).toBe(
      `${ROOT}/.worktrees/${stored.threadId}`,
    );
    expect(harness.hook().threadCopyDetail(stored.threadId, "branch")).toBeNull();
    expect(harness.hook().threadCopyDetail("agt-missing-0000", "threadId")).toBeNull();

    await act(() => harness.hook().refreshShipStatus(stored.threadId));
    expect(harness.hook().threadCopyDetail(stored.threadId, "branch")).toBe("agent/x");

    harness.set({ rootKey: "/workspace/other", ownerId: "workspace-b", generation: 2 });
    expect(harness.hook().threadCopyDetail(stored.threadId, "threadId")).toBeNull();
    harness.set({ rootKey: ROOT, ownerId: OWNER, generation: 3 });
    await waitForReact(() =>
      expect(harness.hook().threadCopyDetail(stored.threadId, "threadId")).toBe(stored.threadId),
    );
    harness.unmount();
  });

  it("keeps a root-owned thread visible and owned after the project owner becomes a workspace id", async () => {
    const stored = storedThread("agt-stored-0001", "agt-stored-0002");
    const harness = renderThreads({ ownerId: PERSISTENT_OWNER, storedThreads: [stored] });
    await waitForReact(() => expect(harness.hook().threads).toHaveLength(1));
    harness.store.loadAgentThreads.mockImplementation(() => new Promise(() => undefined));

    harness.set({ ownerId: OWNER, generation: 2 });
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalledTimes(2));
    expect(harness.hook().threads.map((view) => view.thread.owner)).toEqual([
      { rootKey: ROOT, ownerId: PERSISTENT_OWNER, repositoryRoot: ROOT },
    ]);
    expect(harness.hook().threadCopyDetail(stored.threadId, "threadId")).toBe(stored.threadId);

    harness.set({ rootKey: "/workspace/other", ownerId: "workspace-b", generation: 3 });
    await waitForReact(() => expect(harness.hook().threads).toHaveLength(0));
    expect(harness.hook().threadCopyDetail(stored.threadId, "threadId")).toBeNull();
    harness.unmount();
  });

  it("exposes the observed provider CLI version and stamps dispatched turns with it", async () => {
    const harness = renderThreads();
    expect(harness.hook().agentCliVersion).toBe(CLI_VERSION);

    const result = await act(() => harness.hook().startThread(startRequest()));
    const view = harness
      .hook()
      .threads.find((candidate) => candidate.thread.threadId === result?.threadId);

    expect(view?.thread.turns[0]?.cliVersion).toBe(CLI_VERSION);
    expect(harness.hook().notice).toBeNull();
    harness.unmount();
  });

  it("stamps the next turn with the current observed provider version", async () => {
    const harness = renderThreads();
    harness.set({ cliVersion: "1.5.0" });
    expect(harness.hook().agentCliVersion).toBe("1.5.0");

    const result = await act(() => harness.hook().startThread(startRequest()));
    const view = harness
      .hook()
      .threads.find((candidate) => candidate.thread.threadId === result?.threadId);

    expect(view?.thread.turns[0]?.cliVersion).toBe("1.5.0");
    expect(harness.hook().notice).toBeNull();
    harness.unmount();
  });

  it.each(["claudeCode", "codex"] as const)(
    "resumes the same %s session after a CLI update and preserves the previous turn version",
    async (cliKind) => {
      const harness = renderThreads({ cliKind });
      await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());
      const launch = concreteLaunch(cliKind);
      const result = await act(() => harness.hook().startThread(startRequest({ launch })));
      expect(result).not.toBeNull();
      const threadId = result!.threadId;
      harness.set({ worktrees: [worktreeOf(threadId)] });
      const sessionId = "e49e4ab6-b1c3-4d26-9c2c-601ac23714f7";
      const sessionEvent =
        cliKind === "claudeCode"
          ? { type: "system", subtype: "init", session_id: sessionId }
          : { type: "thread.started", thread_id: sessionId };
      await act(async () => {
        harness.emitOutput(harness.turnIdOf(threadId), 1, `${JSON.stringify(sessionEvent)}\n`);
        harness.emitStatus(threadId, 1, { kind: "exited", exitCode: 0 });
      });
      const originalTurn = harness.hook().threads[0]?.thread.turns[0];
      expect(originalTurn?.cliVersion).toBe(CLI_VERSION);
      expect(harness.hook().threads[0]?.thread.provider.sessionId).toBe(sessionId);

      harness.set({ cliVersion: "1.5.0" });
      const sent = await act(() =>
        harness.hook().sendFollowUp({ threadId, prompt: "Continue after the CLI update", launch }),
      );

      expect(harness.hook().notice).toBeNull();
      expect(sent).toBe(true);
      expect(harness.startedRequests).toHaveLength(2);
      expect(harness.startedRequests[1]).toMatchObject({
        resumeSessionId: sessionId,
        agentCliKind: cliKind,
      });
      expect(harness.hook().threads).toHaveLength(1);
      const thread = harness.hook().threads[0]?.thread;
      expect(thread?.threadId).toBe(threadId);
      expect(thread?.turns).toHaveLength(2);
      expect(thread?.turns[0]).toEqual(originalTurn);
      expect(thread?.turns[1]?.cliVersion).toBe("1.5.0");
      expect(harness.hook().notice).toBeNull();
      harness.unmount();
    },
  );

  it("reports the last used launch of the root after a turn", async () => {
    const harness = renderThreads();
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalled());
    const launch = {
      provider: "claudeCode",
      model: "sonnet",
      mode: "plan",
      effort: "default",
    } as const;

    await act(() => harness.hook().startThread(startRequest({ launch })));

    expect(harness.hook().lastUsedLaunch(ROOT)).toEqual({
      ...launch,
      effort: "high",
      context: "1m",
    });
    expect(harness.hook().lastUsedLaunch("/workspace/other")).toBeNull();
    harness.unmount();
  });
});

describe("useAgentThreads ship and editor wiring", () => {
  it("exposes ship state per thread and refreshes it on demand", async () => {
    const stored = storedThread("agt-stored-0001", "agt-stored-0002");
    const harness = renderThreads({
      storedThreads: [stored],
      worktrees: [worktreeOf(stored.threadId)],
    });
    await waitForReact(() => expect(harness.hook().threads).toHaveLength(1));
    await waitForReact(() => expect(harness.hook().threads[0]?.worktreeMissing).toBe(false));

    expect(harness.hook().threads[0]?.ship).toEqual({
      kind: "idle",
      status: null,
      loadingStatus: false,
    });
    expect(harness.hook().threads[0]?.editorAvailability).toEqual({ kind: "available" });

    await act(() => harness.hook().refreshShipStatus(stored.threadId));
    expect(harness.hook().threads[0]?.ship).toMatchObject({ kind: "idle", status: shipStatus() });
    expect(harness.gitIntegration.getShipStatus).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("keeps an untracked thread view stable and swaps identity once when ship state appears", async () => {
    const first = storedThread("agt-stored-0001", "agt-stored-0002");
    const second = storedThread("agt-stored-0003", "agt-stored-0004");
    const harness = renderThreads({
      storedThreads: [first, second],
      worktrees: [worktreeOf(first.threadId), worktreeOf(second.threadId)],
    });
    await waitForReact(() => expect(harness.hook().threads).toHaveLength(2));
    await waitForReact(() =>
      expect(harness.hook().threads.every((view) => !view.worktreeMissing)).toBe(true),
    );

    const viewOf = (threadId: string) =>
      harness.hook().threads.find((view) => view.thread.threadId === threadId);
    const trackedBefore = viewOf(first.threadId);
    const untrackedBefore = viewOf(second.threadId);
    expect(untrackedBefore?.ship).toEqual({ kind: "idle", status: null, loadingStatus: false });

    harness.set({});
    expect(viewOf(first.threadId)).toBe(trackedBefore);
    expect(viewOf(second.threadId)).toBe(untrackedBefore);

    await act(() => harness.hook().refreshShipStatus(first.threadId));

    const trackedAfter = viewOf(first.threadId);
    expect(trackedAfter).not.toBe(trackedBefore);
    expect(trackedAfter?.ship).toMatchObject({ kind: "idle", status: shipStatus() });
    expect(viewOf(second.threadId)).toBe(untrackedBefore);
    expect(viewOf(second.threadId)?.ship).toBe(untrackedBefore?.ship);

    harness.set({});
    expect(viewOf(first.threadId)).toBe(trackedAfter);
    harness.unmount();
  });

  it("reconciles the ship status when a turn ends on a thread with no ship state yet", async () => {
    const stored = storedThread("agt-stored-0001", "agt-stored-0002");
    const harness = renderThreads({
      storedThreads: [stored],
      worktrees: [worktreeOf(stored.threadId)],
    });
    await waitForReact(() => expect(harness.hook().threads[0]?.worktreeMissing).toBe(false));
    expect(harness.gitIntegration.getShipStatus).not.toHaveBeenCalled();

    const sent = await act(() =>
      harness.hook().sendFollowUp({
        threadId: stored.threadId,
        prompt: "Keep going",
        launch: concreteLaunch("claudeCode"),
      }),
    );
    expect(sent).toBe(true);

    await act(async () => {
      harness.emitStatus(stored.threadId, 2, { kind: "exited", exitCode: 0 });
    });

    await waitForReact(() => expect(harness.gitIntegration.getShipStatus).toHaveBeenCalledTimes(1));
    expect(harness.hook().threads[0]?.ship).toMatchObject({ kind: "idle", status: shipStatus() });
    harness.unmount();
  });

  it("demotes a rehydrated integrated receipt that the branch status contradicts", async () => {
    const stored = storedThread("agt-stored-0001", "agt-stored-0002", {
      lastCommitSha: SHA_A,
      pushed: null,
      integrated: { intoBranch: "main", mergeSha: SHA_B, mode: "merge" },
      branchDeleted: false,
    });
    const harness = renderThreads({
      storedThreads: [stored],
      worktrees: [worktreeOf(stored.threadId)],
    });
    await waitForReact(() => expect(harness.hook().threads[0]?.worktreeMissing).toBe(false));

    expect(harness.hook().threads[0]?.ship).toMatchObject({
      kind: "integrated",
      status: null,
      intoBranch: "main",
    });

    await act(() => harness.hook().refreshShipStatus(stored.threadId));

    expect(harness.hook().threads[0]?.ship).toMatchObject({
      kind: "committed",
      status: shipStatus(),
      commitSha: SHA_A,
    });
    harness.unmount();
  });

  it("commits through the ship flow, persists the receipt and opens files via the bridge", async () => {
    const stored = storedThread("agt-stored-0001", "agt-stored-0002");
    const worktreePath = `${ROOT}/.worktrees/${stored.threadId}`;
    const harness = renderThreads({
      storedThreads: [stored],
      worktrees: [
        {
          worktreePath,
          branch: `agent/${stored.threadId}`,
          head: "abc",
          isPrimary: false,
          locked: false,
          prunable: false,
        },
      ],
    });
    await waitForReact(() => expect(harness.hook().threads[0]?.worktreeMissing).toBe(false));
    harness.git.getStatus.mockImplementationOnce(async (rootPath: string) =>
      gitStatusOf(rootPath, 1),
    );
    harness.store.saveAgentThread.mockClear();

    await act(() => harness.hook().commitThreadChanges(stored.threadId, "Ship it"));

    expect(harness.git.commit).toHaveBeenCalledWith(
      worktreePath,
      "Ship it",
      gitStatusOf(worktreePath, 1).changes,
    );
    expect(harness.hook().threads[0]?.ship).toMatchObject({ kind: "committed", commitSha: SHA_A });
    expect(harness.hook().threads[0]?.thread.integration).toMatchObject({ lastCommitSha: SHA_A });
    await waitForReact(() => expect(harness.store.saveAgentThread).toHaveBeenCalledTimes(1));

    const changed = gitStatusOf(worktreePath, 1).changes[0];
    expect(changed).toBeDefined();
    if (changed === undefined) return;
    await act(() => harness.hook().openChangedFile(stored.threadId, changed));
    expect(harness.editor.openFile).toHaveBeenCalledTimes(1);
    expect(harness.editor.openSurface).toHaveBeenCalledWith("editor");
    harness.unmount();
  });
});

describe("useAgentThreads external session import", () => {
  const EXTERNAL_ID = "34fbe185-9c1d-4e6a-8b21-7f3a5d90c412";

  function importRequest(
    overrides: Partial<ExternalSessionImportRequest> = {},
  ): ExternalSessionImportRequest {
    return {
      projectRootKey: ROOT,
      repositoryRoot: ROOT,
      provider: "claudeCode",
      sessionId: EXTERNAL_ID,
      title: "Security review session",
      firstPrompt: "remember plum",
      ...overrides,
    };
  }

  async function storeReady(harness: ReturnType<typeof renderThreads>, loads = 1): Promise<void> {
    await waitForReact(() => expect(harness.store.loadAgentThreads).toHaveBeenCalledTimes(loads));
    await act(async () => {
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
  }

  function durableImportGateway() {
    return {
      importSessionHistory: vi.fn<ExternalSessionImportGateway["importSessionHistory"]>(
        async () => ({
          complete: true,
          importedCount: 3,
          truncated: false,
        }),
      ),
      readImportedHistory: vi.fn<ExternalSessionImportGateway["readImportedHistory"]>(async () => ({
        history: {
          provider: "claudeCode",
          sessionId: EXTERNAL_ID,
          exchanges: [],
          exchangesTruncated: false,
          totalPreviewBytes: 0,
        },
        hasEarlier: false,
        beforeOrdinal: null,
        complete: true,
      })),
    };
  }

  it("awaits durable persistence of the empty header before starting history import", async () => {
    const gateway = durableImportGateway();
    const harness = renderThreads({ durableHistory: true, externalSessionImportGateway: gateway });
    await storeReady(harness);
    let finishSave!: () => void;
    harness.store.saveAgentThread.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    let importing!: ReturnType<AgentThreadsSurface["importExternalSession"]>;
    await act(async () => {
      importing = harness.hook().importExternalSession(importRequest());
      await Promise.resolve();
    });
    expect(harness.store.saveAgentThread).toHaveBeenCalled();
    expect(harness.store.saveAgentThread.mock.calls[0]?.[0].thread.turns).toHaveLength(0);
    expect(gateway.importSessionHistory).not.toHaveBeenCalled();
    await act(async () => {
      finishSave();
      await importing;
    });
    const result = await importing;
    expect(result?.alreadyImported).toBe(false);
    expect(gateway.importSessionHistory).toHaveBeenCalledWith({
      rootKey: ROOT,
      ownerId: PERSISTENT_OWNER,
      threadId: result?.threadId,
    });
    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("retries an interrupted durable import on the existing thread and resumes its checkpoint", async () => {
    const gateway = durableImportGateway();
    gateway.importSessionHistory.mockRejectedValueOnce(new Error("source temporarily unavailable"));
    const harness = renderThreads({ durableHistory: true, externalSessionImportGateway: gateway });
    await storeReady(harness);
    expect(await act(() => harness.hook().importExternalSession(importRequest()))).toBeNull();
    const threadId = harness.hook().threads[0]?.thread.threadId;
    expect(harness.hook().notice?.message).toContain("Retry to continue from the saved progress");
    gateway.importSessionHistory.mockResolvedValueOnce({
      complete: false,
      importedCount: 2,
      truncated: false,
    });
    const result = await act(() => harness.hook().importExternalSession(importRequest()));
    expect(result).toEqual({ threadId, alreadyImported: true });
    expect(gateway.importSessionHistory).toHaveBeenCalledTimes(3);
    expect(harness.hook().threads).toHaveLength(1);
    expect(harness.hook().notice).toBeNull();
    harness.unmount();
  });

  it("reopens an existing import after switching the configured provider", async () => {
    const gateway = durableImportGateway();
    const harness = renderThreads({ durableHistory: true, externalSessionImportGateway: gateway });
    await storeReady(harness);
    const created = await act(() => harness.hook().importExternalSession(importRequest()));
    expect(created).not.toBeNull();
    harness.set({ cliKind: "codex" });
    const reopened = await act(() => harness.hook().importExternalSession(importRequest()));
    expect(reopened).toEqual({ threadId: created?.threadId, alreadyImported: true });
    expect(gateway.importSessionHistory).toHaveBeenCalledTimes(2);
    expect(harness.startedRequests).toEqual([]);
    harness.unmount();
  });

  it("reopens a completed import while its resumed turn is running", async () => {
    const gateway = durableImportGateway();
    const harness = renderThreads({ durableHistory: true, externalSessionImportGateway: gateway });
    await storeReady(harness);
    const created = await act(() => harness.hook().importExternalSession(importRequest()));
    expect(created).not.toBeNull();
    const threadId = created!.threadId;
    const started = await act(() =>
      harness.hook().sendFollowUp({
        threadId,
        prompt: "Continue",
        launch: concreteLaunch("claudeCode"),
      }),
    );
    expect(started).toBe(true);
    const reopened = await act(() => harness.hook().importExternalSession(importRequest()));
    expect(reopened).toEqual({ threadId, alreadyImported: true });
    expect(harness.startedRequests).toHaveLength(1);
    expect(gateway.importSessionHistory).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it("restores an unloaded durable import and resumes its original provider session", async () => {
    const gateway = durableImportGateway();
    const harness = renderThreads({ durableHistory: true, externalSessionImportGateway: gateway });
    await storeReady(harness);
    const restored: AgentThread = {
      ...storedThread("agt-stored-0001", "agt-stored-0002"),
      target: { isolation: "in-place", worktreePath: null },
      provider: { kind: "claudeCode", sessionId: EXTERNAL_ID },
      externalOrigin: { provider: "claudeCode", sessionId: EXTERNAL_ID, importedAtEpochMs: 1_500 },
    };
    harness.findAgentHistoryImport.mockResolvedValueOnce(restored);
    const result = await act(() => harness.hook().importExternalSession(importRequest()));
    expect(result).toEqual({ threadId: restored.threadId, alreadyImported: true });
    expect(harness.hook().threads).toHaveLength(1);
    expect(harness.hook().threads[0]?.thread.owner.ownerId).toBe(OWNER);
    expect(harness.findAgentHistoryImport).toHaveBeenCalledWith({
      rootKey: ROOT,
      ownerId: PERSISTENT_OWNER,
      repositoryRoot: ROOT,
      provider: "claudeCode",
      sessionId: EXTERNAL_ID,
    });
    const sent = await act(() =>
      harness.hook().sendFollowUp({
        threadId: restored.threadId,
        prompt: "Continue",
        launch: concreteLaunch("claudeCode"),
      }),
    );
    expect(sent).toBe(true);
    expect(harness.startedRequests[0]?.resumeSessionId).toBe(EXTERNAL_ID);
    harness.unmount();
  });

  it("rejects a late durable lookup after A to B to A without restoring or importing it", async () => {
    const gateway = durableImportGateway();
    const harness = renderThreads({ durableHistory: true, externalSessionImportGateway: gateway });
    await storeReady(harness);
    let finishLookup!: (thread: AgentThread | null) => void;
    harness.findAgentHistoryImport.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLookup = resolve;
        }),
    );
    let importing!: ReturnType<AgentThreadsSurface["importExternalSession"]>;
    act(() => {
      importing = harness.hook().importExternalSession(importRequest());
    });
    harness.set({ rootKey: "/workspace/other", ownerId: "workspace-b", generation: 2 });
    await storeReady(harness, 2);
    harness.set({ rootKey: ROOT, ownerId: OWNER, generation: 3 });
    await storeReady(harness, 3);
    await act(async () => {
      finishLookup(storedThread("agt-stored-0001", "agt-stored-0002"));
      await importing;
    });
    expect(await importing).toBeNull();
    expect(harness.hook().threads).toHaveLength(0);
    expect(gateway.importSessionHistory).not.toHaveBeenCalled();
    expect(harness.store.saveAgentThread).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("does not start durable history import when the empty header cannot be saved", async () => {
    const gateway = durableImportGateway();
    const harness = renderThreads({ durableHistory: true, externalSessionImportGateway: gateway });
    await storeReady(harness);
    harness.store.saveAgentThread.mockRejectedValue(new Error("disk full"));
    const result = await act(() => harness.hook().importExternalSession(importRequest()));
    expect(result).toBeNull();
    expect(gateway.importSessionHistory).not.toHaveBeenCalled();
    expect(harness.hook().notice?.message).toContain("could not be saved");
    expect(harness.hook().threads).toHaveLength(1);
    harness.unmount();
  });

  it("stops checkpoint work and suppresses stale warnings when the owner changes during import", async () => {
    const gateway = durableImportGateway();
    let finishImport!: (
      progress: Awaited<ReturnType<ExternalSessionImportGateway["importSessionHistory"]>>,
    ) => void;
    gateway.importSessionHistory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishImport = resolve;
        }),
    );
    const harness = renderThreads({ durableHistory: true, externalSessionImportGateway: gateway });
    await storeReady(harness);
    let importing!: ReturnType<AgentThreadsSurface["importExternalSession"]>;
    await act(async () => {
      importing = harness.hook().importExternalSession(importRequest());
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    expect(gateway.importSessionHistory).toHaveBeenCalledTimes(1);
    harness.set({ rootKey: "/workspace/other", ownerId: "workspace-b", generation: 2 });
    await storeReady(harness, 2);
    harness.set({ rootKey: ROOT, ownerId: OWNER, generation: 3 });
    await storeReady(harness, 3);
    await act(async () => {
      finishImport({ complete: false, importedCount: 2, truncated: true });
      await importing;
    });
    expect(await importing).toBeNull();
    expect(gateway.importSessionHistory).toHaveBeenCalledTimes(1);
    expect(harness.hook().threads).toHaveLength(0);
    expect(harness.hook().notice).toBeNull();
    harness.unmount();
  });

  it("shows an incomplete-source warning for a completed but truncated import", async () => {
    const gateway = durableImportGateway();
    gateway.importSessionHistory.mockResolvedValueOnce({
      complete: true,
      importedCount: 3,
      truncated: true,
    });
    const harness = renderThreads({ durableHistory: true, externalSessionImportGateway: gateway });
    await storeReady(harness);
    const result = await act(() => harness.hook().importExternalSession(importRequest()));
    expect(result?.alreadyImported).toBe(false);
    expect(harness.hook().notice?.message).toContain("some source records were incomplete");
    expect(harness.hook().notice?.kind).toBe("warning");
    harness.unmount();
  });

  it("imports a zero-turn in-place thread, persists it, and starts no task", async () => {
    const harness = renderThreads();
    await storeReady(harness);
    harness.store.saveAgentThread.mockClear();

    const result = await act(() => harness.hook().importExternalSession(importRequest()));
    expect(result).toEqual({ threadId: expect.any(String), alreadyImported: false });

    const view = harness.hook().threads[0];
    expect(view?.thread.threadId).toBe(result?.threadId);
    expect(view?.thread.turns).toHaveLength(0);
    expect(view?.lifecycle).toBe("settled");
    expect(view?.thread.title).toBe("Security review session");
    expect(view?.thread.target).toEqual({ isolation: "in-place", worktreePath: null });
    expect(view?.thread.provider).toEqual({ kind: "claudeCode", sessionId: EXTERNAL_ID });
    expect(view?.thread.externalOrigin).toEqual({
      provider: "claudeCode",
      sessionId: EXTERNAL_ID,
      importedAtEpochMs: expect.any(Number),
    });
    expect(harness.hook().liveTaskCount).toBe(0);
    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    await waitForReact(() => expect(harness.store.saveAgentThread).toHaveBeenCalledTimes(1));
    const saved = harness.store.saveAgentThread.mock.calls[0]?.[0];
    expect(saved?.rootKey).toBe(ROOT);
    expect(saved?.thread.provider.sessionId).toBe(EXTERNAL_ID);
    expect(saved?.thread.externalOrigin?.sessionId).toBe(EXTERNAL_ID);
    expect(saved?.thread.turns).toHaveLength(0);
    harness.unmount();
  });

  it("loads history when an imported thread is selected and persists it without starting a turn", async () => {
    const history = {
      provider: "claudeCode" as const,
      sessionId: EXTERNAL_ID,
      exchanges: [{ role: "user" as const, text: "Earlier prompt" }],
      exchangesTruncated: false,
      totalPreviewBytes: 14,
    };
    const readExternalSessionHistory = vi.fn(async () => history);
    const harness = renderThreads({
      externalSessionGateway: {
        listExternalSessions: vi.fn(),
        previewExternalSession: vi.fn(),
        readExternalSessionHistory,
      },
    });
    await storeReady(harness);
    const result = await act(() => harness.hook().importExternalSession(importRequest()));
    await act(async () => harness.hook().markThreadViewed(result!.threadId));
    await waitForReact(() =>
      expect(harness.store.saveAgentThread).toHaveBeenCalledWith(
        expect.objectContaining({
          thread: expect.objectContaining({ externalOrigin: expect.objectContaining({ history }) }),
        }),
      ),
    );
    expect(harness.hook().threads[0]?.thread.externalOrigin?.history).toEqual(history);
    expect(harness.hook().threads[0]?.thread.turns).toHaveLength(0);
    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();
    act(() => harness.hook().markThreadViewed(result!.threadId));
    expect(readExternalSessionHistory).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("imports and resumes a project-root session when Git repositories are nested", async () => {
    const harness = renderThreads({
      cliKind: "codex",
      repositoryRoots: [`${ROOT}/packages/app`],
    });
    await storeReady(harness);

    const result = await act(() =>
      harness.hook().importExternalSession(importRequest({ provider: "codex" })),
    );
    const sent = await act(() =>
      harness.hook().sendFollowUp({
        threadId: result?.threadId ?? "",
        prompt: "continue from the imported session",
        launch: concreteLaunch("codex"),
      }),
    );

    expect(result?.alreadyImported).toBe(false);
    expect(sent).toBe(true);
    expect(harness.startedRequests[harness.startedRequests.length - 1]).toEqual(
      expect.objectContaining({
        projectRoot: ROOT,
        repositoryRoot: ROOT,
        cwd: ROOT,
        resumeSessionId: EXTERNAL_ID,
      }),
    );
    harness.unmount();
  });

  it("falls back to the first prompt as the title when the session title is empty", async () => {
    const harness = renderThreads();
    await storeReady(harness);

    const result = await act(() =>
      harness.hook().importExternalSession(importRequest({ title: "   " })),
    );

    const view = harness
      .hook()
      .threads.find((candidate) => candidate.thread.threadId === result?.threadId);
    expect(view?.thread.title).toBe("remember plum");
    harness.unmount();
  });

  it("resumes the imported session on the next follow-up through the task gateway", async () => {
    const harness = renderThreads({ cliKind: "codex" });
    await storeReady(harness);

    const result = await act(() =>
      harness.hook().importExternalSession(importRequest({ provider: "codex" })),
    );
    expect(result?.alreadyImported).toBe(false);
    expect(harness.agent.startAgentTask).not.toHaveBeenCalled();

    const sent = await act(() =>
      harness.hook().sendFollowUp({
        threadId: result?.threadId ?? "",
        prompt: "which word?",
        launch: concreteLaunch("codex"),
      }),
    );

    expect(sent).toBe(true);
    expect(harness.agent.startAgentTask).toHaveBeenCalledTimes(1);
    expect(harness.startedRequests[0]).toMatchObject({
      resumeSessionId: EXTERNAL_ID,
      agentCliKind: "codex",
      repositoryRoot: ROOT,
      cwd: ROOT,
      isolation: "in-place",
    });
    harness.unmount();
  });

  it("selects the existing thread when the session is already imported", async () => {
    const harness = renderThreads();
    await storeReady(harness);

    const first = await act(() => harness.hook().importExternalSession(importRequest()));
    const second = await act(() => harness.hook().importExternalSession(importRequest()));

    expect(second).toEqual({ threadId: first?.threadId, alreadyImported: true });
    expect(harness.hook().threads).toHaveLength(1);
    expect(harness.hook().notice?.message).toBe(IMPORT_DUPLICATE_NOTICE);
    harness.unmount();
  });

  it("resolves an id collision with a Codevo-born session to the existing thread", async () => {
    const stored = storedThread("agt-stored-0001", "agt-stored-0002");
    const collided = {
      ...stored,
      provider: { kind: "claudeCode" as const, sessionId: EXTERNAL_ID },
    };
    const harness = renderThreads({ storedThreads: [collided] });
    await waitForReact(() => expect(harness.hook().threads).toHaveLength(1));

    const result = await act(() => harness.hook().importExternalSession(importRequest()));

    expect(result).toEqual({ threadId: stored.threadId, alreadyImported: true });
    expect(harness.hook().threads).toHaveLength(1);
    harness.unmount();
  });

  it("rejects a provider that does not match the configured agent CLI", async () => {
    const harness = renderThreads();
    await storeReady(harness);

    const result = await act(() =>
      harness.hook().importExternalSession(importRequest({ provider: "codex" })),
    );

    expect(result).toBeNull();
    expect(harness.hook().threads).toHaveLength(0);
    expect(harness.hook().notice?.message).toBe(IMPORT_PROVIDER_MISMATCH_NOTICE);
    harness.unmount();
  });

  it("rejects a malformed session id before it can reach the store", async () => {
    const harness = renderThreads();
    await storeReady(harness);

    const result = await act(() =>
      harness.hook().importExternalSession(importRequest({ sessionId: "not-a-uuid" })),
    );

    expect(result).toBeNull();
    expect(harness.hook().notice?.message).toBe(IMPORT_INVALID_SESSION_NOTICE);
    expect(harness.store.saveAgentThread).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("fails closed while another project owns the tab and imports again after A to B to A", async () => {
    const harness = renderThreads();
    await storeReady(harness);

    harness.set({ rootKey: "/workspace/other", ownerId: "workspace-b", generation: 2 });
    const foreign = await act(() => harness.hook().importExternalSession(importRequest()));
    expect(foreign).toBeNull();
    expect(harness.hook().notice?.message).toBe(IMPORT_PROJECT_UNAVAILABLE_NOTICE);
    expect(harness.hook().threads).toHaveLength(0);

    harness.set({ rootKey: ROOT, ownerId: OWNER, generation: 3 });
    const beforeReload = await act(() => harness.hook().importExternalSession(importRequest()));
    expect(beforeReload).toBeNull();
    expect(harness.hook().notice?.message).toBe(IMPORT_STORE_NOT_READY_NOTICE);

    await storeReady(harness, 3);
    const result = await act(() => harness.hook().importExternalSession(importRequest()));
    expect(result?.alreadyImported).toBe(false);
    await waitForReact(() => expect(harness.hook().threads).toHaveLength(1));
    harness.unmount();
  });

  it("keeps a truthful notice when the store rejects the imported thread", async () => {
    const harness = renderThreads();
    await storeReady(harness);
    harness.store.saveAgentThread.mockRejectedValueOnce(new Error("disk full"));

    const result = await act(() => harness.hook().importExternalSession(importRequest()));

    expect(result).not.toBeNull();
    await waitForReact(() =>
      expect(harness.hook().notice?.message).toBe("Some agent conversations could not be saved."),
    );
    harness.unmount();
  });
});

function concreteLaunch(provider: AgentCliKind): AgentLaunchOptions {
  if (provider === "codex") return { provider: "codex", model: "default", mode: "workspaceWrite" };
  return {
    provider: "claudeCode",
    model: "default",
    mode: "supervised",
    effort: "high",
    context: "1m",
    fastMode: false,
    thinkingMode: false,
  };
}
