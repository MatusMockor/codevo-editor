// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTaskRecord, AgentTaskStatus } from "../domain/agentTask";
import type { GitChangedFile } from "../domain/git";
import type { ResolvedGitRepository } from "../domain/gitRepositoryMapping";
import {
  MAX_AGENT_TASK_CHANGE_ROWS,
  type AgentTaskChangeSummary,
  type AgentTaskView,
  type AgentTasksSurface,
} from "../application/useAgentTasks";
import { AgentsPanel, type AgentsPanelProps } from "./AgentsPanel";

const WORKSPACE_ROOT = "/workspace/app";
const PRIMARY_ROOT = "/workspace/app";
const NESTED_ROOT = "/workspace/app/packages/api";
const WORKTREE_PATH = "/workspace/app/.worktrees/agt-1";

describe("AgentsPanel", () => {
  let host: HTMLDivElement;
  let root: Root;
  let props: AgentsPanelProps;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    props = defaultProps();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders the concurrency summary and an empty task list", () => {
    render();

    expect(host.textContent).toContain("Agents");
    expect(host.textContent).toContain("0 of 4 running");
    expect(host.textContent).toContain("No agent has been started in this workspace yet.");
  });

  it("lists every resolved repository by display name", () => {
    render();

    expect(optionLabels()).toEqual(["app", "packages/api"]);
  });

  it("pre-sets the isolation checkbox from the recommended default and explains why", () => {
    rerender({
      agents: surface({
        isolationPreview: () => ({
          repositoryRoot: PRIMARY_ROOT,
          recommended: { kind: "worktree", reason: "dirty-tree" },
          inPlaceGuard: { kind: "unsafe", reasons: ["dirty-tree"] },
        }),
      }),
    });

    expect(checkbox("agent-isolation").checked).toBe(true);
    expect(host.textContent).toContain("The working tree has uncommitted changes.");
  });

  it("pre-sets the isolation checkbox off for a clean repository", () => {
    render();

    expect(checkbox("agent-isolation").checked).toBe(false);
    expect(host.textContent).toContain("The repository is clean");
    expect(host.textContent).not.toContain("Running in place can overwrite your work");
  });

  it("counts the prompt in UTF-8 bytes", async () => {
    render();

    await type("agent-prompt", "héllo");

    expect(host.textContent).toContain("6 of 32768 bytes");
  });

  it("dispatches a safe in-place prompt for the selected repository", async () => {
    const dispatch = vi.fn(async () => true);
    rerender({ agents: surface({ dispatch }) });

    await selectValue("agent-repository", NESTED_ROOT);
    await type("agent-prompt", "Update the router");
    await submit();

    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      repositoryRoot: NESTED_ROOT,
      prompt: "Update the router",
      isolation: "in-place",
      unsafeInPlaceConfirmed: false,
    });
    expect(textarea("agent-prompt").value).toBe("");
  });

  it("keeps the prompt when the dispatch is refused", async () => {
    rerender({ agents: surface({ dispatch: vi.fn(async () => false) }) });

    await type("agent-prompt", "Update the router");
    await submit();

    expect(textarea("agent-prompt").value).toBe("Update the router");
  });

  it("requires an explicit confirmation before an unsafe in-place dispatch", async () => {
    const dispatch = vi.fn(async () => true);
    rerender({
      agents: surface({
        dispatch,
        isolationPreview: () => ({
          repositoryRoot: PRIMARY_ROOT,
          recommended: { kind: "worktree", reason: "dirty-editors" },
          inPlaceGuard: { kind: "unsafe", reasons: ["dirty-tree", "dirty-editors"] },
        }),
      }),
    });

    await type("agent-prompt", "Rename the module");
    await check("agent-isolation", false);

    expect(host.textContent).toContain("Running in place can overwrite your work");
    expect(host.textContent).toContain("the working tree has uncommitted changes");
    expect(host.textContent).toContain("unsaved editors belong to this repository");
    expect(submitButton().disabled).toBe(true);

    await check("agent-unsafe-confirm", true);

    expect(submitButton().disabled).toBe(false);

    await submit();

    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      repositoryRoot: PRIMARY_ROOT,
      prompt: "Rename the module",
      isolation: "in-place",
      unsafeInPlaceConfirmed: true,
    });
  });

  it("blocks submission while the prompt is empty and while a dispatch is in flight", async () => {
    render();
    expect(submitButton().disabled).toBe(true);

    await type("agent-prompt", "Update the router");
    expect(submitButton().disabled).toBe(false);

    rerender({ agents: surface({ dispatching: true }) });

    expect(submitButton().disabled).toBe(true);
    expect(host.textContent).toContain("Starting…");
  });

  it("shows a notice with a settings action and dismisses it", async () => {
    const configureAgentCli = vi.fn();
    const dismissNotice = vi.fn();
    rerender({
      agents: surface({
        configureAgentCli,
        dismissNotice,
        notice: {
          kind: "warning",
          message: "No agent CLI is configured. Set the agent CLI path in settings.",
          action: "configure-agent-cli",
        },
      }),
    });

    expect(host.querySelector('[role="status"]')?.textContent).toContain("No agent CLI");

    await click("Open agent settings");
    await click("Dismiss agent notice");

    expect(configureAgentCli).toHaveBeenCalledTimes(1);
    expect(dismissNotice).toHaveBeenCalledTimes(1);
  });

  it("renders a running worktree task with its badges, path, and output tail", () => {
    const view = taskView({ status: { kind: "running" }, outputTail: "reading files" });
    rerender({ agents: surface({ tasks: [view], liveTaskCount: 1 }) });

    expect(host.textContent).toContain("Running");
    expect(host.textContent).toContain("Worktree");
    expect(host.textContent).toContain(WORKTREE_PATH);
    expect(host.textContent).toContain("reading files");
    expect(button("Stop agent agt-1")).not.toBeNull();
    expect(host.querySelector('button[aria-label="Dismiss agent agt-1"]')).toBeNull();
  });

  it("labels a dropped output tail", () => {
    rerender({
      agents: surface({ tasks: [taskView({ outputTruncated: true, outputTail: "tail" })] }),
    });

    expect(host.textContent).toContain("Earlier output was dropped to bound memory.");
  });

  it("labels an empty output tail", () => {
    rerender({ agents: surface({ tasks: [taskView({})] }) });

    expect(host.textContent).toContain("No output yet.");
  });

  it("renders a failed exit code and an in-place badge", () => {
    rerender({
      agents: surface({
        tasks: [
          {
            ...taskView({ status: { kind: "exited", exitCode: 2 } }),
            terminal: true,
            record: {
              ...taskView({ status: { kind: "exited", exitCode: 2 } }).record,
              isolation: "in-place",
              worktreePath: null,
            },
          },
        ],
      }),
    });

    expect(host.textContent).toContain("Exited 2");
    expect(host.textContent).toContain("In place");
    expect(host.textContent).not.toContain("Show changes");
  });

  it("renders the failure message of a failed task", () => {
    rerender({
      agents: surface({
        tasks: [
          {
            ...taskView({
              status: { kind: "failed", message: "agent task exceeded maximum runtime" },
            }),
            terminal: true,
          },
        ],
      }),
    });

    expect(host.textContent).toContain("Failed");
    expect(host.textContent).toContain("agent task exceeded maximum runtime");
  });

  it("renders orphaned worktrees with remove and prune actions", async () => {
    const removeOrphanedWorktree = vi.fn(async () => undefined);
    const pruneOrphanedWorktrees = vi.fn(async () => undefined);
    const removablePath = `${PRIMARY_ROOT}/.worktrees/agt-orphan`;
    const prunablePath = `${PRIMARY_ROOT}/.worktrees/agt-stale`;
    rerender({
      agents: surface({
        removeOrphanedWorktree,
        pruneOrphanedWorktrees,
        orphanedWorktrees: [
          {
            repositoryRoot: PRIMARY_ROOT,
            worktreePath: removablePath,
            branch: "agent/agt-orphan",
            prunable: false,
            removing: false,
          },
          {
            repositoryRoot: PRIMARY_ROOT,
            worktreePath: prunablePath,
            branch: null,
            prunable: true,
            removing: false,
          },
        ],
      }),
    });

    expect(host.textContent).toContain("Orphaned worktrees");
    expect(host.textContent).toContain(removablePath);
    expect(host.textContent).toContain("agent/agt-orphan");
    await click(`Remove orphaned worktree ${removablePath}`);
    await click(`Prune stale worktrees for ${PRIMARY_ROOT}`);

    expect(removeOrphanedWorktree).toHaveBeenCalledExactlyOnceWith(removablePath);
    expect(pruneOrphanedWorktrees).toHaveBeenCalledExactlyOnceWith(PRIMARY_ROOT);
  });

  it("hides the orphaned worktree section when there are no orphans", () => {
    render();

    expect(host.textContent).not.toContain("Orphaned worktrees");
  });

  it("stops a live task and dismisses a terminal task", async () => {
    const stop = vi.fn(async () => undefined);
    const dismiss = vi.fn();
    rerender({
      agents: surface({ stop, dismiss, tasks: [taskView({ status: { kind: "running" } })] }),
    });

    await click("Stop agent agt-1");
    rerender({
      agents: surface({
        stop,
        dismiss,
        tasks: [{ ...taskView({ status: { kind: "stopped" } }), terminal: true }],
      }),
    });
    await click("Dismiss agent agt-1");

    expect(stop).toHaveBeenCalledExactlyOnceWith("agt-1");
    expect(dismiss).toHaveBeenCalledExactlyOnceWith("agt-1");
  });

  it("offers change review only for a terminal worktree task", async () => {
    const showChanges = vi.fn(async () => undefined);
    rerender({
      agents: surface({
        showChanges,
        tasks: [{ ...taskView({ status: { kind: "exited", exitCode: 0 } }), terminal: true }],
      }),
    });

    expect(host.textContent).toContain("Finished");
    await click("Show changes for agent agt-1");

    expect(showChanges).toHaveBeenCalledExactlyOnceWith("agt-1");
  });

  it("renders a bounded change list with its truncation label", () => {
    rerender({
      agents: surface({
        tasks: [
          {
            ...taskView({ status: { kind: "exited", exitCode: 0 } }),
            terminal: true,
            changeSummary: summary({
              files: [changedFile("src/app.ts"), changedFile("src/new.ts", "added")],
              truncated: true,
            }),
          },
        ],
      }),
    });

    expect(host.textContent).toContain("src/app.ts");
    expect(host.textContent).toContain("src/new.ts");
    expect(host.textContent).toContain(
      `Only the first ${MAX_AGENT_TASK_CHANGE_ROWS} changed files are listed.`,
    );
  });

  it("opens a bounded per-file diff and labels each truncated side", async () => {
    const showFileDiff = vi.fn(async () => undefined);
    const hideFileDiff = vi.fn();
    const file = changedFile("src/app.ts");
    rerender({
      agents: surface({
        showFileDiff,
        hideFileDiff,
        tasks: [
          {
            ...taskView({ status: { kind: "exited", exitCode: 0 } }),
            terminal: true,
            changeSummary: summary({ files: [file] }),
          },
        ],
      }),
    });

    await clickText("src/app.ts");
    expect(showFileDiff).toHaveBeenCalledExactlyOnceWith("agt-1", file);

    rerender({
      agents: surface({
        showFileDiff,
        hideFileDiff,
        tasks: [
          {
            ...taskView({ status: { kind: "exited", exitCode: 0 } }),
            terminal: true,
            changeSummary: summary({
              files: [file],
              diff: {
                relativePath: "src/app.ts",
                loading: false,
                error: null,
                original: { text: "before", truncated: true },
                modified: { text: "after", truncated: false },
                unavailableReason: null,
              },
            }),
          },
        ],
      }),
    });

    expect(host.textContent).toContain("Before");
    expect(host.textContent).toContain("before");
    expect(host.textContent).toContain("after");
    expect(host.textContent).toContain("This side was truncated to stay bounded.");

    await click("Close file diff");

    expect(hideFileDiff).toHaveBeenCalledExactlyOnceWith("agt-1");
  });

  it("explains a binary file instead of rendering content", () => {
    rerender({
      agents: surface({
        tasks: [
          {
            ...taskView({ status: { kind: "exited", exitCode: 0 } }),
            terminal: true,
            changeSummary: summary({
              files: [changedFile("assets/logo.png")],
              diff: {
                relativePath: "assets/logo.png",
                loading: false,
                error: null,
                original: { text: "", truncated: false },
                modified: { text: "", truncated: false },
                unavailableReason: "binary",
              },
            }),
          },
        ],
      }),
    });

    expect(host.textContent).toContain("This file is binary, so no text diff is shown.");
    expect(host.textContent).not.toContain("Empty file.");
  });

  it("removes the worktree and reports the removed state", async () => {
    const removeWorktree = vi.fn(async () => undefined);
    rerender({
      agents: surface({
        removeWorktree,
        tasks: [{ ...taskView({ status: { kind: "exited", exitCode: 0 } }), terminal: true }],
      }),
    });

    await click("Remove worktree for agent agt-1");
    expect(removeWorktree).toHaveBeenCalledExactlyOnceWith("agt-1");

    rerender({
      agents: surface({
        removeWorktree,
        tasks: [
          {
            ...taskView({ status: { kind: "exited", exitCode: 0 } }),
            terminal: true,
            worktreeRemoved: true,
          },
        ],
      }),
    });

    expect(host.textContent).toContain("The worktree was removed. Its branch was kept.");
    expect(host.querySelector('button[aria-label="Show changes for agent agt-1"]')).toBeNull();
  });

  it("surfaces a change read failure", () => {
    rerender({
      agents: surface({
        tasks: [
          {
            ...taskView({ status: { kind: "failed", message: "spawn failed" } }),
            terminal: true,
            changeSummary: summary({ error: "The worktree changes could not be read." }),
          },
        ],
      }),
    });

    expect(host.textContent).toContain("Failed");
    expect(host.textContent).toContain("The worktree changes could not be read.");
  });

  function render() {
    act(() => root.render(<AgentsPanel {...props} />));
  }

  function rerender(next: Partial<AgentsPanelProps>) {
    props = { ...props, ...next };
    render();
  }

  function button(label: string): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  }

  function submitButton(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(element).not.toBeNull();
    return element as HTMLButtonElement;
  }

  function textarea(id: string): HTMLTextAreaElement {
    const element = host.querySelector<HTMLTextAreaElement>(`textarea#${id}`);
    expect(element).not.toBeNull();
    return element as HTMLTextAreaElement;
  }

  function checkbox(id: string): HTMLInputElement {
    const element = host.querySelector<HTMLInputElement>(`input#${id}`);
    expect(element).not.toBeNull();
    return element as HTMLInputElement;
  }

  function optionLabels(): string[] {
    return [...host.querySelectorAll("option")].map((option) => option.textContent ?? "");
  }

  async function type(id: string, value: string) {
    const element = textarea(id);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        element,
        value,
      );
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function selectValue(id: string, value: string) {
    const element = host.querySelector<HTMLSelectElement>(`select#${id}`);
    expect(element).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
        element,
        value,
      );
      element?.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  async function check(id: string, checked: boolean) {
    const element = checkbox(id);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set?.call(
        element,
        checked,
      );
      element.dispatchEvent(new Event("click", { bubbles: true }));
    });
  }

  async function submit() {
    const form = host.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }

  async function click(label: string) {
    const element = button(label);
    expect(element).not.toBeNull();
    await act(async () => element?.click());
  }

  async function clickText(text: string) {
    const element = [...host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === text,
    );
    expect(element).toBeDefined();
    await act(async () => element?.click());
  }
});

function defaultProps(): AgentsPanelProps {
  return {
    agents: surface({}),
    repositories: [repository(PRIMARY_ROOT, ""), repository(NESTED_ROOT, "packages/api")],
    workspaceRoot: WORKSPACE_ROOT,
  };
}

function surface(overrides: Partial<AgentTasksSurface>): AgentTasksSurface {
  return {
    tasks: [],
    repositories: [repository(PRIMARY_ROOT, ""), repository(NESTED_ROOT, "packages/api")],
    orphanedWorktrees: [],
    notice: null,
    dispatching: false,
    agentCliConfigured: true,
    liveTaskCount: 0,
    maxConcurrentAgentTasks: 4,
    isolationPreview: (repositoryRoot: string) => ({
      repositoryRoot,
      recommended: { kind: "in-place" },
      inPlaceGuard: { kind: "safe" },
    }),
    dispatch: async () => true,
    stop: async () => undefined,
    dismiss: () => undefined,
    removeOrphanedWorktree: async () => undefined,
    pruneOrphanedWorktrees: async () => undefined,
    showChanges: async () => undefined,
    hideChanges: () => undefined,
    showFileDiff: async () => undefined,
    hideFileDiff: () => undefined,
    removeWorktree: async () => undefined,
    configureAgentCli: () => undefined,
    dismissNotice: () => undefined,
    ...overrides,
  };
}

function repository(repositoryRoot: string, rootRelativePath: string): ResolvedGitRepository {
  return { mapping: { rootRelativePath }, repositoryRoot, repositoryRelativePath: "" };
}

function taskView(overrides: {
  readonly status?: AgentTaskStatus;
  readonly outputTail?: string;
  readonly outputTruncated?: boolean;
}): AgentTaskView {
  const record: AgentTaskRecord = {
    owner: { taskId: "agt-1", workspaceId: "workspace-a", repositoryRoot: PRIMARY_ROOT },
    isolation: "worktree",
    worktreePath: WORKTREE_PATH,
    prompt: "Refactor the parser",
    status: overrides.status ?? { kind: "pending" },
    outputTail: overrides.outputTail ?? "",
    outputTruncated: overrides.outputTruncated ?? false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    startedAtEpochMs: 1_700_000_000_000,
  };
  return {
    record,
    repositoryLabel: "app",
    terminal: false,
    worktreeRemoved: false,
    changeSummary: null,
  };
}

function summary(overrides: Partial<AgentTaskChangeSummary>): AgentTaskChangeSummary {
  return {
    loading: false,
    error: null,
    files: [],
    truncated: false,
    removing: false,
    diff: null,
    ...overrides,
  };
}

function changedFile(relativePath: string, status: GitChangedFile["status"] = "modified") {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: `${WORKTREE_PATH}/${relativePath}`,
    relativePath,
    status,
  };
}
