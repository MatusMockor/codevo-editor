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
import {
  agentCliVersionChangeMessage,
  type AgentCliVersionGateway,
  type AgentCliVersionProbeRequest,
} from "../domain/agentCliVersion";
import type { AgentThread } from "../domain/agentThread";
import type { GitStatus } from "../domain/git";
import type { GitIntegrationOutcome, GitShipStatus } from "../domain/gitIntegration";
import type { GitWorktreeDescriptor, GitWorktreeGateway } from "../domain/gitWorktree";
import { waitForReact } from "../test/reactTestLifecycle";
import type {
  AgentThreadStartRequest,
  AgentThreadStoreGateway,
  AgentThreadsSurface,
  SaveAgentThreadRequest,
} from "./agentThreadPorts";
import { useAgentThreads, type AgentThreadsDependencies } from "./useAgentThreads";
import { defaultAgentLaunchOptions } from "../domain/agentLaunch";

const ROOT = "/workspace/app";
const OWNER = "workspace-a";
const PERSISTENT_OWNER = agentRootOwnerId(ROOT);
const CLI_PATH = "/usr/local/bin/claude";
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
    launch: defaultAgentLaunchOptions("claudeCode"),
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
    ...overrides,
  };
  const startedRequests: StartAgentTaskRequest[] = [];
  let statusHandler: ((event: AgentTaskStatusEvent) => void) | null = null;
  let outputHandler: ((event: AgentTaskOutputEvent) => void) | null = null;
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
  const store = {
    loadAgentThreads: vi.fn(async () => ({
      threads: environment.storedThreads,
      unreadable: [],
      evicted: 0,
    })),
    saveAgentThread: vi.fn(async (_request: SaveAgentThreadRequest) => undefined),
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
  const cliVersionGateway = {
    probeAgentCliVersion: vi.fn(async (request: AgentCliVersionProbeRequest) => ({
      version: environment.cliVersion,
      probedAtEpochMs: 1_700_000_000_000,
      binaryFingerprint: { sizeBytes: request.agentCliPath.length, modifiedEpochMs: 1 },
    })),
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
    repositories: [
      {
        mapping: { rootRelativePath: "" },
        repositoryRoot: environment.rootKey,
        repositoryRelativePath: "",
      },
    ],
    isolationPolicy: "auto",
    leaseToken: 1,
  });

  let current: AgentThreadsSurface | null = null;

  function Harness() {
    const dependencies: AgentThreadsDependencies = {
      agentTaskGateway: agent as unknown as AgentTaskGateway,
      agentCliVersionGateway: cliVersionGateway as AgentCliVersionGateway,
      agentThreadStoreGateway: store as unknown as AgentThreadStoreGateway,
      gitWorktreeGateway: worktree as unknown as GitWorktreeGateway,
      gitGateway: git,
      gitIntegrationGateway: gitIntegration,
      externalUrlOpener: null,
      editorBridge: environment.withEditor ? editor : null,
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
  const render = (): void => act(() => root.render(createElement(Harness)));
  render();

  return {
    agent,
    cliVersionGateway,
    store,
    git,
    gitIntegration,
    editor,
    startedRequests,
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

  it("exposes the probed agent CLI version and stamps dispatched turns with it", async () => {
    const harness = renderThreads();
    await waitForReact(() => expect(harness.hook().agentCliVersion).toBe(CLI_VERSION));
    expect(harness.cliVersionGateway.probeAgentCliVersion).toHaveBeenCalledWith({
      agentCliPath: CLI_PATH,
      agentCliKind: "claudeCode",
    });

    const result = await act(() => harness.hook().startThread(startRequest()));
    const view = harness
      .hook()
      .threads.find((candidate) => candidate.thread.threadId === result?.threadId);

    expect(view?.thread.turns[0]?.cliVersion).toBe(CLI_VERSION);
    expect(harness.hook().notice).toBeNull();
    harness.unmount();
  });

  it("announces a CLI version change and stamps the next turn with the new version", async () => {
    const harness = renderThreads();
    await waitForReact(() => expect(harness.hook().agentCliVersion).toBe(CLI_VERSION));

    harness.set({ cliVersion: "1.5.0", agentModeActive: false });
    harness.set({ agentModeActive: true });
    await waitForReact(() => expect(harness.hook().agentCliVersion).toBe("1.5.0"));

    expect(harness.hook().notice).toEqual({
      kind: "info",
      message: agentCliVersionChangeMessage("claudeCode", CLI_VERSION, "1.5.0"),
      action: null,
    });

    const result = await act(() => harness.hook().startThread(startRequest()));
    const view = harness
      .hook()
      .threads.find((candidate) => candidate.thread.threadId === result?.threadId);

    expect(view?.thread.turns[0]?.cliVersion).toBe("1.5.0");
    expect(harness.hook().notice?.kind).toBe("info");
    harness.unmount();
  });

  it("dispatches with the cached version and announces the update found by the background refresh", async () => {
    const harness = renderThreads();
    await waitForReact(() => expect(harness.hook().agentCliVersion).toBe(CLI_VERSION));

    harness.set({ cliVersion: "1.5.0" });
    const result = await act(() => harness.hook().startThread(startRequest()));
    const view = harness
      .hook()
      .threads.find((candidate) => candidate.thread.threadId === result?.threadId);

    expect(view?.thread.turns[0]?.cliVersion).toBe(CLI_VERSION);
    await waitForReact(() => expect(harness.hook().agentCliVersion).toBe("1.5.0"));
    expect(harness.hook().notice).toEqual({
      kind: "info",
      message: agentCliVersionChangeMessage("claudeCode", CLI_VERSION, "1.5.0"),
      action: null,
    });
    harness.unmount();
  });

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

    expect(harness.hook().lastUsedLaunch(ROOT)).toEqual(launch);
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
        launch: defaultAgentLaunchOptions("claudeCode"),
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
    expect(harness.editor.openSurface).toHaveBeenCalledWith("files");
    harness.unmount();
  });
});
