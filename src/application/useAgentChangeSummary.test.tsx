// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentThread } from "../domain/agentThread";
import type { GitChangedFile, GitFileDiff, GitStatus } from "../domain/git";
import type { ResolvedGitRepository } from "../domain/gitRepositoryMapping";
import { waitForReact } from "../test/reactTestLifecycle";
import {
  MAX_AGENT_TASK_CHANGE_ROWS,
  MAX_AGENT_TASK_CHANGE_REQUESTS,
  MAX_AGENT_TASK_CHANGE_REQUEST_THREADS,
  MAX_AGENT_TASK_CHANGE_SUMMARIES,
  MAX_AGENT_TASK_DIFF_SIDE_BYTES,
  useAgentChangeSummary,
  type AgentChangeSummaryDependencies,
  type AgentChangeSummarySurface,
} from "./useAgentChangeSummary";

const ROOT_KEY = "/workspace/app";
const OWNER_ID = "agent-root:0123456789abcdef";
const RUNTIME_OWNER_ID = "workspace-replaced";
const REPOSITORY_ROOT = "/workspace/app";
const WORKTREE_PATH = "/workspace/app/.worktrees/agt-1-0a1b";
const THREAD_ID = "agt-1-0a1b";

function repository(repositoryRoot: string): ResolvedGitRepository {
  return { mapping: { rootRelativePath: "" }, repositoryRoot, repositoryRelativePath: "" };
}

function project(overrides: Partial<AgentProjectDescriptor> = {}): AgentProjectDescriptor {
  return {
    rootKey: ROOT_KEY,
    rootPath: ROOT_KEY,
    ownerId: OWNER_ID,
    label: "app",
    generation: 1,
    trust: "trusted",
    origin: "active-tab",
    repositories: [repository(REPOSITORY_ROOT)],
    isolationPolicy: "auto",
    leaseToken: null,
    ...overrides,
  };
}

function thread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    threadId: THREAD_ID,
    owner: { rootKey: ROOT_KEY, ownerId: OWNER_ID, repositoryRoot: REPOSITORY_ROOT },
    target: { isolation: "worktree", worktreePath: WORKTREE_PATH },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Fix the parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: 10,
    updatedAtEpochMs: 10,
    turns: [],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
    ...overrides,
  };
}

function threadWithId(threadId: string, overrides: Partial<AgentThread> = {}): AgentThread {
  return thread({
    threadId,
    target: { isolation: "worktree", worktreePath: `${WORKTREE_PATH}-${threadId}` },
    ...overrides,
  });
}

function changedFile(relativePath: string): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: `${WORKTREE_PATH}/${relativePath}`,
    relativePath,
    status: "modified",
  };
}

function gitStatus(changes: ReadonlyArray<GitChangedFile>): GitStatus {
  return { branch: "main", changes: [...changes], isRepository: true, rootPath: WORKTREE_PATH };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

interface Environment {
  projects: ReadonlyArray<AgentProjectDescriptor>;
  threads: ReadonlyMap<string, AgentThread>;
  status: GitStatus;
  diff: GitFileDiff;
}

function renderChangeSummary(overrides: Partial<Environment> = {}) {
  const environment: Environment = {
    projects: [project()],
    threads: new Map([[THREAD_ID, thread()]]),
    status: gitStatus([changedFile("src/app.ts")]),
    diff: {
      change: changedFile("src/app.ts"),
      language: "typescript",
      originalContent: "before",
      modifiedContent: "after",
      previewUnavailableReason: null,
    },
    ...overrides,
  };

  const gitGateway = {
    getStatus: vi.fn(async () => environment.status),
    getDiff: vi.fn(async () => environment.diff),
  };
  const reportError = vi.fn();

  const dependencies = (): AgentChangeSummaryDependencies => ({
    gitGateway,
    projects: environment.projects,
    threads: environment.threads,
    reportError,
  });

  const host = document.createElement("div");
  const root = createRoot(host);
  const captured: { value: AgentChangeSummarySurface | null } = { value: null };

  function Harness(props: { readonly dependencies: AgentChangeSummaryDependencies }) {
    captured.value = useAgentChangeSummary(props.dependencies);
    return null;
  }

  const render = () => act(() => root.render(<Harness dependencies={dependencies()} />));
  render();

  return {
    environment,
    gitGateway,
    reportError,
    hook: () => captured.value as AgentChangeSummarySurface,
    summary: () => captured.value?.summaries.get(THREAD_ID) ?? null,
    set: (next: Partial<Environment>) => {
      Object.assign(environment, next);
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

describe("useAgentChangeSummary changes", () => {
  it("bounds pending authority to two request kinds for each retained thread", () => {
    expect(MAX_AGENT_TASK_CHANGE_REQUEST_THREADS).toBe(32);
    expect(MAX_AGENT_TASK_CHANGE_REQUESTS).toBe(MAX_AGENT_TASK_CHANGE_REQUEST_THREADS * 2);
  });

  it("loads changes for a retained runtime owner", async () => {
    const runtimeThread = thread({
      owner: { rootKey: ROOT_KEY, ownerId: RUNTIME_OWNER_ID, repositoryRoot: REPOSITORY_ROOT },
    });
    const harness = renderChangeSummary({
      projects: [project({ runtimeOwnerIds: [OWNER_ID, RUNTIME_OWNER_ID] })],
      threads: new Map([[THREAD_ID, runtimeThread]]),
    });
    await act(() => harness.hook().showChanges(THREAD_ID));
    expect(harness.summary()?.files).toHaveLength(1);
    harness.unmount();
  });
  it("reads the worktree changes for a thread and bounds the rows", async () => {
    const changes = Array.from({ length: MAX_AGENT_TASK_CHANGE_ROWS + 3 }, (_unused, index) =>
      changedFile(`src/file-${index}.ts`),
    );
    const harness = renderChangeSummary({ status: gitStatus(changes) });

    await act(async () => {
      await harness.hook().showChanges(THREAD_ID);
    });

    expect(harness.gitGateway.getStatus).toHaveBeenCalledWith(WORKTREE_PATH);
    expect(harness.summary()?.loading).toBe(false);
    expect(harness.summary()?.files).toHaveLength(MAX_AGENT_TASK_CHANGE_ROWS);
    expect(harness.summary()?.truncated).toBe(true);
    harness.unmount();
  });

  it("ignores a thread without a worktree", async () => {
    const inPlace = thread({ target: { isolation: "in-place", worktreePath: null } });
    const harness = renderChangeSummary({ threads: new Map([[THREAD_ID, inPlace]]) });

    await act(async () => {
      await harness.hook().showChanges(THREAD_ID);
    });

    expect(harness.gitGateway.getStatus).not.toHaveBeenCalled();
    expect(harness.summary()).toBeNull();
    harness.unmount();
  });

  it("ignores a thread whose repository is foreign to its claimed project", async () => {
    const harness = renderChangeSummary({ projects: [project({ repositories: [] })] });

    await act(() => harness.hook().showChanges(THREAD_ID));

    expect(harness.gitGateway.getStatus).not.toHaveBeenCalled();
    expect(harness.summary()).toBeNull();
    harness.unmount();
  });

  it("hides the summary and skips a refresh while it is hidden", async () => {
    const harness = renderChangeSummary();
    await act(async () => {
      await harness.hook().showChanges(THREAD_ID);
    });

    act(() => harness.hook().hideChanges(THREAD_ID));
    expect(harness.summary()).toBeNull();

    harness.gitGateway.getStatus.mockClear();
    await act(async () => {
      await harness.hook().refreshVisibleChanges(THREAD_ID);
    });

    expect(harness.gitGateway.getStatus).not.toHaveBeenCalled();
    harness.unmount();
  });

  it.each(["resolve", "reject"] as const)(
    "does not restore or report a hidden pending summary when it %ss late",
    async (settlement) => {
      const pending = deferred<GitStatus>();
      const harness = renderChangeSummary();
      harness.gitGateway.getStatus.mockImplementationOnce(async () => pending.promise);

      let loading: Promise<void> = Promise.resolve();
      act(() => {
        loading = harness.hook().showChanges(THREAD_ID);
      });
      act(() => harness.hook().hideChanges(THREAD_ID));

      await act(async () => {
        if (settlement === "resolve") pending.resolve(harness.environment.status);
        else pending.reject(new Error("late status failure"));
        await loading;
      });

      expect(harness.summary()).toBeNull();
      expect(harness.reportError).not.toHaveBeenCalled();
      harness.unmount();
    },
  );

  it("refreshes a visible summary", async () => {
    const harness = renderChangeSummary();
    await act(async () => {
      await harness.hook().showChanges(THREAD_ID);
    });
    harness.gitGateway.getStatus.mockClear();
    harness.set({ status: gitStatus([changedFile("src/app.ts"), changedFile("src/next.ts")]) });

    await act(async () => {
      await harness.hook().refreshVisibleChanges(THREAD_ID);
    });

    expect(harness.gitGateway.getStatus).toHaveBeenCalledTimes(1);
    expect(harness.summary()?.files).toHaveLength(2);
    harness.unmount();
  });

  it.each(["resolve", "reject"] as const)(
    "drops a pruned pending summary without reporting when its read %ss late",
    async (settlement) => {
      const pending = deferred<GitStatus>();
      const harness = renderChangeSummary();
      harness.gitGateway.getStatus.mockImplementationOnce(async () => pending.promise);

      let showing: Promise<void> = Promise.resolve();
      act(() => {
        showing = harness.hook().showChanges(THREAD_ID);
      });
      harness.set({ projects: [project({ generation: 2 })] });

      await act(async () => {
        if (settlement === "resolve") {
          pending.resolve(gitStatus([changedFile("src/app.ts")]));
        } else {
          pending.reject(new Error("late pruned failure"));
        }
        await showing;
      });

      expect(harness.summary()).toBeNull();
      expect(harness.reportError).not.toHaveBeenCalled();
      harness.unmount();
    },
  );

  it("reports a failed status read on the summary", async () => {
    const harness = renderChangeSummary();
    harness.gitGateway.getStatus.mockRejectedValueOnce(new Error("git unavailable"));

    await act(async () => {
      await harness.hook().showChanges(THREAD_ID);
    });

    expect(harness.reportError).toHaveBeenCalledWith("Agents", expect.any(Error));
    expect(harness.summary()?.error).toBe("The worktree changes could not be read.");
    harness.unmount();
  });

  it("bounds retained summaries with deterministic least-recently-used eviction", async () => {
    const threads = new Map<string, AgentThread>();
    for (let index = 0; index <= MAX_AGENT_TASK_CHANGE_SUMMARIES; index += 1) {
      const next = threadWithId(`thread-${index}`);
      threads.set(next.threadId, next);
    }
    const harness = renderChangeSummary({ threads });

    for (let index = 0; index < MAX_AGENT_TASK_CHANGE_SUMMARIES; index += 1) {
      await act(() => harness.hook().showChanges(`thread-${index}`));
    }
    await act(() => harness.hook().refreshVisibleChanges("thread-0"));
    await act(() => harness.hook().showChanges(`thread-${MAX_AGENT_TASK_CHANGE_SUMMARIES}`));

    expect(harness.hook().summaries.size).toBe(MAX_AGENT_TASK_CHANGE_SUMMARIES);
    expect(harness.hook().summaries.has("thread-0")).toBe(true);
    expect(harness.hook().summaries.has("thread-1")).toBe(false);
    expect(harness.hook().summaries.has(`thread-${MAX_AGENT_TASK_CHANGE_SUMMARIES}`)).toBe(true);
    harness.unmount();
  });

  it("prunes summaries for absent threads and exact-owner replacements", async () => {
    const first = threadWithId("first");
    const second = threadWithId("second");
    const harness = renderChangeSummary({ threads: new Map([[first.threadId, first]]) });
    await act(() => harness.hook().showChanges(first.threadId));

    harness.set({ threads: new Map([[second.threadId, second]]) });
    await waitForReact(() => expect(harness.hook().summaries.size).toBe(0));

    await act(() => harness.hook().showChanges(second.threadId));
    harness.set({
      projects: [project({ ownerId: RUNTIME_OWNER_ID })],
      threads: new Map([
        [
          second.threadId,
          threadWithId(second.threadId, {
            owner: {
              rootKey: ROOT_KEY,
              ownerId: RUNTIME_OWNER_ID,
              repositoryRoot: REPOSITORY_ROOT,
            },
          }),
        ],
      ]),
    });

    await waitForReact(() => expect(harness.hook().summaries.size).toBe(0));
    harness.unmount();
  });

  it.each(["resolve", "reject"] as const)(
    "does not resurrect or report an evicted summary when its pending read %ss",
    async (settlement) => {
      const pending = Array.from({ length: MAX_AGENT_TASK_CHANGE_SUMMARIES + 1 }, () =>
        deferred<GitStatus>(),
      );
      const threads = new Map<string, AgentThread>();
      for (let index = 0; index <= MAX_AGENT_TASK_CHANGE_SUMMARIES; index += 1) {
        const next = threadWithId(`thread-${index}`);
        threads.set(next.threadId, next);
      }
      const harness = renderChangeSummary({ threads });
      harness.gitGateway.getStatus.mockImplementation(
        async () => pending[harness.gitGateway.getStatus.mock.calls.length - 1].promise,
      );

      const loads: Promise<void>[] = [];
      for (let index = 0; index <= MAX_AGENT_TASK_CHANGE_SUMMARIES; index += 1) {
        act(() => {
          loads.push(harness.hook().showChanges(`thread-${index}`));
        });
      }
      expect(harness.hook().summaries.has("thread-0")).toBe(false);

      await act(async () => {
        if (settlement === "resolve") {
          pending[0].resolve(gitStatus([changedFile("late.ts")]));
        } else {
          pending[0].reject(new Error("late failure"));
        }
        await loads[0];
      });

      expect(harness.hook().summaries.size).toBe(MAX_AGENT_TASK_CHANGE_SUMMARIES);
      expect(harness.hook().summaries.has("thread-0")).toBe(false);
      expect(harness.reportError).not.toHaveBeenCalled();
      harness.unmount();
    },
  );

  it("coalesces repeated refreshes while a status read is pending", async () => {
    const pending = deferred<GitStatus>();
    const harness = renderChangeSummary();
    harness.gitGateway.getStatus.mockImplementationOnce(async () => pending.promise);

    let firstLoad: Promise<void> = Promise.resolve();
    act(() => {
      firstLoad = harness.hook().showChanges(THREAD_ID);
    });
    const coalescedLoads: Promise<void>[] = [];
    for (let index = 0; index < MAX_AGENT_TASK_CHANGE_REQUESTS + 1; index += 1) {
      act(() => {
        coalescedLoads.push(harness.hook().refreshVisibleChanges(THREAD_ID));
      });
    }
    expect(harness.gitGateway.getStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(gitStatus([changedFile("coalesced.ts")]));
      await Promise.all([firstLoad, ...coalescedLoads]);
    });

    expect(harness.summary()?.files.map((file) => file.relativePath)).toEqual(["coalesced.ts"]);
    await act(() => harness.hook().refreshVisibleChanges(THREAD_ID));
    expect(harness.gitGateway.getStatus).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it("caps actual unresolved gateway calls and resumes admission after settlement", async () => {
    const threads = new Map<string, AgentThread>();
    for (let index = 0; index <= MAX_AGENT_TASK_CHANGE_REQUEST_THREADS; index += 1) {
      const next = threadWithId(`thread-${index}`);
      threads.set(next.threadId, next);
    }
    const statusPending: Array<ReturnType<typeof deferred<GitStatus>>> = [];
    const diffPending: Array<ReturnType<typeof deferred<GitFileDiff>>> = [];
    const harness = renderChangeSummary({ threads });
    harness.gitGateway.getStatus.mockImplementation(async () => {
      const pending = deferred<GitStatus>();
      statusPending.push(pending);
      return pending.promise;
    });
    harness.gitGateway.getDiff.mockImplementation(async () => {
      const pending = deferred<GitFileDiff>();
      diffPending.push(pending);
      return pending.promise;
    });

    const statusLoads: Promise<void>[] = [];
    for (let index = 0; index < MAX_AGENT_TASK_CHANGE_REQUEST_THREADS; index += 1) {
      act(() => {
        statusLoads.push(harness.hook().showChanges(`thread-${index}`));
      });
      act(() => {
        void harness.hook().showFileDiff(`thread-${index}`, changedFile(`diff-${index}.ts`));
      });
    }
    expect(harness.gitGateway.getStatus).toHaveBeenCalledTimes(
      MAX_AGENT_TASK_CHANGE_REQUEST_THREADS,
    );
    expect(harness.gitGateway.getDiff).toHaveBeenCalledTimes(MAX_AGENT_TASK_CHANGE_REQUEST_THREADS);

    await act(() => harness.hook().showChanges(`thread-${MAX_AGENT_TASK_CHANGE_REQUEST_THREADS}`));
    expect(
      harness.gitGateway.getStatus.mock.calls.length + harness.gitGateway.getDiff.mock.calls.length,
    ).toBe(MAX_AGENT_TASK_CHANGE_REQUESTS);
    expect(
      harness.hook().summaries.get(`thread-${MAX_AGENT_TASK_CHANGE_REQUEST_THREADS}`)?.loading,
    ).toBe(false);
    expect(
      harness.hook().summaries.get(`thread-${MAX_AGENT_TASK_CHANGE_REQUEST_THREADS}`)?.error,
    ).toContain("Too many change requests");

    await act(async () => {
      statusPending[0].resolve(harness.environment.status);
      await statusLoads[0];
    });
    act(() => {
      void harness.hook().refreshVisibleChanges(`thread-${MAX_AGENT_TASK_CHANGE_REQUEST_THREADS}`);
    });
    expect(
      harness.gitGateway.getStatus.mock.calls.length + harness.gitGateway.getDiff.mock.calls.length,
    ).toBe(MAX_AGENT_TASK_CHANGE_REQUESTS + 1);
    harness.unmount();
  });

  it("does not refresh request recency when one of two pending kinds completes", async () => {
    const threads = new Map<string, AgentThread>();
    for (let index = 0; index <= MAX_AGENT_TASK_CHANGE_REQUEST_THREADS; index += 1) {
      const next = threadWithId(`thread-${index}`);
      threads.set(next.threadId, next);
    }
    const statusPending: Array<ReturnType<typeof deferred<GitStatus>>> = [];
    const diffPending = deferred<GitFileDiff>();
    const harness = renderChangeSummary({ threads });
    harness.gitGateway.getStatus.mockImplementation(async () => {
      const pending = deferred<GitStatus>();
      statusPending.push(pending);
      return pending.promise;
    });
    harness.gitGateway.getDiff.mockImplementationOnce(async () => diffPending.promise);

    const statusLoads: Promise<void>[] = [];
    for (let index = 0; index < MAX_AGENT_TASK_CHANGE_REQUEST_THREADS; index += 1) {
      act(() => {
        statusLoads.push(harness.hook().showChanges(`thread-${index}`));
      });
    }
    let diffLoad: Promise<void> = Promise.resolve();
    act(() => {
      diffLoad = harness.hook().showFileDiff("thread-1", changedFile("mixed.ts"));
    });
    for (let index = 2; index < MAX_AGENT_TASK_CHANGE_REQUEST_THREADS; index += 1) {
      act(() => {
        void harness.hook().refreshVisibleChanges(`thread-${index}`);
      });
    }
    act(() => {
      void harness.hook().refreshVisibleChanges("thread-0");
    });

    await act(async () => {
      diffPending.resolve(harness.environment.diff);
      await diffLoad;
    });
    act(() => {
      void harness.hook().showChanges(`thread-${MAX_AGENT_TASK_CHANGE_REQUEST_THREADS}`);
    });

    expect(harness.hook().summaries.has("thread-1")).toBe(false);
    expect(harness.hook().summaries.has("thread-2")).toBe(true);

    await act(async () => {
      statusPending[1].resolve(harness.environment.status);
      await statusLoads[1];
    });
    expect(harness.hook().summaries.has("thread-1")).toBe(false);
    expect(harness.reportError).not.toHaveBeenCalled();
    harness.unmount();
  });
});

describe("useAgentChangeSummary file diff", () => {
  it("clips both diff sides at the byte bound", async () => {
    const harness = renderChangeSummary({
      diff: {
        change: changedFile("src/app.ts"),
        language: "typescript",
        originalContent: "a".repeat(MAX_AGENT_TASK_DIFF_SIDE_BYTES + 10),
        modifiedContent: "b".repeat(MAX_AGENT_TASK_DIFF_SIDE_BYTES + 10),
        previewUnavailableReason: null,
      },
    });
    await act(async () => {
      await harness.hook().showChanges(THREAD_ID);
    });

    await act(async () => {
      await harness.hook().showFileDiff(THREAD_ID, changedFile("src/app.ts"));
    });

    const diff = harness.summary()?.diff;
    expect(diff?.loading).toBe(false);
    expect(diff?.original.truncated).toBe(true);
    expect(diff?.original.text).toHaveLength(MAX_AGENT_TASK_DIFF_SIDE_BYTES);
    expect(diff?.modified.truncated).toBe(true);
    harness.unmount();
  });

  it("hides the diff without hiding the summary", async () => {
    const harness = renderChangeSummary();
    await act(async () => {
      await harness.hook().showChanges(THREAD_ID);
    });
    await act(async () => {
      await harness.hook().showFileDiff(THREAD_ID, changedFile("src/app.ts"));
    });

    act(() => harness.hook().hideFileDiff(THREAD_ID));

    expect(harness.summary()?.diff).toBeNull();
    expect(harness.summary()?.files).toHaveLength(1);
    harness.unmount();
  });

  it.each(["resolve", "reject"] as const)(
    "does not reopen or report a hidden pending diff when it %ss late",
    async (settlement) => {
      const pending = deferred<GitFileDiff>();
      const harness = renderChangeSummary();
      await act(() => harness.hook().showChanges(THREAD_ID));
      harness.gitGateway.getDiff.mockImplementationOnce(async () => pending.promise);

      let loading: Promise<void> = Promise.resolve();
      act(() => {
        loading = harness.hook().showFileDiff(THREAD_ID, changedFile("src/app.ts"));
      });
      act(() => harness.hook().hideFileDiff(THREAD_ID));

      await act(async () => {
        if (settlement === "resolve") pending.resolve(harness.environment.diff);
        else pending.reject(new Error("late diff failure"));
        await loading;
      });

      expect(harness.summary()?.diff).toBeNull();
      expect(harness.reportError).not.toHaveBeenCalled();
      harness.unmount();
    },
  );

  it("reports a failed diff read on the diff pane", async () => {
    const harness = renderChangeSummary();
    await act(async () => {
      await harness.hook().showChanges(THREAD_ID);
    });
    harness.gitGateway.getDiff.mockRejectedValueOnce(new Error("git unavailable"));

    await act(async () => {
      await harness.hook().showFileDiff(THREAD_ID, changedFile("src/app.ts"));
    });

    expect(harness.reportError).toHaveBeenCalledWith("Agents", expect.any(Error));
    expect(harness.summary()?.diff?.error).toBe("The file diff could not be read.");
    harness.unmount();
  });
});

describe("useAgentChangeSummary removal state", () => {
  it("tracks the removing flag and clears the summary", async () => {
    const harness = renderChangeSummary();
    await act(async () => {
      await harness.hook().showChanges(THREAD_ID);
    });

    act(() => harness.hook().setRemoving(THREAD_ID, true));
    expect(harness.summary()?.removing).toBe(true);

    act(() => harness.hook().setRemoving(THREAD_ID, false));
    expect(harness.summary()?.removing).toBe(false);

    act(() => harness.hook().clear(THREAD_ID));
    expect(harness.summary()).toBeNull();

    await waitForReact(() => {
      expect(harness.hook().summaries.size).toBe(0);
    });
    harness.unmount();
  });

  it.each(["resolve", "reject"] as const)(
    "does not restore or report a cleared pending summary when it %ss late",
    async (settlement) => {
      const pending = deferred<GitStatus>();
      const harness = renderChangeSummary();
      harness.gitGateway.getStatus.mockImplementationOnce(async () => pending.promise);

      let loading: Promise<void> = Promise.resolve();
      act(() => {
        loading = harness.hook().showChanges(THREAD_ID);
      });
      act(() => harness.hook().clear(THREAD_ID));

      await act(async () => {
        if (settlement === "resolve") pending.resolve(harness.environment.status);
        else pending.reject(new Error("late status failure"));
        await loading;
      });

      expect(harness.summary()).toBeNull();
      expect(harness.reportError).not.toHaveBeenCalled();
      harness.unmount();
    },
  );
});
