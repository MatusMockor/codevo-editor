// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTaskView, AgentTasksSurface } from "../../application/useAgentTasks";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentTaskRecord } from "../../domain/agentTask";
import type { ResolvedGitRepository } from "../../domain/gitRepositoryMapping";
import { agentThreadPinStorageKey } from "../../application/useAgentThreadPins";
import { AgentModeView, type AgentModeViewProps } from "./AgentModeView";

const ROOT = "/workspace/app";
const NESTED = "/workspace/app/packages/api";
const OTHER_ROOT = "/workspace/api-service";
const NOW_TICK_MS = 3_600_000;

describe("AgentModeView", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders the three columns of the threads layout", () => {
    render();

    expect(host.querySelector('section[aria-label="Agent mode"]')).not.toBeNull();
    expect(host.querySelector('aside[aria-label="Agent threads"]')).not.toBeNull();
    expect(host.querySelector('section[aria-label="New agent thread"]')).not.toBeNull();
    expect(host.querySelector('aside[aria-label="Agent thread details"]')).not.toBeNull();
    expect(host.querySelector('form[aria-label="New agent thread"]')).not.toBeNull();
  });

  it("surfaces the agent CLI notice with a settings deep link and a dismiss action", () => {
    const configureAgentCli = vi.fn();
    const dismissNotice = vi.fn();
    render({
      agents: surface({
        configureAgentCli,
        dismissNotice,
        notice: {
          kind: "error",
          message: "Set the agent CLI path in Settings.",
          action: "configure-agent-cli",
        },
      }),
    });

    expect(host.textContent).toContain("Set the agent CLI path in Settings.");
    click('[aria-label="Open agent settings"]');
    click('[aria-label="Dismiss agent notice"]');

    expect(configureAgentCli).toHaveBeenCalledTimes(1);
    expect(dismissNotice).toHaveBeenCalledTimes(1);
  });

  it("keeps a notice without a settings action free of the deep link", () => {
    render({
      agents: surface({
        notice: { kind: "warning", message: "The agent limit is reached.", action: null },
      }),
    });

    expect(host.textContent).toContain("The agent limit is reached.");
    expect(host.querySelector('[aria-label="Open agent settings"]')).toBeNull();
  });

  it("blocks the dispatch until the prompt has content", () => {
    render();

    expect(submitButton().disabled).toBe(true);

    typePrompt("Fix the parser");

    expect(submitButton().disabled).toBe(false);
  });

  it("dispatches the prompt with the recommended isolation of the selected repository", () => {
    const dispatch = vi.fn(async () => ({ taskId: "agt-new" }));
    render({
      agents: surface({
        dispatch,
        isolationPreview: (repositoryRoot: string) => ({
          repositoryRoot,
          recommended: { kind: "worktree", reason: "dirty-tree" },
          inPlaceGuard: { kind: "unsafe", reasons: ["dirty-tree"] },
          inPlaceAllowed: true,
          confirmationKey: "dirty-preview-key",
        }),
      }),
    });

    expect(host.textContent).toContain("The working tree has uncommitted changes.");

    typePrompt("Fix the parser");
    submitForm();

    expect(dispatch).toHaveBeenCalledWith({
      projectRootKey: ROOT,
      repositoryRoot: ROOT,
      prompt: "Fix the parser",
      isolation: "worktree",
      unsafeInPlaceConfirmationKey: null,
    });
  });

  it("blocks an unsafe in-place dispatch until it is confirmed", () => {
    const dispatch = vi.fn(async () => ({ taskId: "agt-new" }));
    render({
      agents: surface({
        dispatch,
        isolationPreview: (repositoryRoot: string) => ({
          repositoryRoot,
          recommended: { kind: "worktree", reason: "dirty-tree" },
          inPlaceGuard: { kind: "unsafe", reasons: ["dirty-tree"] },
          inPlaceAllowed: true,
          confirmationKey: "dirty-preview-key",
        }),
      }),
    });

    typePrompt("Fix the parser");
    toggleCheckbox("agent-isolation", false);

    expect(submitButton().disabled).toBe(true);

    toggleCheckbox("agent-unsafe-confirm", true);

    expect(submitButton().disabled).toBe(false);

    submitForm();

    expect(dispatch).toHaveBeenCalledWith({
      projectRootKey: ROOT,
      repositoryRoot: ROOT,
      prompt: "Fix the parser",
      isolation: "in-place",
      unsafeInPlaceConfirmationKey: "dirty-preview-key",
    });
  });

  it("dispatches into the repository chosen in the composer", () => {
    const dispatch = vi.fn(async () => ({ taskId: "agt-new" }));
    render({ agents: surface({ dispatch }) });

    selectRepository(NESTED);
    typePrompt("Update the router");
    submitForm();

    expect(dispatch).toHaveBeenCalledWith({
      projectRootKey: ROOT,
      repositoryRoot: NESTED,
      prompt: "Update the router",
      isolation: "in-place",
      unsafeInPlaceConfirmationKey: null,
    });
  });

  it("clears the prompt and opens the created thread after a dispatch", async () => {
    const dispatch = vi.fn(async () => ({ taskId: "agt-1" }));
    render({ agents: surface({ dispatch }) });

    typePrompt("Fix the parser");
    await submitFormAsync();

    expect(promptField().value).toBe("");

    render({ agents: surface({ dispatch, tasks: [taskView("agt-1", ROOT)] }) });

    expect(host.querySelector('section[aria-label="Agent thread agt-1"]')).not.toBeNull();
    expect(host.querySelector('[aria-current="true"]')).not.toBeNull();
  });

  it("keeps the prompt when the dispatch is refused", async () => {
    const dispatch = vi.fn(async () => null);
    render({ agents: surface({ dispatch }) });

    typePrompt("Fix the parser");
    await submitFormAsync();

    expect(promptField().value).toBe("Fix the parser");
  });

  it("opens only the exact dispatched thread when another unknown thread arrives concurrently", async () => {
    let resolveDispatch: ((result: { readonly taskId: string }) => void) | null = null;
    const dispatch = vi.fn(
      () =>
        new Promise<{ readonly taskId: string }>((resolve) => {
          resolveDispatch = resolve;
        }),
    );
    render({ agents: surface({ dispatch, tasks: [taskView("agt-existing", ROOT)] }) });

    typePrompt("Fix the parser");
    submitForm();
    render({
      agents: surface({
        dispatch,
        tasks: [
          taskView("agt-existing", ROOT),
          taskView("agt-recovered-foreign", ROOT),
          taskView("agt-dispatched", ROOT),
        ],
      }),
    });

    await act(async () => {
      resolveDispatch?.({ taskId: "agt-dispatched" });
      await Promise.resolve();
    });

    expect(host.querySelector('section[aria-label="Agent thread agt-dispatched"]')).not.toBeNull();
    expect(
      host.querySelector('section[aria-label="Agent thread agt-recovered-foreign"]'),
    ).toBeNull();
  });

  it("opens a selected thread and returns to a new thread from the group affordance", () => {
    render({ agents: surface({ tasks: [taskView("agt-1", ROOT)] }) });

    clickText("Refactor the parser");

    expect(host.querySelector('section[aria-label="Agent thread agt-1"]')).not.toBeNull();

    clickText("+ New thread");

    expect(host.querySelector('section[aria-label="New agent thread"]')).not.toBeNull();
  });

  it("routes orphan recovery to the surface", () => {
    const removeOrphanedWorktree = vi.fn(async () => undefined);
    render({
      agents: surface({
        orphanedWorktrees: [
          {
            repositoryRoot: ROOT,
            worktreePath: `${ROOT}/.worktrees/agt-9`,
            branch: "agent/agt-9",
            prunable: false,
            removing: false,
          },
        ],
        removeOrphanedWorktree,
      }),
    });

    click(`[aria-label="Remove orphaned worktree ${ROOT}/.worktrees/agt-9"]`);

    expect(removeOrphanedWorktree).toHaveBeenCalledWith(`${ROOT}/.worktrees/agt-9`);
  });

  it("routes thread actions to the surface", () => {
    const stop = vi.fn(async () => undefined);
    render({ agents: surface({ stop, tasks: [taskView("agt-1", ROOT, { kind: "running" })] }) });

    clickText("Refactor the parser");
    click('[aria-label="Stop agent agt-1"]');

    expect(stop).toHaveBeenCalledWith("agt-1");
  });

  it("drops the selection when the thread is dismissed elsewhere", () => {
    render({ agents: surface({ tasks: [taskView("agt-1", ROOT)] }) });

    clickText("Refactor the parser");
    render({ agents: surface({ tasks: [] }) });

    expect(host.querySelector('section[aria-label="Agent thread agt-1"]')).toBeNull();
    expect(host.querySelector('section[aria-label="New agent thread"]')).not.toBeNull();
  });

  it("pins a thread to the top of its repository group and restores it after a remount", () => {
    const tasks = [taskView("agt-1", ROOT), taskView("agt-2", ROOT), taskView("agt-3", NESTED)];
    render({ agents: surface({ tasks }) });

    expect(threadOrder()).toEqual(["agt-1", "agt-2", "agt-3"]);

    click('[aria-label="Pin thread agt-2"]');

    expect(threadOrder()).toEqual(["agt-2", "agt-1", "agt-3"]);
    expect(window.localStorage.getItem(agentThreadPinStorageKey(ROOT))).toBe('["agt-2"]');

    act(() => root.unmount());
    root = createRoot(host);
    render({ agents: surface({ tasks }) });

    expect(threadOrder()).toEqual(["agt-2", "agt-1", "agt-3"]);
  });

  it("shares the pin state between the thread row and the details column", () => {
    render({ agents: surface({ tasks: [taskView("agt-1", ROOT)] }) });

    clickText("Refactor the parser");
    click('[aria-label="Pin agent agt-1"]');

    expect(host.querySelector('[aria-label="Unpin thread agt-1"]')).not.toBeNull();

    click('[aria-label="Unpin thread agt-1"]');

    expect(host.querySelector('[aria-label="Pin agent agt-1"]')).not.toBeNull();
    expect(window.localStorage.getItem(agentThreadPinStorageKey(ROOT))).toBeNull();
  });

  it("forgets the pin of a thread that was dismissed elsewhere", () => {
    render({ agents: surface({ tasks: [taskView("agt-1", ROOT), taskView("agt-2", ROOT)] }) });

    click('[aria-label="Pin thread agt-1"]');
    render({ agents: surface({ tasks: [taskView("agt-2", ROOT)] }) });

    expect(window.localStorage.getItem(agentThreadPinStorageKey(ROOT))).toBeNull();
    expect(threadOrder()).toEqual(["agt-2"]);
  });

  it("renders one project section per registered root and keeps the active tab first", () => {
    render({ projects: [activeProject(), backgroundProject()] });

    expect(host.querySelector('section[aria-label="Project app"]')).not.toBeNull();
    expect(host.querySelector('section[aria-label="Project api-service"]')).not.toBeNull();
    expect(
      [...host.querySelectorAll(".agent-project__name")].map((element) => element.textContent),
    ).toEqual(["app", "api-service"]);
  });

  it("dispatches into the project chosen in the composer and forces its worktree rule", async () => {
    const dispatch = vi.fn(async () => ({ taskId: "agt-new" }));
    render({ agents: surface({ dispatch }), projects: [activeProject(), backgroundProject()] });

    selectProject(OTHER_ROOT);

    expect(checkbox("agent-isolation").disabled).toBe(true);
    expect(host.textContent).toContain("not the active tab");

    typePrompt("Fix the parser");
    await submitFormAsync();

    expect(dispatch).toHaveBeenCalledWith({
      projectRootKey: OTHER_ROOT,
      repositoryRoot: OTHER_ROOT,
      prompt: "Fix the parser",
      isolation: "worktree",
      unsafeInPlaceConfirmationKey: null,
    });
  });

  it("dispatches the active project without a project-level picker", async () => {
    const dispatch = vi.fn(async () => ({ taskId: "agt-new" }));
    render({ agents: surface({ dispatch }), projects: [activeProject()] });

    expect(host.querySelector("select#agent-project")).toBeNull();

    typePrompt("Fix the parser");
    await submitFormAsync();

    expect(dispatch).toHaveBeenCalledWith({
      projectRootKey: ROOT,
      repositoryRoot: ROOT,
      prompt: "Fix the parser",
      isolation: "in-place",
      unsafeInPlaceConfirmationKey: null,
    });
  });

  it("keeps an untrusted project out of the composer and routes its trust action", () => {
    const onTrustProject = vi.fn();
    render({
      onTrustProject,
      projects: [{ ...backgroundProject(), trust: "untrusted" }],
    });

    expect(host.textContent).toContain("This project is not trusted");
    expect(host.querySelector(".agent-composer__chip--empty")?.textContent).toBe("No project");
    expect(submitButton().disabled).toBe(true);

    click('[aria-label="Trust project api-service"]');

    expect(onTrustProject).toHaveBeenCalledWith(OTHER_ROOT);
  });

  it("keeps a closed-tab draining project out of the composer picker", () => {
    render({
      projects: [activeProject(), { ...backgroundProject(), origin: "closed-tab-live-tasks" }],
    });

    expect(host.querySelector("select#agent-project")).toBeNull();
    expect(host.querySelector('section[aria-label="Project api-service"]')).not.toBeNull();
  });

  it("shows no dispatch target when only a closed-tab draining project remains", () => {
    render({ projects: [{ ...backgroundProject(), origin: "closed-tab-live-tasks" }] });

    expect(host.querySelector(".agent-composer__chip--empty")?.textContent).toBe("No project");
    expect(submitButton().disabled).toBe(true);
  });

  it("releases a closed-tab project through the surface callback", () => {
    const onReleaseProject = vi.fn();
    render({
      onReleaseProject,
      projects: [{ ...backgroundProject(), origin: "closed-tab-live-tasks" }],
    });

    click('[aria-label="Release project api-service"]');

    expect(onReleaseProject).toHaveBeenCalledWith(OTHER_ROOT);
  });

  it("reports the roots beyond the project limit truthfully", () => {
    render({ overflowRootPaths: ["/workspace/nine"] });

    expect(host.querySelector(".agent-rail__overflow")?.textContent).toBe(
      "1 more project is not shown (limit 8)",
    );
  });

  function render(overrides: Partial<AgentModeViewProps> = {}): void {
    act(() => root.render(<AgentModeView {...defaultProps()} {...overrides} />));
  }

  function checkbox(id: string): HTMLInputElement {
    const element = host.querySelector<HTMLInputElement>(`input#${id}`);
    expect(element).not.toBeNull();
    return element ?? document.createElement("input");
  }

  function selectProject(value: string): void {
    const element = host.querySelector<HTMLSelectElement>("select#agent-project");
    expect(element).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
        element,
        value,
      );
      element?.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function threadOrder(): readonly string[] {
    return [...host.querySelectorAll(".agent-thread__pin")].map((element) =>
      (element.getAttribute("aria-label") ?? "").replace(/^(?:Un)?[Pp]in thread /, ""),
    );
  }

  function promptField(): HTMLTextAreaElement {
    const element = host.querySelector<HTMLTextAreaElement>("textarea#agent-prompt");
    expect(element).not.toBeNull();
    return element ?? document.createElement("textarea");
  }

  function submitButton(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }

  function typePrompt(value: string): void {
    const element = promptField();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        element,
        value,
      );
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function selectRepository(value: string): void {
    const element = host.querySelector<HTMLSelectElement>("select#agent-repository");
    expect(element).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
        element,
        value,
      );
      element?.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function toggleCheckbox(id: string, checked: boolean): void {
    const element = host.querySelector<HTMLInputElement>(`input#${id}`);
    expect(element).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set?.call(
        element,
        checked,
      );
      element?.dispatchEvent(new Event("click", { bubbles: true }));
    });
  }

  function submitForm(): void {
    const form = host.querySelector("form");
    expect(form).not.toBeNull();
    act(() => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }

  async function submitFormAsync(): Promise<void> {
    const form = host.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
  }

  function click(selector: string): void {
    const element = host.querySelector<HTMLElement>(selector);
    expect(element).not.toBeNull();
    act(() => element?.click());
  }

  function clickText(text: string): void {
    const element = [...host.querySelectorAll("button")].find((candidate) =>
      (candidate.textContent ?? "").includes(text),
    );
    expect(element).toBeDefined();
    act(() => element?.click());
  }
});

function defaultProps(): AgentModeViewProps {
  return {
    agents: surface({}),
    onReleaseProject: () => undefined,
    onTrustProject: () => undefined,
    overflowRootPaths: [],
    projects: [defaultActiveProject()],
    workspaceRoot: ROOT,
    nowTickMs: NOW_TICK_MS,
  };
}

function defaultActiveProject(): AgentProjectDescriptor {
  return {
    rootKey: ROOT,
    rootPath: ROOT,
    ownerId: "agent-root:app",
    label: "app",
    generation: 0,
    trust: "trusted",
    origin: "active-tab",
    repositories: [repository(ROOT, ""), repository(NESTED, "packages/api")],
    isolationPolicy: "auto",
    leaseToken: null,
  };
}

function activeProject(): AgentProjectDescriptor {
  return {
    rootKey: ROOT,
    rootPath: ROOT,
    ownerId: "agent-root:app",
    label: "app",
    generation: 0,
    trust: "trusted",
    origin: "active-tab",
    repositories: [repository(ROOT, "")],
    isolationPolicy: "auto",
    leaseToken: null,
  };
}

function backgroundProject(): AgentProjectDescriptor {
  return {
    rootKey: OTHER_ROOT,
    rootPath: OTHER_ROOT,
    ownerId: "agent-root:api-service",
    label: "api-service",
    generation: 0,
    trust: "trusted",
    origin: "background-tab",
    repositories: [repository(OTHER_ROOT, "")],
    isolationPolicy: "auto",
    leaseToken: 7,
  };
}

function surface(overrides: Partial<AgentTasksSurface>): AgentTasksSurface {
  return {
    tasks: [],
    repositories: [repository(ROOT, ""), repository(NESTED, "packages/api")],
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
      inPlaceAllowed: true,
      confirmationKey: null,
    }),
    refreshIsolationStatus: async () => undefined,
    dispatch: async () => ({ taskId: "agt-default" }),
    stop: async () => undefined,
    dismiss: () => undefined,
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
    configureAgentCli: () => undefined,
    dismissNotice: () => undefined,
    ...overrides,
  };
}

function repository(repositoryRoot: string, rootRelativePath: string): ResolvedGitRepository {
  return { mapping: { rootRelativePath }, repositoryRoot, repositoryRelativePath: "" };
}

function taskView(
  taskId: string,
  repositoryRoot: string,
  status: AgentTaskRecord["status"] = { kind: "exited", exitCode: 0 },
): AgentTaskView {
  return {
    record: {
      owner: { taskId, workspaceId: "agent-root:app", repositoryRoot },
      isolation: "worktree",
      worktreePath: `${repositoryRoot}/.worktrees/${taskId}`,
      prompt: "Refactor the parser",
      status,
      outputTail: "",
      outputTruncated: false,
      lastStatusSequence: 0,
      lastOutputSequence: 0,
      startedAtEpochMs: 1_700_000_000_000,
    },
    repositoryLabel: "app",
    terminal: status.kind !== "running" && status.kind !== "pending",
    worktreeRemoved: false,
    changeSummary: null,
  };
}
