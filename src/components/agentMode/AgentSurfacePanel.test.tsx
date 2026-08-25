// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSurfaceFileTreeSurface } from "../../application/useAgentSurfaceFileTree";
import { waitForReact } from "../../test/reactTestLifecycle";
import {
  AGENT_SURFACE_EDITOR_SLOT_ATTRIBUTE,
  AgentSurfacePanel,
  type AgentSurfacePanelProps,
} from "./AgentSurfacePanel";
import {
  SURFACE_FOREIGN_ROOT_TERMINAL_REASON,
  SURFACE_NO_THREAD_REASON,
  SURFACE_UNTRUSTED_TERMINAL_REASON,
  SURFACE_WORKTREE_GONE_REASON,
} from "./agentSurfacePolicy";
import { SURFACE_FIXTURE_WORKTREE, surfaceThreadView } from "./agentSurfaceTestFixtures";
import { fakeTerminalGateway, installResizeObserver } from "./agentSurfaceTerminalTestSupport";

vi.mock("@xterm/xterm", async () =>
  (await import("./agentSurfaceTerminalTestSupport")).xtermMockModule(),
);
vi.mock("@xterm/addon-fit", async () =>
  (await import("./agentSurfaceTerminalTestSupport")).fitAddonMockModule(),
);

describe("AgentSurfacePanel", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    installResizeObserver();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("shows the empty state with three cards and routes a choice", () => {
    const onChooseSurface = vi.fn();
    render({ onChooseSurface });

    expect(host.querySelector(".agent-surface-empty__title")?.textContent).toBe("Open a surface");
    expect(host.querySelectorAll(".agent-surface-card")).toHaveLength(3);
    expect(host.querySelector("[data-surface]")?.getAttribute("data-surface")).toBe("empty");
    click('[aria-label="Open Diff surface"]');
    expect(onChooseSurface).toHaveBeenCalledWith("diff");
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Expand to editor (⌥⌘E)"]')?.disabled,
    ).toBe(true);
  });

  it("disables cards with reasons: no thread, worktree gone, untrusted terminal", () => {
    render({ thread: null });
    expect(reasons()).toEqual([
      SURFACE_NO_THREAD_REASON,
      SURFACE_NO_THREAD_REASON,
      SURFACE_NO_THREAD_REASON,
    ]);
    expect(host.querySelectorAll<HTMLButtonElement>('[role="tab"]:disabled')).toHaveLength(3);

    render({ thread: surfaceThreadView({ worktreeMissing: true }) });
    expect(reasons()).toEqual([
      SURFACE_WORKTREE_GONE_REASON,
      SURFACE_WORKTREE_GONE_REASON,
      SURFACE_WORKTREE_GONE_REASON,
    ]);

    const onTrustWorkspace = vi.fn();
    render({ workspaceTrusted: false, onTrustWorkspace });
    expect(reasons()).toEqual([SURFACE_UNTRUSTED_TERMINAL_REASON]);
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Open Files surface"]')?.disabled,
    ).toBe(false);
    click('[aria-label="Trust the workspace"]');
    expect(onTrustWorkspace).toHaveBeenCalledTimes(1);
  });

  it("renders the Files surface as tree plus an empty editor slot and toggles the tree", () => {
    render({ layout: { rightSurface: "files" } });

    const aside = host.querySelector("aside.agent-surface");
    expect(aside?.getAttribute("data-surface")).toBe("files");
    expect(aside?.getAttribute("data-tree")).toBe("visible");
    expect(host.querySelector("[data-agent-surface-tree]")).not.toBeNull();
    const slot = host.querySelector(
      `.agent-surface__editor-slot[${AGENT_SURFACE_EDITOR_SLOT_ATTRIBUTE}]`,
    );
    expect(slot).not.toBeNull();
    expect(slot?.childElementCount).toBe(0);
    expect(host.querySelector(".monaco-editor")).toBeNull();

    click('[aria-label="Toggle file tree"]');
    expect(aside?.getAttribute("data-tree")).toBe("hidden");
    expect(host.querySelector("[data-agent-surface-tree]")).toBeNull();
    expect(host.querySelector(`[${AGENT_SURFACE_EDITOR_SLOT_ATTRIBUTE}]`)).not.toBeNull();
  });

  it("reports the tree hidden when the Files surface has no tree to show", () => {
    render({ layout: { rightSurface: "files" }, fileTree: null, thread: null });
    const aside = host.querySelector("aside.agent-surface");
    expect(aside?.getAttribute("data-tree")).toBe("hidden");
    expect(host.querySelector("[data-agent-surface-tree]")).toBeNull();
    expect(host.querySelector(`[${AGENT_SURFACE_EDITOR_SLOT_ATTRIBUTE}]`)).not.toBeNull();

    render({ layout: { rightSurface: "diff" } });
    expect(host.querySelector("aside.agent-surface")?.getAttribute("data-tree")).toBe("hidden");
  });

  it("lazily mounts the real Diff and Terminal surfaces with the selected thread", async () => {
    const gateway = fakeTerminalGateway();
    const props = defaultProps();
    const terminal = { ...props.terminal!, terminalGateway: gateway };
    render({ layout: { rightSurface: "diff" }, terminal });
    await waitForReact(() =>
      expect(host.querySelector("[data-agent-surface-diff]")).not.toBeNull(),
    );
    expect(host.querySelector('[aria-label="Refresh changes for agent agt-1"]')).not.toBeNull();
    expect(host.querySelector("[data-agent-surface-terminal]")).toBeNull();

    render({ layout: { rightSurface: "terminal" }, terminal });
    await waitForReact(() =>
      expect(host.querySelector('[role="tablist"][aria-label="Terminal sessions"]')).not.toBeNull(),
    );
    expect(host.querySelector("[data-agent-surface-diff]")).toBeNull();
    await waitForReact(() => expect(gateway.start).toHaveBeenCalledTimes(1));

    render({ layout: { rightSurface: null }, terminal });
    expect(host.querySelector("[data-agent-surface-terminal]")).toBeNull();
    expect(host.querySelector(".agent-surface-empty")).not.toBeNull();
    await waitForReact(() => expect(gateway.stop).toHaveBeenCalledWith(1));
  });

  it("blocks the Terminal tab and card for a thread outside the workspace root", () => {
    render({ workspaceRoot: "/workspace/other" });
    expect(reasons()).toEqual([SURFACE_FOREIGN_ROOT_TERMINAL_REASON]);
    const tab = host.querySelector<HTMLButtonElement>('[role="tab"]:nth-child(3)');
    expect(tab?.disabled).toBe(true);
    expect(tab?.title).toBe(SURFACE_FOREIGN_ROOT_TERMINAL_REASON);
  });

  it("wires expand, close, tabs and the layout controls slot", () => {
    const onExpandEditor = vi.fn();
    const onCloseSurface = vi.fn();
    const onChooseSurface = vi.fn();
    render({
      layout: { rightSurface: "files" },
      layoutControls: <button data-layout-control type="button" />,
      onChooseSurface,
      onCloseSurface,
      onExpandEditor,
    });

    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Files");
    click('[aria-label="Expand to editor (⌥⌘E)"]');
    click('[aria-label="Close surface"]');
    click('[role="tab"]:nth-child(3)');
    expect(onExpandEditor).toHaveBeenCalledTimes(1);
    expect(onCloseSurface).toHaveBeenCalledTimes(1);
    expect(onChooseSurface).toHaveBeenCalledWith("terminal");
    expect(
      host.querySelector(".agent-surface__layout-controls [data-layout-control]"),
    ).not.toBeNull();
    expect(host.querySelector('[role="separator"][aria-orientation="vertical"]')).not.toBeNull();
  });

  function reasons(): string[] {
    return Array.from(host.querySelectorAll(".agent-surface-card__reason")).map(
      (element) => element.firstChild?.textContent ?? "",
    );
  }

  function render(overrides: Partial<AgentSurfacePanelProps> = {}): void {
    act(() => root.render(<AgentSurfacePanel {...defaultProps()} {...overrides} />));
  }

  function click(selector: string): void {
    const element = host.querySelector<HTMLElement>(selector);
    expect(element, `Missing element ${selector}`).not.toBeNull();
    act(() => element?.click());
  }
});

function tree(): AgentSurfaceFileTreeSurface {
  return {
    rootPath: SURFACE_FIXTURE_WORKTREE,
    entriesByDirectory: { [SURFACE_FIXTURE_WORKTREE]: [] },
    expandedDirectories: new Set(),
    loadingDirectories: new Set(),
    failedDirectories: new Set(),
    truncatedDirectories: new Set(),
    rootError: null,
    toggleDirectory: () => undefined,
    retryDirectory: () => undefined,
    refresh: () => undefined,
  };
}

function defaultProps(): AgentSurfacePanelProps {
  const thread = surfaceThreadView();
  return {
    layout: { rightSurface: null },
    thread,
    workspaceRoot: "/workspace/app",
    workspaceTrusted: true,
    layoutControls: null,
    fileTree: {
      tree: tree(),
      activePath: null,
      revealActivePathSignal: 0,
      onOpenFile: () => undefined,
      onPreviewFile: () => undefined,
    },
    diff: {
      summary: null,
      monacoTheme: "calm-dark",
      onShowChanges: () => undefined,
      onRefreshChanges: () => undefined,
      onShowFileDiff: () => undefined,
      onHideFileDiff: () => undefined,
      onOpenChangedFile: () => undefined,
      onOpenChangedFileDiff: () => undefined,
    },
    terminal: {
      workspaceId: "ws-1",
      workspaceRoot: "/workspace/app",
      workspaceTrusted: true,
      terminalGateway: fakeTerminalGateway(),
      terminalTheme: terminalThemeStub(),
      profileId: null,
      profileLabel: null,
      shellIntegrationEnabled: false,
    },
    onChooseSurface: () => undefined,
    onCloseSurface: () => undefined,
    onExpandEditor: () => undefined,
  };
}

function terminalThemeStub(): NonNullable<AgentSurfacePanelProps["terminal"]>["terminalTheme"] {
  return new Proxy({} as NonNullable<AgentSurfacePanelProps["terminal"]>["terminalTheme"], {
    get: () => "#000000",
  });
}
