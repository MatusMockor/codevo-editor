// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FitAddon } from "@xterm/addon-fit";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSurfaceFileTreeSurface } from "../../application/useAgentSurfaceFileTree";
import type { AgentSurfaceKind } from "../../domain/agentWorkbenchLayout";
import { waitForReact } from "../../test/reactTestLifecycle";
import { AGENT_SURFACE_HOTKEYS, agentSurfaceForHotkey } from "./agentSurfaceHotkeys";
import {
  AGENT_SURFACE_EDITOR_SLOT_ATTRIBUTE,
  AgentSurfacePanel,
  type AgentSurfacePanelProps,
} from "./AgentSurfacePanel";
import {
  SURFACE_FILES_THREAD_DESCRIPTION,
  SURFACE_FILES_WORKSPACE_DESCRIPTION,
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

function open(
  openSurfaces: ReadonlyArray<AgentSurfaceKind>,
  activeSurface: AgentSurfaceKind | null,
): AgentSurfacePanelProps["layout"] {
  return { openSurfaces, activeSurface };
}

describe("agentSurfaceForHotkey", () => {
  it("maps the card letters case-insensitively and rejects anything else", () => {
    expect(agentSurfaceForHotkey("f")).toBe("files");
    expect(agentSurfaceForHotkey("D")).toBe("diff");
    expect(agentSurfaceForHotkey("t")).toBe("terminal");
    expect(agentSurfaceForHotkey("x")).toBeNull();
    expect(agentSurfaceForHotkey("Enter")).toBeNull();
    expect(agentSurfaceForHotkey("")).toBeNull();
  });
});

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

  it("shows the chooser with three cards, key hints and no tab strip", () => {
    const onOpenSurface = vi.fn();
    render({ onOpenSurface });

    expect(host.querySelector(".agent-surface-empty__title")?.textContent).toBe("Open a surface");
    expect(host.querySelectorAll(".agent-surface-card")).toHaveLength(3);
    expect(host.querySelector("[data-surface]")?.getAttribute("data-surface")).toBe("empty");
    expect(host.querySelector('[role="tablist"][aria-label="Surfaces"]')).toBeNull();
    expect(host.querySelector('[aria-label="Add surface"]')).toBeNull();
    expect(
      Array.from(host.querySelectorAll(".agent-surface-card__key")).map((key) => key.textContent),
    ).toEqual([
      AGENT_SURFACE_HOTKEYS.files,
      AGENT_SURFACE_HOTKEYS.diff,
      AGENT_SURFACE_HOTKEYS.terminal,
    ]);
    expect(
      host.querySelector('[aria-label="Open Diff surface"]')?.getAttribute("aria-keyshortcuts"),
    ).toBe("D");
    click('[aria-label="Open Diff surface"]');
    expect(onOpenSurface).toHaveBeenCalledWith("diff");
  });

  it("focuses the chooser and opens a surface from its hint letter", () => {
    const onOpenSurface = vi.fn();
    render({ onOpenSurface, thread: null });
    const chooser = host.querySelector<HTMLElement>('[role="group"][aria-label="Open a surface"]');
    expect(chooser).not.toBeNull();
    expect(document.activeElement).toBe(chooser);

    keydown(chooser, "f");
    expect(onOpenSurface).toHaveBeenCalledWith("files");

    keydown(chooser, "d");
    keydown(chooser, "t");
    expect(onOpenSurface).toHaveBeenCalledTimes(1);

    render({ onOpenSurface });
    keydown(host.querySelector<HTMLElement>('[role="group"]'), "T");
    expect(onOpenSurface).toHaveBeenLastCalledWith("terminal");
    keydown(host.querySelector<HTMLElement>('[role="group"]'), "d", { metaKey: true });
    expect(onOpenSurface).toHaveBeenCalledTimes(2);
  });

  it("tells the Files card what it opens with and without a thread", () => {
    render({ thread: null });
    expect(filesCardDescription()).toBe(SURFACE_FILES_WORKSPACE_DESCRIPTION);

    render({ thread: surfaceThreadView() });
    expect(filesCardDescription()).toBe(SURFACE_FILES_THREAD_DESCRIPTION);
  });

  it("disables cards with reasons: no thread, worktree gone, untrusted terminal", () => {
    render({ thread: null });
    expect(reasons()).toEqual([SURFACE_NO_THREAD_REASON, SURFACE_NO_THREAD_REASON]);
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Open Files surface"]')?.disabled,
    ).toBe(false);

    render({ thread: surfaceThreadView({ worktreeMissing: true }) });
    expect(reasons()).toEqual([
      SURFACE_WORKTREE_GONE_REASON,
      SURFACE_WORKTREE_GONE_REASON,
      SURFACE_WORKTREE_GONE_REASON,
    ]);

    const onTrustWorkspace = vi.fn();
    render({ workspaceTrusted: false, onTrustWorkspace });
    expect(reasons()).toEqual([SURFACE_UNTRUSTED_TERMINAL_REASON]);
    click('[aria-label="Trust the workspace"]');
    expect(onTrustWorkspace).toHaveBeenCalledTimes(1);
  });

  it("renders the Files surface as tree plus an empty editor slot and toggles the tree", () => {
    render({ layout: open(["files"], "files") });

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
    expect(host.querySelector(".agent-surface__head .agent-surface__editor-tabs")).not.toBeNull();

    click('[aria-label="Toggle file tree"]');
    expect(aside?.getAttribute("data-tree")).toBe("hidden");
    expect(host.querySelector("[data-agent-surface-tree]")).toBeNull();
    expect(host.querySelector(`[${AGENT_SURFACE_EDITOR_SLOT_ATTRIBUTE}]`)).not.toBeNull();
  });

  it("reports the tree hidden when the Files surface has no tree or is not active", () => {
    render({ layout: open(["files"], "files"), fileTree: null, thread: null });
    const aside = host.querySelector("aside.agent-surface");
    expect(aside?.getAttribute("data-tree")).toBe("hidden");
    expect(host.querySelector('[aria-label="Toggle file tree"]')).toBeNull();
    expect(host.querySelector("[data-agent-surface-tree]")).toBeNull();
    const files = host.querySelector(".agent-surface__files");
    expect(files?.childElementCount).toBe(1);
    expect(files?.firstElementChild?.className).toBe("agent-surface__editor-slot");

    render({ layout: open(["files", "diff"], "diff") });
    expect(host.querySelector("aside.agent-surface")?.getAttribute("data-tree")).toBe("hidden");
    expect(host.querySelector('[aria-label="Toggle file tree"]')).toBeNull();
    expect(host.querySelector("[data-agent-surface-tree]")).toBeNull();
    expect(host.querySelector(".agent-surface__editor-tabs")).toBeNull();

    render({ layout: open(["files"], "files"), hidden: true });
    expect(host.querySelector(".agent-surface__editor-tabs")).toBeNull();
  });

  it("renders one tab per open surface with the close button and no add button", () => {
    const onActivateSurface = vi.fn();
    const onCloseSurfaceTab = vi.fn();
    render({
      layout: open(["files", "diff"], "files"),
      onActivateSurface,
      onCloseSurfaceTab,
    });

    expect(tabLabels()).toEqual(["Files", "Diff"]);
    expect(activeTab()).toBe("Files");
    expect(
      host.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("aria-controls"),
    ).toBe("agent-surface-panel-files");
    expect(host.querySelector(".agent-surface__tabitem--active")?.textContent).toBe("Files");
    expect(host.querySelectorAll(".agent-surface__tab-close")).toHaveLength(2);
    const close = host.querySelector<HTMLElement>('[aria-label="Close Diff tab"]');
    expect(close?.querySelector("svg")?.getAttribute("width")).toBe("14");
    expect(cssRule(agentModeCss, ".agent-surface__tab-close {")).toContain("width: 20px");
    expect(cssRule(agentModeCss, ".agent-surface__tab-close:hover {")).toContain("background:");
    expect(cssRule(agentModeCss, ".workbench-frame {")).toContain(
      "--agent-surface-focus-gutter: 4px",
    );

    click('[role="tab"]#agent-surface-tab-diff');
    expect(onActivateSurface).toHaveBeenCalledWith("diff");
    click('[aria-label="Close Diff tab"]');
    expect(onCloseSurfaceTab).toHaveBeenCalledWith("diff");
    expect(host.querySelector('[aria-label="Add surface"]')).toBeNull();
  });

  it("never renders an add button, whichever surfaces are open", () => {
    render({ layout: open(["files", "diff", "terminal"], "terminal") });
    expect(host.querySelector('[aria-label="Add surface"]')).toBeNull();
    expect(tabLabels()).toEqual(["Files", "Diff", "Terminal"]);

    render({ layout: open(["files"], null) });
    expect(host.querySelector('[aria-label="Add surface"]')).toBeNull();
    expect(tabLabels()).toEqual(["Files"]);
    expect(activeTab()).toBeNull();
    expect(host.querySelector(".agent-surface-empty")).not.toBeNull();
    expect(host.querySelector('[data-surface-panel="files"]')?.hasAttribute("hidden")).toBe(true);
  });

  it("keeps inactive surfaces mounted but hidden and unmounts a closed tab", async () => {
    const gateway = fakeTerminalGateway();
    const props = defaultProps();
    const terminal = { ...props.terminal!, terminalGateway: gateway };
    render({ layout: open(["diff", "terminal"], "terminal"), terminal });
    await waitForReact(() =>
      expect(host.querySelector('[role="tablist"][aria-label="Terminal sessions"]')).not.toBeNull(),
    );
    await waitForReact(() => expect(gateway.start).toHaveBeenCalledTimes(1));
    await waitForReact(() =>
      expect(host.querySelector("[data-agent-surface-diff]")).not.toBeNull(),
    );
    expect(host.querySelector('[data-surface-panel="diff"]')?.hasAttribute("hidden")).toBe(true);
    expect(host.querySelector('[data-surface-panel="terminal"]')?.hasAttribute("hidden")).toBe(
      false,
    );

    render({ layout: open(["diff", "terminal"], "diff"), terminal });
    expect(host.querySelector('[data-surface-panel="terminal"]')?.hasAttribute("hidden")).toBe(
      true,
    );
    expect(host.querySelector("[data-agent-surface-terminal]")).not.toBeNull();
    expect(gateway.stop).not.toHaveBeenCalled();
    expect(gateway.start).toHaveBeenCalledTimes(1);

    render({ layout: open(["diff"], "diff"), terminal });
    expect(host.querySelector("[data-agent-surface-terminal]")).toBeNull();
    await waitForReact(() => expect(gateway.stop).toHaveBeenCalledWith(1));
    expect(host.querySelector("[data-agent-surface-diff]")).not.toBeNull();
  });

  it("keeps an active terminal visible while inactive tabs close and hides it without stopping", async () => {
    const gateway = fakeTerminalGateway();
    const props = defaultProps();
    const terminal = { ...props.terminal!, terminalGateway: gateway };
    render({ layout: open(["files", "diff", "terminal"], "terminal"), terminal });
    await waitForReact(() => expect(gateway.start).toHaveBeenCalledTimes(1));
    await waitForReact(() => expect(gateway.acknowledgeStart).toHaveBeenCalledTimes(1));
    const panel = host.querySelector<HTMLElement>(".terminal-panel");
    const fitResults = vi.mocked(FitAddon).mock.results;
    const fit = fitResults[fitResults.length - 1]?.value.fit as ReturnType<typeof vi.fn>;
    const initialFitCalls = fit.mock.calls.length;
    expect(panel?.hidden).toBe(false);

    render({ layout: open(["diff", "terminal"], "terminal"), terminal });
    expect(host.querySelector(".terminal-panel")).toBe(panel);
    expect(panel?.hidden).toBe(false);
    await waitForReact(() => expect(fit).toHaveBeenCalledTimes(initialFitCalls + 1));
    render({ layout: open(["terminal"], "terminal"), terminal });
    expect(host.querySelector(".terminal-panel")).toBe(panel);
    expect(panel?.hidden).toBe(false);
    await waitForReact(() => expect(fit).toHaveBeenCalledTimes(initialFitCalls + 2));
    expect(gateway.start).toHaveBeenCalledTimes(1);
    expect(gateway.stop).not.toHaveBeenCalled();

    render({ hidden: true, layout: open(["terminal"], "terminal"), terminal });
    expect(panel?.hidden).toBe(true);
    await act(async () => Promise.resolve());
    expect(fit).toHaveBeenCalledTimes(initialFitCalls + 2);
    render({ layout: open(["terminal"], "terminal"), terminal });
    expect(host.querySelector(".terminal-panel")).toBe(panel);
    expect(panel?.hidden).toBe(false);
    await waitForReact(() => expect(fit).toHaveBeenCalledTimes(initialFitCalls + 3));
    expect(gateway.start).toHaveBeenCalledTimes(1);
    expect(gateway.stop).not.toHaveBeenCalled();
  });

  it("explains a blocked open tab instead of mounting its surface", async () => {
    render({ layout: open(["diff", "terminal"], "terminal"), workspaceRoot: "/workspace/other" });
    await act(async () => Promise.resolve());
    expect(host.querySelector("[data-agent-surface-terminal]")).toBeNull();
    expect(host.querySelector('[data-surface-panel="terminal"] .agent-note')?.textContent).toBe(
      SURFACE_FOREIGN_ROOT_TERMINAL_REASON,
    );

    render({ layout: open(["diff"], "diff"), thread: null });
    expect(host.querySelector('[data-surface-panel="diff"] .agent-note')?.textContent).toBe(
      SURFACE_NO_THREAD_REASON,
    );
  });

  it("wires the layout controls slot and resize handle without an overall close button", () => {
    render({
      layout: open(["files"], "files"),
      layoutControls: <button data-layout-control type="button" />,
    });

    expect(
      host.querySelector(".agent-surface__layout-controls [data-layout-control]"),
    ).not.toBeNull();
    expect(host.querySelector('[role="separator"][aria-orientation="vertical"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Close panel"]')).toBeNull();
    expect(host.querySelector('[aria-label="Close Files tab"]')).not.toBeNull();
  });

  it("keeps the tablist owning only tabs and pairs each close button with its panel", () => {
    render({ layout: open(["files", "diff"], "files") });

    const tablist = host.querySelector('[role="tablist"][aria-label="Surfaces"]');
    expect(tablist).not.toBeNull();
    expect(Array.from(tablist?.children ?? []).map((child) => child.getAttribute("role"))).toEqual([
      "presentation",
      "presentation",
    ]);
    expect(host.querySelector('[aria-label="Close Diff tab"]')?.getAttribute("aria-controls")).toBe(
      "agent-surface-panel-diff",
    );
    expect(host.querySelector('[role="tab"]')?.closest('[role="tablist"]')).toBe(tablist);
  });

  it("rolls the tab stop and moves between tabs with the arrow, Home and End keys", () => {
    const onActivateSurface = vi.fn();
    render({ layout: open(["files", "diff", "terminal"], "diff"), onActivateSurface });

    expect(
      Array.from(host.querySelectorAll('[aria-label="Surfaces"] [role="tab"]')).map((tab) =>
        tab.getAttribute("tabindex"),
      ),
    ).toEqual(["-1", "0", "-1"]);

    keydown(host.querySelector<HTMLElement>("#agent-surface-tab-diff"), "ArrowRight");
    expect(onActivateSurface).toHaveBeenLastCalledWith("terminal");

    keydown(host.querySelector<HTMLElement>("#agent-surface-tab-diff"), "ArrowLeft");
    expect(onActivateSurface).toHaveBeenLastCalledWith("files");

    keydown(host.querySelector<HTMLElement>("#agent-surface-tab-diff"), "Home");
    expect(onActivateSurface).toHaveBeenLastCalledWith("files");

    keydown(host.querySelector<HTMLElement>("#agent-surface-tab-diff"), "End");
    expect(onActivateSurface).toHaveBeenLastCalledWith("terminal");

    keydown(host.querySelector<HTMLElement>("#agent-surface-tab-diff"), "ArrowRight", {
      metaKey: true,
    });
    expect(onActivateSurface).toHaveBeenCalledTimes(4);
  });

  it("wraps the arrow keys around the tab strip and focuses the tab it activates", () => {
    render({ layout: open(["files", "diff"], "files") });
    const files = host.querySelector<HTMLElement>("#agent-surface-tab-files");
    files?.focus();

    keydown(files, "ArrowLeft");
    expect(document.activeElement?.id).toBe("agent-surface-tab-diff");
  });

  it("focuses the chooser only when it was explicitly requested", () => {
    render({ chooserAutoFocus: false });
    expect(document.activeElement).not.toBe(
      host.querySelector('[role="group"][aria-label="Open a surface"]'),
    );

    render({ chooserAutoFocus: true });
    expect(document.activeElement).toBe(
      host.querySelector('[role="group"][aria-label="Open a surface"]'),
    );
  });

  it("never focuses the chooser of a hidden panel and reports no tree", () => {
    render({ hidden: true, chooserAutoFocus: true });
    expect(document.activeElement).not.toBe(
      host.querySelector('[role="group"][aria-label="Open a surface"]'),
    );

    render({ hidden: true, layout: open(["files"], "files") });
    expect(host.querySelector("[data-surface]")?.getAttribute("data-tree")).toBe("hidden");
  });

  function tabLabels(): string[] {
    return Array.from(host.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent ?? "");
  }

  function activeTab(): string | null {
    return host.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? null;
  }

  function filesCardDescription(): string {
    return (
      host.querySelector(".agent-surface-card__slot .agent-surface-card__description")
        ?.textContent ?? ""
    );
  }

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

  function keydown(element: HTMLElement | null, key: string, init: KeyboardEventInit = {}): void {
    expect(element).not.toBeNull();
    act(() => {
      element?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
    });
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
    layout: open([], null),
    thread,
    workspaceRoot: "/workspace/app",
    workspaceTrusted: true,
    layoutControls: null,
    hidden: false,
    chooserAutoFocus: true,
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
    onOpenSurface: () => undefined,
    onActivateSurface: () => undefined,
    onCloseSurfaceTab: () => undefined,
  };
}

function terminalThemeStub(): NonNullable<AgentSurfacePanelProps["terminal"]>["terminalTheme"] {
  return new Proxy({} as NonNullable<AgentSurfacePanelProps["terminal"]>["terminalTheme"], {
    get: () => "#000000",
  });
}

const agentModeCss = readFileSync(resolve(import.meta.dirname, "./agentMode.css"), "utf8");

function cssRule(source: string, selector: string): string {
  const start = source.indexOf(selector);
  expect(start, `Missing CSS selector ${selector}`).toBeGreaterThanOrEqual(0);
  const bodyStart = source.indexOf("{", start);
  const end = source.indexOf("}", bodyStart);
  expect(end).toBeGreaterThan(bodyStart);
  return source.slice(bodyStart + 1, end);
}
