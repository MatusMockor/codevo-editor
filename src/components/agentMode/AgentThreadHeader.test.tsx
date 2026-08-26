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
import type { AgentShipActions } from "./AgentShipPanel";
import { AgentThreadHeader, type AgentThreadHeaderProps } from "./AgentThreadHeader";

const ROOT = "/workspace/app";
const PROJECT = { projectRootKey: "root:app", repositoryRoot: ROOT, label: "app" };
const SHORTCUTS = { bottomPanel: "Cmd+J", rightPanel: "Cmd+Alt+R", expandEditor: "Cmd+Alt+E" };

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

  it("renders the breadcrumb with a truncating title, its tooltip and the status", () => {
    render({ thread: threadView({ title: "A very long thread title that keeps going" }) });

    const title = button("Thread actions for A very long thread title that keeps going");
    expect(title.title).toBe("A very long thread title that keeps going");
    expect(host.querySelector("h2.agent-crumbs__heading")?.textContent).toBe(
      "A very long thread title that keeps going",
    );
    expect(host.querySelector(".agent-thread-head__status")?.textContent).toBe("Idle");
    expect(button("Run dev")).toBeDefined();
    expect(button("Open in Editor")).toBeDefined();
    expect(button("Commit")).toBeDefined();
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
    expect(menuItems(menu)).toContain("Rename");

    act(() => menuItem(menu, "Rename").click());
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Rename thread"]');
    expect(input).not.toBeNull();
    expect(input?.value).toBe("Refactor the parser");

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
    act(() => menuItem(menu, "Pin").click());

    expect(onThreadMenuCommand).toHaveBeenCalledWith("agt-1", { kind: "togglePin" });
  });

  it("copies the path through the Open menu using the thread menu command", () => {
    const onThreadMenuCommand = vi.fn();
    render({ onThreadMenuCommand });

    act(() => button("Open options").click());
    const menu = host.querySelector<HTMLElement>('[role="menu"]');
    act(() => menuItem(menu, "Copy path").click());

    expect(onThreadMenuCommand).toHaveBeenCalledWith("agt-1", { kind: "copy", detail: "path" });
  });

  it("shows the layout toggles only while the right panel is closed", () => {
    render({});
    expect(host.querySelector("[data-panel-layout-controls]")).not.toBeNull();

    render({
      layout: {
        ...initialAgentWorkbenchLayout,
        rightPanel: "open",
        openSurfaces: ["files"],
        activeSurface: "files",
      },
    });
    expect(host.querySelector("[data-panel-layout-controls]")).toBeNull();

    render({ layout: { ...initialAgentWorkbenchLayout, rightPanel: "open" } });
    expect(host.querySelector("[data-panel-layout-controls]")).toBeNull();
  });

  it("renders the empty state with the project crumb and only the toggles", () => {
    const onToggleBottomPanel = vi.fn();
    const onToggleRightPanel = vi.fn();
    render({ thread: null, onToggleBottomPanel, onToggleRightPanel });

    expect(host.querySelector("h2.agent-crumbs__heading")?.textContent).toBe("New thread");
    expect(button("Thread actions for New thread").disabled).toBe(true);
    expect(host.querySelector(".agent-split")).toBeNull();
    act(() => button("Toggle terminal panel (⌘J)").click());
    expect(onToggleBottomPanel).toHaveBeenCalledTimes(1);
    const right = button("Toggle right panel (⌥⌘R)");
    expect(right.disabled).toBe(false);
    act(() => right.click());
    expect(onToggleRightPanel).toHaveBeenCalledTimes(1);
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
    act(() => menuItem(document.querySelector('[role="menu"]'), "Rename").click());
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
      scripts: scriptsSurface(),
      shipActions: shipActions(),
      shortcuts: SHORTCUTS,
      onNewThread: vi.fn(),
      onRenameThread: vi.fn(),
      onThreadMenuCommand: vi.fn(),
      onOpenSurface: vi.fn(),
      onToggleBottomPanel: vi.fn(),
      onToggleRightPanel: vi.fn(),
      onExpandEditor: vi.fn(),
      onOpenScriptsView: null,
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

function shipActions(): AgentShipActions {
  return {
    onRefreshShipStatus: vi.fn(),
    onCommit: vi.fn(),
    onPush: vi.fn(),
    onOpenCompareUrl: vi.fn(),
    onIntegrate: vi.fn(),
    onRemoveWorktree: vi.fn(),
    onDiscardWorktree: vi.fn(),
    onDismissFailure: vi.fn(),
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
