// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentThread } from "../domain/agentThread";
import type { GitChangedFile } from "../domain/git";
import type { ResolvedGitRepository } from "../domain/gitRepositoryMapping";
import { waitForReact } from "../test/reactTestLifecycle";
import {
  DELETED_FILE_REASON,
  EDITOR_UNAVAILABLE_REASON,
  PROJECT_CLOSED_REASON,
  SWITCH_TAB_REASON,
  useAgentEditorBridge,
  type AgentEditorBridgeDependencies,
  type AgentEditorBridgePort,
  type AgentEditorBridgeSurface,
} from "./useAgentEditorBridge";

const ROOT_KEY = "/workspace/app";
const OWNER_ID = "agent-root:0123456789abcdef";
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
  withEditor: boolean;
}

function renderBridge(overrides: Partial<Environment> = {}) {
  const environment: Environment = {
    projects: [project()],
    threads: new Map([[THREAD_ID, thread()]]),
    withEditor: true,
    ...overrides,
  };
  const editor = {
    openFile: vi.fn(async () => true),
    openGitChange: vi.fn(async () => undefined),
    leaveAgentMode: vi.fn(),
  } satisfies AgentEditorBridgePort;
  const reportError = vi.fn();

  const dependencies = (): AgentEditorBridgeDependencies => ({
    projects: environment.projects,
    threads: environment.threads,
    editor: environment.withEditor ? editor : null,
    reportError,
  });

  const host = document.createElement("div");
  const root = createRoot(host);
  const captured: { value: AgentEditorBridgeSurface | null } = { value: null };

  function Harness(props: { readonly dependencies: AgentEditorBridgeDependencies }) {
    captured.value = useAgentEditorBridge(props.dependencies);
    return null;
  }

  const render = () => act(() => root.render(<Harness dependencies={dependencies()} />));
  render();

  return {
    editor,
    reportError,
    hook: () => captured.value as AgentEditorBridgeSurface,
    set: (next: Partial<Environment>) => {
      Object.assign(environment, next);
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

describe("useAgentEditorBridge", () => {
  it("opens a changed file pinned in the editor and leaves agent mode", async () => {
    const harness = renderBridge();
    expect(harness.hook().canOpenInEditor(THREAD_ID)).toEqual({ kind: "available" });

    await act(() => harness.hook().openChangedFile(THREAD_ID, change()));

    expect(harness.editor.openFile).toHaveBeenCalledWith(
      { name: "parser.ts", path: `${WORKTREE}/src/parser.ts`, kind: "file" },
      { pin: true, recordNavigation: true },
    );
    expect(harness.editor.leaveAgentMode).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("opens the diff against the worktree root and leaves agent mode", async () => {
    const harness = renderBridge();
    await act(() => harness.hook().openChangedFileDiff(THREAD_ID, change({ status: "deleted" })));
    expect(harness.editor.openGitChange).toHaveBeenCalledWith(
      change({ status: "deleted" }),
      WORKTREE,
    );
    expect(harness.editor.leaveAgentMode).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("uses the repository root for in-place threads", async () => {
    const harness = renderBridge({
      threads: new Map([
        [THREAD_ID, thread({ target: { isolation: "in-place", worktreePath: null } })],
      ]),
    });
    const inPlace = change({ path: `${ROOT_KEY}/src/parser.ts` });
    await act(() => harness.hook().openChangedFileDiff(THREAD_ID, inPlace));
    expect(harness.editor.openGitChange).toHaveBeenCalledWith(inPlace, ROOT_KEY);
    harness.unmount();
  });

  it("blocks background-tab projects, closed projects and a missing editor", async () => {
    const harness = renderBridge({ projects: [project({ origin: "background-tab" })] });
    expect(harness.hook().canOpenInEditor(THREAD_ID)).toEqual({
      kind: "blocked",
      reason: SWITCH_TAB_REASON,
    });
    await act(() => harness.hook().openChangedFile(THREAD_ID, change()));
    await act(() => harness.hook().openChangedFileDiff(THREAD_ID, change()));
    expect(harness.editor.openFile).not.toHaveBeenCalled();
    expect(harness.editor.openGitChange).not.toHaveBeenCalled();

    harness.set({ projects: [] });
    expect(harness.hook().canOpenInEditor(THREAD_ID)).toEqual({
      kind: "blocked",
      reason: PROJECT_CLOSED_REASON,
    });

    harness.set({ projects: [project()], withEditor: false });
    expect(harness.hook().canOpenInEditor(THREAD_ID)).toEqual({
      kind: "blocked",
      reason: EDITOR_UNAVAILABLE_REASON,
    });
    expect(DELETED_FILE_REASON).toContain("diff");
    harness.unmount();
  });

  it("refuses to open a deleted file or a path outside the checkout", async () => {
    const harness = renderBridge();
    await act(() => harness.hook().openChangedFile(THREAD_ID, change({ status: "deleted" })));
    await act(() =>
      harness.hook().openChangedFile(THREAD_ID, change({ path: `${ROOT_KEY}/src/parser.ts` })),
    );
    await act(() =>
      harness.hook().openChangedFile(THREAD_ID, change({ path: `${WORKTREE}/../secret.ts` })),
    );
    expect(harness.editor.openFile).not.toHaveBeenCalled();
    expect(harness.editor.leaveAgentMode).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("stays in agent mode when the owner changed while the file was opening", async () => {
    let release: (value: boolean) => void = () => undefined;
    const harness = renderBridge();
    harness.editor.openFile.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const pending = harness.hook().openChangedFile(THREAD_ID, change());
    await waitForReact(() => expect(harness.editor.openFile).toHaveBeenCalledTimes(1));
    harness.set({ projects: [project({ generation: 2 })] });
    await act(async () => {
      release(true);
      await pending;
    });
    expect(harness.editor.leaveAgentMode).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("stays in agent mode when the editor refused the file or threw", async () => {
    const harness = renderBridge();
    harness.editor.openFile.mockResolvedValueOnce(false);
    await act(() => harness.hook().openChangedFile(THREAD_ID, change()));
    harness.editor.openFile.mockRejectedValueOnce(new Error("boom"));
    await act(() => harness.hook().openChangedFile(THREAD_ID, change()));
    expect(harness.editor.leaveAgentMode).not.toHaveBeenCalled();
    expect(harness.reportError).toHaveBeenCalledTimes(1);
    harness.unmount();
  });
});
