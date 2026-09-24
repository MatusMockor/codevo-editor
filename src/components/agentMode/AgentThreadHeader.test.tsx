// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentThreadScriptsSurface } from "../../application/useAgentThreadScripts";
import {
  agentThreadAttention,
  agentThreadUnread,
  type AgentThread,
} from "../../domain/agentThread";
import { initialAgentWorkbenchLayout } from "../../domain/agentWorkbenchLayout";
import { AgentThreadHeader, type AgentThreadHeaderProps } from "./AgentThreadHeader";

const ROOT = "/workspace/app";
const PROJECT = { projectRootKey: "root:app", repositoryRoot: ROOT, label: "app" };
const SHORTCUTS = {
  bottomPanel: "Cmd+J",
  rightPanel: "Cmd+Alt+R",
  sidebar: "Cmd+B",
  newThread: "Cmd+N",
};
const SESSION_ID = "34fbe185-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

describe("AgentThreadHeader", () => {
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

  it("renders the breadcrumb with a truncating title and its tooltip", () => {
    render({ thread: threadView({ title: "A very long thread title that keeps going" }) });

    const title = button("Thread actions for A very long thread title that keeps going");
    expect(title.title).toBe("A very long thread title that keeps going");
    expect(host.querySelector("h2.agent-crumbs__heading")?.textContent).toBe(
      "A very long thread title that keeps going",
    );
    expect(button("Run dev")).toBeDefined();
    expect(button("Open in Editor")).toBeDefined();
    expect(button("Commit")).toBeDefined();
  });

  it.each([null, threadView({})])(
    "hands blank breadcrumb and action areas to the native window without taking over controls (%s)",
    (thread) => {
      render({ thread });

      const header = host.querySelector("header");
      expect(header?.getAttribute("data-tauri-drag-region")).toBe("deep");
      for (const selector of [
        '[aria-label="Thread breadcrumb"]',
        ".agent-crumbs__sep",
        ".cv-topbar__title",
        ".cv-topbar__actions",
        ".cv-topbar__trailing",
        "[data-panel-layout-controls]",
      ]) {
        const target = host.querySelector(selector);
        expect(target, selector).not.toBeNull();
        expect(target?.closest("[data-tauri-drag-region]")).toBe(header);
      }
      for (const control of host.querySelectorAll("button")) {
        expect(control.hasAttribute("data-tauri-drag-region"), control.ariaLabel ?? undefined).toBe(
          false,
        );
        expect(control.querySelector("[data-tauri-drag-region]")).toBeNull();
      }
    },
  );

  it("keeps the original header with a server icon and blocks local filesystem actions", () => {
    const onOpenSurface = vi.fn();
    const onRevealPath = vi.fn(() => Promise.resolve());
    const onOpenTerminalSessions = vi.fn();
    render({
      thread: { ...threadView({}), execution: remoteExecution() },
      onOpenSurface,
      onRevealPath,
      onOpenTerminalSessions,
    });

    expect(host.querySelector('[role="img"][aria-label="Runs on server"]')).not.toBeNull();
    expect(host.querySelector("h2.agent-crumbs__heading")?.textContent).toBe("Refactor the parser");
    expect(button("Commit")).toBeDefined();
    expect(button("Open in Editor").disabled).toBe(true);
    expect(button("Open in Editor").title).toContain("server files");
    expect(button("Open options").disabled).toBe(true);
    expect(button("Terminal sessions").disabled).toBe(true);
    act(() => {
      button("Open in Editor").click();
      button("Open options").click();
      button("Terminal sessions").click();
    });
    expect(onOpenSurface).not.toHaveBeenCalled();
    expect(onRevealPath).not.toHaveBeenCalled();
    expect(onOpenTerminalSessions).not.toHaveBeenCalled();
    render({ thread: threadView({}) });
    expect(host.querySelector('[aria-label="Runs on server"]')).toBeNull();
    expect(button("Open in Editor").disabled).toBe(false);
  });

  it("leaves thread status to the rail row and the status bar", () => {
    render({ thread: threadView({}) });

    expect(host.querySelector(".agent-thread-head__status")).toBeNull();
    expect(host.querySelector(".agent-thread-head__status-label")).toBeNull();
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.querySelector(".agent-dot")).toBeNull();
    expect(host.textContent).not.toContain("Idle");
  });

  it.each([
    ["Open options", "menu"],
    ["Choose a script", "menu"],
  ])("keeps the %s popup and its content out of the native drag region", async (label, role) => {
    render({});

    act(() => button(label).click());
    await act(async () => {});

    const popup = host.querySelector(`[role="${role}"]`);
    expect(popup).not.toBeNull();
    expect(popup?.getAttribute("data-tauri-drag-region")).toBe("false");
    for (const content of popup?.querySelectorAll("*") ?? []) {
      expect(content.closest("[data-tauri-drag-region]")).toBe(popup);
    }
  });

  it("badges a thread imported from a terminal session and leaves other threads unbadged", () => {
    render({ thread: threadView({}) });
    expect(host.querySelector(".agent-crumbs .agent-microlabel")).toBeNull();

    const base = threadView({});
    render({
      thread: {
        ...base,
        thread: {
          ...base.thread,
          provider: { kind: "claudeCode", sessionId: SESSION_ID },
          externalOrigin: {
            provider: "claudeCode",
            sessionId: SESSION_ID,
            importedAtEpochMs: 1_700_000_000_000,
          },
        },
      },
    });

    const badge = host.querySelector<HTMLElement>(".agent-crumbs .agent-microlabel");
    expect(badge?.textContent).toBe("Imported");
    expect(badge?.title).toBe("Imported terminal session");
  });

  it("keeps collapsed header actions named and discoverable by tooltip", () => {
    render({});

    const run = button("Run dev");
    const open = button("Open in Editor");
    const commit = button("Commit");
    expect(run.title).toBe("Run dev in the terminal panel");
    expect(open.title).toBe("Open the checkout in the editor");
    expect(commit.title).toBe("Commit changes in the Git panel");
    expect(run.querySelector(".agent-split__label")?.textContent).toBe("dev");
    expect(open.querySelector(".agent-split__label")?.textContent).toBe("Open");
  });

  it("opens the Git surface from the Commit button placed right after Run script", () => {
    const onOpenSurface = vi.fn();
    render({ onOpenSurface });

    const trailing = host.querySelector(".cv-topbar__trailing");
    const controls = [...(trailing?.querySelectorAll("button") ?? [])];
    const run = controls.indexOf(button("Run dev"));
    const commit = controls.indexOf(button("Commit"));
    expect(commit).toBeGreaterThan(run);
    expect(
      controls.slice(run + 1, commit).every((control) => control.closest(".agent-split") !== null),
    ).toBe(true);
    expect(button("Commit").getAttribute("aria-pressed")).toBe("false");
    expect(host.querySelector('button[aria-label="Ship options"]')).toBeNull();

    act(() => button("Commit").click());

    expect(onOpenSurface).toHaveBeenCalledWith("git");
    render({ onOpenSurface, gitSurfaceActive: true });
    expect(button("Commit").getAttribute("aria-pressed")).toBe("true");
    render({ thread: null });
    expect(host.querySelector('button[aria-label="Commit"]')).toBeNull();
  });

  it("starts a new thread in the project from the project crumb", () => {
    const onNewThread = vi.fn();
    render({ onNewThread });

    act(() => button("New thread in app").click());

    expect(onNewThread).toHaveBeenCalledWith("root:app", ROOT);
  });

  it("opens the thread menu below the title and renames through it", () => {
    const onRenameThread = vi.fn();
    const onThreadMenuCommand = vi.fn();
    render({ onRenameThread, onThreadMenuCommand });

    act(() => button("Thread actions for Refactor the parser").click());
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(menuItems(menu)).toContain("Rename thread");

    act(() => menuItem(menu, "Rename thread").click());
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Rename thread"]');
    expect(input).not.toBeNull();
    expect(input?.value).toBe("Refactor the parser");
    expect(input?.hasAttribute("data-tauri-drag-region")).toBe(false);

    act(() => {
      setValue(input as HTMLInputElement, "Parser cleanup");
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(onRenameThread).toHaveBeenCalledWith("agt-1", "Parser cleanup");
    expect(host.querySelector('input[aria-label="Rename thread"]')).toBeNull();
  });

  it("forwards other menu commands and opens the menu on right-click", () => {
    const onThreadMenuCommand = vi.fn();
    render({ onThreadMenuCommand });

    act(() => {
      host
        .querySelector(".agent-crumbs")
        ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 30 }));
    });
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    act(() => menuItem(menu, "Pin thread").click());

    expect(onThreadMenuCommand).toHaveBeenCalledWith("agt-1", { kind: "togglePin" });
  });

  it("opens the thread menu from the keyboard and returns focus to the title", () => {
    render({});
    const title = button("Thread actions for Refactor the parser");
    act(() => title.focus());
    act(() => title.click());
    const menu = document.querySelector<HTMLElement>('[role="menu"][aria-label="Thread actions"]');
    expect(menu).not.toBeNull();
    expect(title.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement?.textContent).toBe("New thread");
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
    });
    expect(document.activeElement?.textContent).toBe("Pin thread");
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(title);
    expect(title.getAttribute("aria-expanded")).toBe("false");
  });

  it("confirms Delete in a dialog before sending the command", () => {
    const onThreadMenuCommand = vi.fn();
    render({ onThreadMenuCommand });
    act(() => button("Thread actions for Refactor the parser").click());
    act(() => menuItem(document.querySelector('[role="menu"]'), "Delete").click());
    expect(onThreadMenuCommand).not.toHaveBeenCalled();
    const confirm = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((candidate) => candidate.textContent === "Delete thread");
    act(() => confirm?.click());
    expect(onThreadMenuCommand).toHaveBeenCalledWith("agt-1", { kind: "delete" });
  });

  it("drops a pending delete confirmation when the thread changes", () => {
    const onThreadMenuCommand = vi.fn();
    render({ onThreadMenuCommand });
    act(() => button("Thread actions for Refactor the parser").click());
    act(() => menuItem(document.querySelector('[role="menu"]'), "Delete").click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    render({ onThreadMenuCommand, thread: threadView({ threadId: "agt-2", title: "Second" }) });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onThreadMenuCommand).not.toHaveBeenCalled();
  });

  it("copies the path through the Open menu using the thread menu command", () => {
    const onThreadMenuCommand = vi.fn();
    render({ onThreadMenuCommand });

    act(() => button("Open options").click());
    const menu = host.querySelector<HTMLElement>('[role="menu"]');
    act(() => menuItem(menu, "Copy path").click());

    expect(onThreadMenuCommand).toHaveBeenCalledWith("agt-1", { kind: "copy", detail: "path" });
  });

  it("keeps the layout toggles visible and mirrors the panel states in aria-pressed", () => {
    render({});
    expect(button("Toggle terminal panel").getAttribute("aria-pressed")).toBe("false");
    expect(button("Toggle right panel").getAttribute("aria-pressed")).toBe("false");

    render({ bottomPanelOpen: true });
    expect(button("Toggle terminal panel").getAttribute("aria-pressed")).toBe("true");

    render({
      layout: {
        ...initialAgentWorkbenchLayout,
        rightPanel: "open",
        openSurfaces: ["files"],
        activeSurface: "files",
      },
    });
    expect(host.querySelector("[data-panel-layout-controls]")).not.toBeNull();
    expect(button("Toggle right panel").getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the project favicon, keeps Run script and Commit visible and hides Open and Terminal sessions until hover", () => {
    render({});

    expect(host.querySelector(".agent-crumbs__project .cv-favicon")?.textContent).toBe("A");
    const actions = host.querySelector(".cv-topbar__actions");
    const trailing = host.querySelector(".cv-topbar__trailing");
    expect(actions?.contains(button("Open in Editor"))).toBe(true);
    expect(actions?.contains(button("Terminal sessions"))).toBe(true);
    expect(actions?.contains(button("Run dev"))).toBe(false);
    expect(trailing?.contains(button("Run dev"))).toBe(true);
    expect(trailing?.contains(button("Commit"))).toBe(true);
    expect(host.querySelector("header")?.className).toContain("cv-topbar--window-edge");
  });

  it("renders the leading cluster and trailing extras in their slots", () => {
    render({
      leading: <button aria-label="Expand sidebar" type="button" />,
      trailingExtras: <button aria-label="Toggle agents panel" type="button" />,
    });

    expect(host.querySelector(".cv-topbar__leading")?.contains(button("Expand sidebar"))).toBe(
      true,
    );
    const trailing = host.querySelector(".cv-topbar__trailing");
    const extras = button("Toggle agents panel");
    expect(trailing?.contains(extras)).toBe(true);
    expect(
      extras.compareDocumentPosition(host.querySelector("[data-panel-layout-controls]") as Node),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("renders the empty state with the project crumb and only the toggles", () => {
    const onToggleBottomPanel = vi.fn();
    const onToggleRightPanel = vi.fn();
    render({ thread: null, onToggleBottomPanel, onToggleRightPanel });

    expect(host.querySelector("h2.agent-crumbs__heading")?.textContent).toBe("New thread");
    expect(button("Thread actions for New thread").disabled).toBe(true);
    expect(host.querySelector(".agent-split")).toBeNull();
    act(() => button("Toggle terminal panel").click());
    expect(onToggleBottomPanel).toHaveBeenCalledTimes(1);
    const right = button("Toggle right panel");
    expect(right.disabled).toBe(false);
    act(() => right.click());
    expect(onToggleRightPanel).toHaveBeenCalledTimes(1);
  });

  it("opens the terminal sessions palette from the header for an open thread", () => {
    const onOpenTerminalSessions = vi.fn();
    render({ onOpenTerminalSessions });

    const entry = button("Terminal sessions");
    expect(entry.title).toBe("Terminal sessions");
    expect(entry.disabled).toBe(false);

    act(() => entry.click());

    expect(onOpenTerminalSessions).toHaveBeenCalledTimes(1);
  });

  it("keeps the terminal sessions entry in the New thread state, left of the layout toggles", () => {
    const onOpenTerminalSessions = vi.fn();
    render({ thread: null, onOpenTerminalSessions });

    const entry = button("Terminal sessions");
    const toggles = host.querySelector<HTMLElement>("[data-panel-layout-controls]");
    expect(toggles).not.toBeNull();
    expect(entry.compareDocumentPosition(toggles as HTMLElement)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    act(() => entry.click());

    expect(onOpenTerminalSessions).toHaveBeenCalledTimes(1);
  });

  it("disables the terminal sessions entry without a scoped project, keeping its title", () => {
    render({ onOpenTerminalSessions: null });

    const entry = button("Terminal sessions");
    expect(entry.disabled).toBe(true);
    expect(entry.title).toBe("Terminal sessions");
  });

  it("keeps the terminal sessions entry and the toggles while the right panel is open", () => {
    render({ layout: { ...initialAgentWorkbenchLayout, rightPanel: "open" } });

    expect(button("Terminal sessions").disabled).toBe(false);
    expect(host.querySelector("[data-panel-layout-controls]")).not.toBeNull();
  });

  it("routes a reveal failure to the injected notice handler", async () => {
    const failure = new Error("Unable to reveal that path in the file manager.");
    const onRevealFailed = vi.fn();
    render({ onRevealFailed, onRevealPath: () => Promise.reject(failure) });

    act(() => button("Open options").click());
    await act(async () => {});
    act(() => menuItem(document.querySelector('[role="menu"]'), "Reveal in Finder").click());
    await act(async () => {});

    expect(onRevealFailed).toHaveBeenCalledWith(failure);
  });

  it("drops the open menu and rename state when the thread changes", () => {
    render({});
    act(() => button("Thread actions for Refactor the parser").click());
    act(() => menuItem(document.querySelector('[role="menu"]'), "Rename thread").click());
    expect(host.querySelector('input[aria-label="Rename thread"]')).not.toBeNull();

    render({ thread: threadView({ threadId: "agt-2", title: "Second" }) });

    expect(host.querySelector('input[aria-label="Rename thread"]')).toBeNull();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  function render(overrides: Partial<AgentThreadHeaderProps>): void {
    const props: AgentThreadHeaderProps = {
      thread: threadView({}),
      project: PROJECT,
      layout: initialAgentWorkbenchLayout,
      bottomPanelOpen: false,
      scripts: scriptsSurface(),
      shortcuts: SHORTCUTS,
      onNewThread: vi.fn(),
      onRenameThread: vi.fn(),
      onThreadMenuCommand: vi.fn(),
      onOpenSurface: vi.fn(),
      onToggleBottomPanel: vi.fn(),
      onToggleRightPanel: vi.fn(),
      onOpenScriptsView: null,
      onOpenTerminalSessions: vi.fn(),
      onRevealPath: vi.fn(() => Promise.resolve()),
      onRevealFailed: vi.fn(),
      ...overrides,
    };
    act(() => {
      root.render(<AgentThreadHeader {...props} />);
    });
  }

  function button(label: string): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(element, `Missing button ${label}`).not.toBeNull();
    return element as HTMLButtonElement;
  }
});

function menuItems(menu: HTMLElement | null): ReadonlyArray<string> {
  return [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].map(
    (item) => item.textContent ?? "",
  );
}

function menuItem(menu: HTMLElement | null, label: string): HTMLButtonElement {
  const element = [...(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])].find(
    (candidate) => candidate.textContent === label,
  );
  expect(element, `Missing menu item ${label}`).toBeDefined();
  return element as HTMLButtonElement;
}

function setValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function scriptsSurface(): AgentThreadScriptsSurface {
  const dev = {
    key: "dev",
    label: "dev",
    detail: null,
    availability: { kind: "available" as const },
  };
  return {
    entries: [dev],
    preferred: dev,
    truncated: false,
    run: { kind: "idle" },
    runScript: vi.fn(() => true),
    stopScript: vi.fn(),
  };
}

function threadView(overrides: {
  readonly threadId?: string;
  readonly title?: string;
}): AgentThreadView {
  const threadId = overrides.threadId ?? "agt-1";
  const thread: AgentThread = {
    threadId,
    owner: { rootKey: "root:app", ownerId: "agent-root:app", repositoryRoot: ROOT },
    target: { isolation: "worktree", worktreePath: `${ROOT}/.worktrees/${threadId}` },
    provider: { kind: "claudeCode", sessionId: null },
    title: overrides.title ?? "Refactor the parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1_700_000_000_000,
    updatedAtEpochMs: 1_700_000_000_000,
    turns: [],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
  };
  return {
    thread,
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(thread),
    unread: agentThreadUnread(thread),
    lifecycle: "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}

function remoteExecution(): NonNullable<AgentThreadView["execution"]> {
  return {
    kind: "remote",
    serverId: "server-1",
    runnerId: "runner-1",
    projectId: "project-1",
    conversationId: "conversation-1",
    latestTaskId: "task-1",
    resume: null,
  };
}
