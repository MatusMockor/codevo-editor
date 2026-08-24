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
  MAX_AGENT_TASK_DIFF_SIDE_BYTES,
  useAgentChangeSummary,
  type AgentChangeSummaryDependencies,
  type AgentChangeSummarySurface,
} from "./useAgentChangeSummary";

const ROOT_KEY = "/workspace/app";
const OWNER_ID = "agent-root:0123456789abcdef";
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
    ...overrides,
  };
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
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
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

  it("drops the summary when the project stops owning the repository", async () => {
    const pending = deferred<GitStatus>();
    const harness = renderChangeSummary();
    harness.gitGateway.getStatus.mockImplementationOnce(async () => pending.promise);

    let showing: Promise<void> = Promise.resolve();
    act(() => {
      showing = harness.hook().showChanges(THREAD_ID);
    });
    harness.set({ projects: [project({ generation: 2 })] });

    await act(async () => {
      pending.resolve(gitStatus([changedFile("src/app.ts")]));
      await showing;
    });

    expect(harness.summary()?.loading).toBe(false);
    expect(harness.summary()?.error).toBe(
      "This project no longer owns the repository, so its changes could not be read.",
    );
    expect(harness.summary()?.files).toEqual([]);
    harness.unmount();
  });

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
});
