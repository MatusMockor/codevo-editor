// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentThread } from "../domain/agentThread";
import type { GitChangedFile } from "../domain/git";
import type { ResolvedGitRepository } from "../domain/gitRepositoryMapping";
import {
  DELETED_FILE_REASON,
  FILE_NAVIGATION_UNAVAILABLE_REASON,
  PROJECT_CLOSED_REASON,
  SWITCH_TAB_REASON,
  useAgentFileNavigation,
  type AgentFileNavigationDependencies,
  type AgentFileNavigationPort,
  type AgentFileNavigationSurface,
} from "./useAgentFileNavigation";

const ROOT_KEY = "/workspace/app";
const OWNER_ID = "agent-root:0123456789abcdef";
const RUNTIME_OWNER_ID = "workspace-replaced";
const THREAD_ID = "agt-1-0a1b";
const WORKTREE = `${ROOT_KEY}/.worktrees/${THREAD_ID}`;

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
    repositories: [repository(ROOT_KEY)],
    isolationPolicy: "auto",
    leaseToken: null,
    ...overrides,
  };
}

function thread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    threadId: THREAD_ID,
    owner: { rootKey: ROOT_KEY, ownerId: OWNER_ID, repositoryRoot: ROOT_KEY },
    target: { isolation: "worktree", worktreePath: WORKTREE },
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

function change(overrides: Partial<GitChangedFile> = {}): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: `${WORKTREE}/src/parser.ts`,
    relativePath: "src/parser.ts",
    status: "modified",
    ...overrides,
  };
}

interface Environment {
  projects: ReadonlyArray<AgentProjectDescriptor>;
  threads: ReadonlyMap<string, AgentThread>;
  withNavigation: boolean;
}

function renderBridge(overrides: Partial<Environment> = {}) {
  const environment: Environment = {
    projects: [project()],
    threads: new Map([[THREAD_ID, thread()]]),
    withNavigation: true,
    ...overrides,
  };
  const navigation = {
    revealFile: vi.fn(),
    openSurface: vi.fn(),
  } satisfies AgentFileNavigationPort;
  const reportError = vi.fn();

  const dependencies = (): AgentFileNavigationDependencies => ({
    projects: environment.projects,
    threads: environment.threads,
    navigation: environment.withNavigation ? navigation : null,
    reportError,
  });

  const host = document.createElement("div");
  const root = createRoot(host);
  const captured: { value: AgentFileNavigationSurface | null } = { value: null };

  function Harness(props: { readonly dependencies: AgentFileNavigationDependencies }) {
    captured.value = useAgentFileNavigation(props.dependencies);
    return null;
  }

  const render = () => act(() => root.render(<Harness dependencies={dependencies()} />));
  render();

  return {
    navigation,
    reportError,
    hook: () => captured.value as AgentFileNavigationSurface,
    set: (next: Partial<Environment>) => {
      Object.assign(environment, next);
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

describe("useAgentFileNavigation", () => {
  it("reveals files for a retained runtime owner in the Files viewer", async () => {
    const runtimeThread = thread({
      owner: { rootKey: ROOT_KEY, ownerId: RUNTIME_OWNER_ID, repositoryRoot: ROOT_KEY },
    });
    const harness = renderBridge({
      projects: [project({ runtimeOwnerIds: [OWNER_ID, RUNTIME_OWNER_ID] })],
      threads: new Map([[THREAD_ID, runtimeThread]]),
    });
    await act(() => harness.hook().openChangedFile(THREAD_ID, change()));
    expect(harness.navigation.revealFile).toHaveBeenCalledExactlyOnceWith(
      `${WORKTREE}/src/parser.ts`,
    );
    harness.unmount();
  });

  it("reveals a changed file in the Files viewer without opening another surface", async () => {
    const harness = renderBridge();
    expect(harness.hook().canOpenFiles(THREAD_ID)).toEqual({ kind: "available" });

    await act(() => harness.hook().openChangedFile(THREAD_ID, change()));

    expect(harness.navigation.revealFile).toHaveBeenCalledExactlyOnceWith(
      `${WORKTREE}/src/parser.ts`,
    );
    expect(harness.navigation.openSurface).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("shows the Diff surface for a changed file diff, including deleted files", async () => {
    const harness = renderBridge();
    await act(() => harness.hook().openChangedFileDiff(THREAD_ID, change({ status: "deleted" })));
    expect(harness.navigation.openSurface).toHaveBeenCalledExactlyOnceWith("diff");
    expect(harness.navigation.revealFile).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("uses the repository root for in-place threads", async () => {
    const harness = renderBridge({
      threads: new Map([
        [THREAD_ID, thread({ target: { isolation: "in-place", worktreePath: null } })],
      ]),
    });
    const inPlace = change({ path: `${ROOT_KEY}/src/parser.ts` });
    await act(() => harness.hook().openChangedFile(THREAD_ID, inPlace));
    await act(() => harness.hook().openChangedFile(THREAD_ID, change({ path: "/elsewhere/a.ts" })));
    expect(harness.navigation.revealFile).toHaveBeenCalledExactlyOnceWith(
      `${ROOT_KEY}/src/parser.ts`,
    );
    harness.unmount();
  });

  it("blocks background-tab projects, closed projects and a missing port", async () => {
    const harness = renderBridge({ projects: [project({ origin: "background-tab" })] });
    expect(harness.hook().canOpenFiles(THREAD_ID)).toEqual({
      kind: "blocked",
      reason: SWITCH_TAB_REASON,
    });
    await act(() => harness.hook().openChangedFile(THREAD_ID, change()));
    await act(() => harness.hook().openChangedFileDiff(THREAD_ID, change()));
    expect(harness.navigation.revealFile).not.toHaveBeenCalled();
    expect(harness.navigation.openSurface).not.toHaveBeenCalled();

    harness.set({ projects: [] });
    expect(harness.hook().canOpenFiles(THREAD_ID)).toEqual({
      kind: "blocked",
      reason: PROJECT_CLOSED_REASON,
    });

    harness.set({ projects: [project()], withNavigation: false });
    expect(harness.hook().canOpenFiles(THREAD_ID)).toEqual({
      kind: "blocked",
      reason: FILE_NAVIGATION_UNAVAILABLE_REASON,
    });
    expect(DELETED_FILE_REASON).toContain("diff");
    harness.unmount();
  });

  it("refuses to reveal a deleted file or a path outside the checkout", async () => {
    const harness = renderBridge();
    await act(() => harness.hook().openChangedFile(THREAD_ID, change({ status: "deleted" })));
    await act(() =>
      harness.hook().openChangedFile(THREAD_ID, change({ path: `${ROOT_KEY}/src/parser.ts` })),
    );
    await act(() =>
      harness.hook().openChangedFile(THREAD_ID, change({ path: `${WORKTREE}/../secret.ts` })),
    );
    await act(() =>
      harness.hook().openChangedFileDiff(THREAD_ID, change({ path: `${WORKTREE}/../secret.ts` })),
    );
    expect(harness.navigation.revealFile).not.toHaveBeenCalled();
    expect(harness.navigation.openSurface).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("drops a stale reveal or diff request for workspace A after switching A to B to A", async () => {
    const otherRoot = "/workspace/other";
    const projectB = project({
      rootKey: otherRoot,
      rootPath: otherRoot,
      ownerId: "agent-root:fedcba9876543210",
      repositories: [repository(otherRoot)],
    });
    const harness = renderBridge({ projects: [project(), projectB] });
    const capturedInA = harness.hook();

    harness.set({
      projects: [project({ origin: "background-tab" }), { ...projectB, origin: "active-tab" }],
    });
    await act(() => capturedInA.openChangedFile(THREAD_ID, change()));
    await act(() => capturedInA.openChangedFileDiff(THREAD_ID, change()));
    expect(harness.navigation.revealFile).not.toHaveBeenCalled();
    expect(harness.navigation.openSurface).not.toHaveBeenCalled();

    harness.set({
      projects: [project({ generation: 2 }), { ...projectB, origin: "background-tab" }],
    });
    await act(() => harness.hook().openChangedFileDiff(THREAD_ID, change()));
    expect(harness.navigation.openSurface).toHaveBeenCalledExactlyOnceWith("diff");
    expect(harness.navigation.revealFile).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("reads the current projects at call time, not the ones captured by a stale callback", async () => {
    const harness = renderBridge();
    const stale = harness.hook();
    harness.set({ projects: [project({ origin: "background-tab" })] });

    await act(() => stale.openChangedFile(THREAD_ID, change()));

    expect(harness.navigation.revealFile).not.toHaveBeenCalled();
    harness.unmount();
  });
});
