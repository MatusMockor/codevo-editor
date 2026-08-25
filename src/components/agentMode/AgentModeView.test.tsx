// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadsSurface, AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentProjectDescriptor, AgentProjectOrigin } from "../../domain/agentProject";
import type { AgentCliKind } from "../../domain/agentTask";
import type { AgentShipState } from "../../domain/agentShip";
import type { AgentThread, AgentTurn, AgentTurnStatus } from "../../domain/agentThread";
import type { ResolvedGitRepository } from "../../domain/gitRepositoryMapping";
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

  it("starts a thread with the recommended isolation of the selected repository", () => {
    const startThread = vi.fn(async () => ({ threadId: "agt-new" }));
    render({
      agents: surface({
        startThread,
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

    expect(startThread).toHaveBeenCalledWith({
      projectRootKey: ROOT,
      repositoryRoot: ROOT,
      prompt: "Fix the parser",
      isolation: "worktree",
      unsafeInPlaceConfirmationKey: null,
    });
  });

  it("blocks an unsafe in-place start until it is confirmed", () => {
    const startThread = vi.fn(async () => ({ threadId: "agt-new" }));
    render({
      agents: surface({
        startThread,
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

    expect(startThread).toHaveBeenCalledWith({
      projectRootKey: ROOT,
      repositoryRoot: ROOT,
      prompt: "Fix the parser",
      isolation: "in-place",
      unsafeInPlaceConfirmationKey: "dirty-preview-key",
    });
  });

  it("starts a thread in the repository chosen in the composer", () => {
    const startThread = vi.fn(async () => ({ threadId: "agt-new" }));
    render({ agents: surface({ startThread }) });

    selectRepository(NESTED);
    typePrompt("Update the router");
    submitForm();

    expect(startThread).toHaveBeenCalledWith({
      projectRootKey: ROOT,
      repositoryRoot: NESTED,
      prompt: "Update the router",
      isolation: "in-place",
      unsafeInPlaceConfirmationKey: null,
    });
  });

  it("clears the prompt and opens the created thread after a start", async () => {
    const startThread = vi.fn(async () => ({ threadId: "agt-1" }));
    render({ agents: surface({ startThread }) });

    typePrompt("Fix the parser");
    await submitFormAsync();

    expect(promptField().value).toBe("");

    render({ agents: surface({ startThread, threads: [threadView({ threadId: "agt-1" })] }) });

    expect(host.querySelector('section[aria-label="Agent thread agt-1"]')).not.toBeNull();
    expect(host.querySelector('[aria-current="true"]')).not.toBeNull();
  });

  it("keeps the prompt when the start is refused", async () => {
    const startThread = vi.fn(async () => null);
    render({ agents: surface({ startThread }) });

    typePrompt("Fix the parser");
    await submitFormAsync();

    expect(promptField().value).toBe("Fix the parser");
  });

  it("opens only the exact started thread when another unknown thread arrives concurrently", async () => {
    let resolveStart: ((result: { readonly threadId: string }) => void) | null = null;
    const startThread = vi.fn(
      () =>
        new Promise<{ readonly threadId: string } | null>((resolve) => {
          resolveStart = resolve;
        }),
    );
    render({
      agents: surface({ startThread, threads: [threadView({ threadId: "agt-existing" })] }),
    });

    typePrompt("Fix the parser");
    submitForm();
    render({
      agents: surface({
        startThread,
        threads: [
          threadView({ threadId: "agt-existing" }),
          threadView({ threadId: "agt-recovered-foreign" }),
          threadView({ threadId: "agt-started" }),
        ],
      }),
    });

    await act(async () => {
      resolveStart?.({ threadId: "agt-started" });
      await Promise.resolve();
    });

    expect(host.querySelector('section[aria-label="Agent thread agt-started"]')).not.toBeNull();
    expect(
      host.querySelector('section[aria-label="Agent thread agt-recovered-foreign"]'),
    ).toBeNull();
  });

  it("reads the branch status once for a selected thread whose status is unread", () => {
    const refreshShipStatus = vi.fn(async () => undefined);
    render({
      agents: surface({ refreshShipStatus, threads: [threadView({ threadId: "agt-1" })] }),
    });

    expect(refreshShipStatus).not.toHaveBeenCalled();

    clickText("Refactor the parser");
    typePrompt("Also update the tests");

    expect(refreshShipStatus).toHaveBeenCalledTimes(1);
    expect(refreshShipStatus).toHaveBeenCalledWith("agt-1");
  });

  it("leaves a selected thread with a loaded status and a gone worktree alone", () => {
    const refreshShipStatus = vi.fn(async () => undefined);
    render({
      agents: surface({
        refreshShipStatus,
        threads: [threadView({ threadId: "agt-1", ship: loadedShip() })],
      }),
    });
    clickText("Refactor the parser");
    expect(refreshShipStatus).not.toHaveBeenCalled();

    render({
      agents: surface({
        refreshShipStatus,
        threads: [
          threadView({ threadId: "agt-2", title: "Rename the lexer", worktreeMissing: true }),
        ],
      }),
    });
    clickText("Rename the lexer");
    expect(refreshShipStatus).not.toHaveBeenCalled();
  });

  it("puts the composer in follow-up mode for the selected thread", () => {
    render({ agents: surface({ threads: [threadView({ threadId: "agt-1" })] }) });

    clickText("Refactor the parser");

    expect(host.querySelector('form[aria-label="Follow up on agent thread"]')).not.toBeNull();
    expect(host.querySelector("select#agent-repository")).toBeNull();
    expect(host.querySelector("input#agent-isolation")).toBeNull();
    expect(submitButton().textContent).toContain("Send");
  });

  it("sends a follow-up into the selected thread and clears the prompt", async () => {
    const sendFollowUp = vi.fn(async () => true);
    render({ agents: surface({ sendFollowUp, threads: [threadView({ threadId: "agt-1" })] }) });

    clickText("Refactor the parser");
    typePrompt("Also update the tests");
    await submitFormAsync();

    expect(sendFollowUp).toHaveBeenCalledWith({
      threadId: "agt-1",
      prompt: "Also update the tests",
    });
    expect(promptField().value).toBe("");
  });

  it("keeps the prompt when the follow-up is refused", async () => {
    const sendFollowUp = vi.fn(async () => false);
    render({ agents: surface({ sendFollowUp, threads: [threadView({ threadId: "agt-1" })] }) });

    clickText("Refactor the parser");
    typePrompt("Also update the tests");
    await submitFormAsync();

    expect(promptField().value).toBe("Also update the tests");
  });

  it("blocks a follow-up into a thread without a resumable session", () => {
    render({
      agents: surface({
        threads: [threadView({ threadId: "agt-1", sessionId: null })],
      }),
    });

    clickText("Refactor the parser");
    typePrompt("Also update the tests");

    expect(host.textContent).toContain("This thread has no resumable session");
    expect(submitButton().disabled).toBe(true);
  });

  it("blocks a follow-up while the thread is still running", () => {
    render({
      agents: surface({
        threads: [threadView({ threadId: "agt-1", status: { kind: "running" } })],
      }),
    });

    clickText("Refactor the parser");
    typePrompt("Also update the tests");

    expect(host.textContent).toContain("This thread is still running");
    expect(submitButton().disabled).toBe(true);
  });

  it("blocks a follow-up when the worktree is gone", () => {
    render({
      agents: surface({
        threads: [threadView({ threadId: "agt-1", worktreeMissing: true })],
      }),
    });

    clickText("Refactor the parser");

    expect(host.textContent).toContain("The worktree for this thread no longer exists.");
    expect(submitButton().disabled).toBe(true);
  });

  it("blocks a follow-up whose provider no longer matches the configured CLI", () => {
    render({
      agents: surface({
        agentCliKind: "codex",
        threads: [threadView({ threadId: "agt-1", providerKind: "claudeCode" })],
      }),
    });

    clickText("Refactor the parser");
    typePrompt("Also update the tests");

    expect(host.textContent).toContain("This thread was started with Claude Code");
    expect(submitButton().disabled).toBe(true);
  });

  it("blocks a follow-up while the concurrent agent limit is reached", () => {
    render({
      agents: surface({
        liveTaskCount: 2,
        maxConcurrentAgentTasks: 2,
        threads: [threadView({ threadId: "agt-1" })],
      }),
    });

    clickText("Refactor the parser");
    typePrompt("Also update the tests");

    expect(host.textContent).toContain("The concurrent agent limit is reached");
    expect(submitButton().disabled).toBe(true);
  });

  it("escapes back to a new thread from the composer", () => {
    render({ agents: surface({ threads: [threadView({ threadId: "agt-1" })] }) });

    clickText("Refactor the parser");
    click(".agent-composer__new");

    expect(host.querySelector('form[aria-label="New agent thread"]')).not.toBeNull();
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

  it("routes stop, archive and remove to the surface", () => {
    const stop = vi.fn(async () => undefined);
    const archive = vi.fn();
    const remove = vi.fn();
    render({
      agents: surface({
        archive,
        remove,
        stop,
        threads: [threadView({ threadId: "agt-1", status: { kind: "running" } })],
      }),
    });

    clickText("Refactor the parser");
    click('[aria-label="Stop agent agt-1"]');

    expect(stop).toHaveBeenCalledWith("agt-1");

    render({ agents: surface({ archive, remove, stop, threads: [threadView({})] }) });

    clickText("Refactor the parser");
    click('[aria-label="Archive thread agt-1"]');
    click('[aria-label="Remove thread agt-1"]');

    expect(archive).toHaveBeenCalledWith("agt-1");
    expect(remove).toHaveBeenCalledWith("agt-1");
  });

  it("routes every ship action of the selected thread to the surface", () => {
    const refreshShipStatus = vi.fn(async () => undefined);
    const commitThreadChanges = vi.fn(async () => undefined);
    const pushThreadBranch = vi.fn(async () => undefined);
    const removeThreadWorktree = vi.fn(async () => undefined);
    const removeWorktree = vi.fn(async () => undefined);
    const resetThreadShip = vi.fn();
    render({
      agents: surface({
        commitThreadChanges,
        pushThreadBranch,
        refreshShipStatus,
        removeThreadWorktree,
        removeWorktree,
        resetThreadShip,
        threads: [threadView({ threadId: "agt-1" })],
      }),
    });

    clickText("Refactor the parser");
    click('[aria-label="Refresh the branch status of agent agt-1"]');
    click('[aria-label="Commit changes"]');
    click('[aria-label="Push branch"]');
    click('[aria-label="Remove worktree"]');
    click('[aria-label="Discard the worktree of agent agt-1"]');

    expect(refreshShipStatus).toHaveBeenCalledWith("agt-1");
    expect(commitThreadChanges).toHaveBeenCalledWith("agt-1", "Refactor the parser");
    expect(pushThreadBranch).toHaveBeenCalledWith("agt-1");
    expect(removeThreadWorktree).toHaveBeenCalledWith("agt-1", { deleteBranch: false });
    expect(removeWorktree).toHaveBeenCalledWith("agt-1");
  });

  it("opens a changed file and its diff document through the surface", () => {
    const openChangedFile = vi.fn(async () => undefined);
    const openChangedFileDiff = vi.fn(async () => undefined);
    const view = threadView({ threadId: "agt-1" });
    const file = {
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: `${ROOT}/.worktrees/agt-1/a.ts`,
      relativePath: "a.ts",
      status: "modified" as const,
    };
    render({
      agents: surface({
        openChangedFile,
        openChangedFileDiff,
        threads: [
          {
            ...view,
            changeSummary: {
              loading: false,
              error: null,
              files: [file],
              truncated: false,
              removing: false,
              diff: null,
            },
          },
        ],
      }),
    });

    clickText("Refactor the parser");
    click('[aria-label="Open a.ts in the editor"]');
    click('[aria-label="Open a diff document for a.ts"]');

    expect(openChangedFile).toHaveBeenCalledWith("agt-1", file);
    expect(openChangedFileDiff).toHaveBeenCalledWith("agt-1", file);
  });

  it("drops the selection when the thread disappears from the surface", () => {
    render({ agents: surface({ threads: [threadView({ threadId: "agt-1" })] }) });

    clickText("Refactor the parser");
    render({ agents: surface({ threads: [] }) });

    expect(host.querySelector('section[aria-label="Agent thread agt-1"]')).toBeNull();
    expect(host.querySelector('section[aria-label="New agent thread"]')).not.toBeNull();
  });

  it("routes the pin toggle to the surface and orders pinned threads first", () => {
    const togglePin = vi.fn();
    render({
      agents: surface({
        togglePin,
        threads: [
          threadView({ threadId: "agt-1" }),
          threadView({ threadId: "agt-2" }),
          threadView({ threadId: "agt-3", repositoryRoot: NESTED }),
        ],
      }),
    });

    expect(threadOrder()).toEqual(["agt-1", "agt-2", "agt-3"]);

    click('[aria-label="Pin thread agt-2"]');

    expect(togglePin).toHaveBeenCalledWith("agt-2");

    render({
      agents: surface({
        togglePin,
        threads: [
          threadView({ threadId: "agt-1" }),
          threadView({ threadId: "agt-2", pinned: true }),
          threadView({ threadId: "agt-3", repositoryRoot: NESTED }),
        ],
      }),
    });

    expect(threadOrder()).toEqual(["agt-2", "agt-1", "agt-3"]);
  });

  it("hides archived threads behind a collapsed group", () => {
    render({
      agents: surface({
        threads: [
          threadView({ threadId: "agt-1" }),
          threadView({ threadId: "agt-2", archived: true, title: "Archived work" }),
        ],
      }),
    });

    expect(host.textContent).not.toContain("Archived work");

    clickText("Archived");

    expect(host.textContent).toContain("Archived work");
  });

  it("renders one project section per registered root and keeps the active tab first", () => {
    render({ projects: [activeProject(), backgroundProject()] });

    expect(host.querySelector('section[aria-label="Project app"]')).not.toBeNull();
    expect(host.querySelector('section[aria-label="Project api-service"]')).not.toBeNull();
    expect(
      [...host.querySelectorAll(".agent-project__name")].map((element) => element.textContent),
    ).toEqual(["app", "api-service"]);
  });

  it("starts in the project chosen in the composer and forces its worktree rule", async () => {
    const startThread = vi.fn(async () => ({ threadId: "agt-new" }));
    render({ agents: surface({ startThread }), projects: [activeProject(), backgroundProject()] });

    selectProject(OTHER_ROOT);

    expect(checkbox("agent-isolation").disabled).toBe(true);
    expect(host.textContent).toContain("not the active tab");

    typePrompt("Fix the parser");
    await submitFormAsync();

    expect(startThread).toHaveBeenCalledWith({
      projectRootKey: OTHER_ROOT,
      repositoryRoot: OTHER_ROOT,
      prompt: "Fix the parser",
      isolation: "worktree",
      unsafeInPlaceConfirmationKey: null,
    });
  });

  it("starts in the active project without a project-level picker", async () => {
    const startThread = vi.fn(async () => ({ threadId: "agt-new" }));
    render({ agents: surface({ startThread }), projects: [activeProject()] });

    expect(host.querySelector("select#agent-project")).toBeNull();

    typePrompt("Fix the parser");
    await submitFormAsync();

    expect(startThread).toHaveBeenCalledWith({
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

  it("shows no start target when only a closed-tab draining project remains", () => {
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

function surface(overrides: Partial<AgentThreadsSurface>): AgentThreadsSurface {
  return {
    threads: [],
    repositories: [repository(ROOT, ""), repository(NESTED, "packages/api")],
    orphanedWorktrees: [],
    notice: null,
    dispatching: false,
    agentCliConfigured: true,
    agentCliKind: "claudeCode",
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
    startThread: async () => ({ threadId: "agt-default" }),
    sendFollowUp: async () => true,
    stop: async () => undefined,
    togglePin: () => undefined,
    archive: () => undefined,
    remove: () => undefined,
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
    refreshShipStatus: async () => undefined,
    commitThreadChanges: async () => undefined,
    pushThreadBranch: async () => undefined,
    openThreadCompareUrl: async () => undefined,
    integrateThreadBranch: async () => undefined,
    removeThreadWorktree: async () => undefined,
    resetThreadShip: () => undefined,
    openChangedFile: async () => undefined,
    openChangedFileDiff: async () => undefined,
    configureAgentCli: () => undefined,
    dismissNotice: () => undefined,
    ...overrides,
  };
}

function repository(repositoryRoot: string, rootRelativePath: string): ResolvedGitRepository {
  return { mapping: { rootRelativePath }, repositoryRoot, repositoryRelativePath: "" };
}

interface ThreadViewOptions {
  readonly threadId?: string;
  readonly repositoryRoot?: string;
  readonly status?: AgentTurnStatus;
  readonly pinned?: boolean;
  readonly archived?: boolean;
  readonly providerKind?: AgentCliKind;
  readonly projectOrigin?: AgentProjectOrigin;
  readonly sessionId?: string | null;
  readonly title?: string;
  readonly worktreeMissing?: boolean;
  readonly ship?: AgentShipState;
}

function threadView({
  archived = false,
  ship = { kind: "idle", status: null, loadingStatus: false },
  pinned = false,
  projectOrigin = "active-tab",
  providerKind = "claudeCode",
  repositoryRoot = ROOT,
  sessionId = "session-abcdefgh",
  status = { kind: "exited", exitCode: 0 },
  threadId = "agt-1",
  title = "Refactor the parser",
  worktreeMissing = false,
}: ThreadViewOptions): AgentThreadView {
  const running = status.kind === "pending" || status.kind === "running";
  const thread: AgentThread = {
    threadId,
    owner: { rootKey: ROOT, ownerId: "agent-root:app", repositoryRoot },
    target: { isolation: "worktree", worktreePath: `${repositoryRoot}/.worktrees/${threadId}` },
    provider: { kind: providerKind, sessionId },
    title,
    pinned,
    archived,
    createdAtEpochMs: 1_700_000_000_000,
    updatedAtEpochMs: 1_700_000_000_000,
    turns: [turn(threadId, title, status)],
    turnsTruncated: false,
    integration: null,
  };

  return {
    ship,
    editorAvailability: { kind: "available" },
    thread,
    lifecycle: archived ? "archived" : running ? "running" : "settled",
    repositoryLabel: "app",
    projectOrigin,
    worktreeRemoved: false,
    worktreeMissing,
    changeSummary: null,
  };
}

function loadedShip(): AgentShipState {
  return {
    kind: "idle",
    loadingStatus: false,
    status: {
      worktree: { branch: "agent/agt-1", head: "a".repeat(40), dirty: true, changeCount: 2 },
      primary: { branch: "main", head: "b".repeat(40), dirty: false },
      relation: { aheadOfPrimary: 1, behindPrimary: 0, fastForwardable: true },
      remote: null,
    },
  };
}

function turn(threadId: string, prompt: string, status: AgentTurnStatus): AgentTurn {
  return {
    turnId: `${threadId}-t1`,
    prompt,
    status,
    startedAtEpochMs: 1_700_000_000_000,
    endedAtEpochMs: null,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
  };
}
