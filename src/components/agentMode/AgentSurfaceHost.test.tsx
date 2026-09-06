// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalTheme } from "../../domain/settings";
import type { FileEntry } from "../../domain/workspace";
import { waitForReact } from "../../test/reactTestLifecycle";
import { AgentSurfaceHost, type AgentSurfaceHostProps } from "./AgentSurfaceHost";
import { SURFACE_FOREIGN_ROOT_TERMINAL_REASON } from "./agentSurfacePolicy";
import { SURFACE_FIXTURE_ROOT, surfaceThreadView } from "./agentSurfaceTestFixtures";
import { fakeTerminalGateway, installResizeObserver } from "./agentSurfaceTerminalTestSupport";
import {
  UNAVAILABLE_AGENT_SCRIPT_RUNNER,
  type AgentWorkbenchChrome,
  type AgentWorkbenchFileTreeChrome,
} from "./agentWorkbenchChrome";
import {
  recordedLayoutState,
  reduceRecordedLayout,
  type RecordedAgentWorkbenchLayout,
} from "./agentWorkbenchChromeTestFixtures";

vi.mock("@xterm/xterm", async () =>
  (await import("./agentSurfaceTerminalTestSupport")).xtermMockModule(),
);
vi.mock("@xterm/addon-fit", async () =>
  (await import("./agentSurfaceTerminalTestSupport")).fitAddonMockModule(),
);

const TABLIST = '[role="tablist"][aria-label="Terminal sessions"]';

describe("AgentSurfaceHost", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    installResizeObserver();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("starts the thread terminal on the registered workspace root, not the thread checkout", async () => {
    const gateway = fakeTerminalGateway();
    render({
      chrome: chrome(gateway),
      layout: { openSurfaces: ["terminal"], activeSurface: "terminal" },
    });
    await waitForReact(() => expect(host.querySelector(TABLIST)).not.toBeNull());
    await waitForReact(() => expect(gateway.start).toHaveBeenCalledTimes(1));
    expect(gateway.start).toHaveBeenCalledWith(
      SURFACE_FIXTURE_ROOT,
      { cols: 80, rows: 24 },
      undefined,
      false,
      { kind: "agentWorktree", threadId: "agt-1" },
    );
  });

  it("blocks the terminal truthfully for a thread whose repository is not the workspace root", async () => {
    const gateway = fakeTerminalGateway();
    const thread = surfaceThreadView({
      thread: {
        owner: {
          rootKey: "/workspace/other",
          ownerId: "agent-root:other",
          repositoryRoot: "/workspace/other",
        },
      },
    } as never);
    render({
      chrome: chrome(gateway),
      layout: { openSurfaces: ["terminal"], activeSurface: "terminal" },
      thread,
    });
    await waitForReact(() =>
      expect(
        host.querySelector('[data-surface-panel="terminal"] .agent-note--warning'),
      ).not.toBeNull(),
    );
    expect(
      host.querySelector('[data-surface-panel="terminal"] .agent-note--warning')?.textContent,
    ).toBe(SURFACE_FOREIGN_ROOT_TERMINAL_REASON);
    expect(host.querySelector(TABLIST)).toBeNull();
    expect(gateway.start).not.toHaveBeenCalled();

    render({ chrome: chrome(gateway), layout: { openSurfaces: [], activeSurface: null }, thread });
    const card = host.querySelector<HTMLButtonElement>('[aria-label="Open Terminal surface"]');
    expect(card?.disabled).toBe(true);
    expect(host.querySelector("#agent-surface-card-terminal")?.textContent).toBe(
      SURFACE_FOREIGN_ROOT_TERMINAL_REASON,
    );
  });

  it("offers no terminal without a registered workspace root", async () => {
    const gateway = fakeTerminalGateway();
    render({
      chrome: chrome(gateway),
      layout: { openSurfaces: ["terminal"], activeSurface: "terminal" },
      workspaceRoot: null,
    });
    await act(async () => Promise.resolve());
    expect(host.querySelector(TABLIST)).toBeNull();
    expect(gateway.start).not.toHaveBeenCalled();
  });

  it("maximizes the docked panel when a file is previewed or opened from the tree", async () => {
    const layout = recordedLayoutState({
      rightPanel: "open",
      openSurfaces: ["files"],
      activeSurface: "files",
    });
    const onOpenFile = vi.fn();
    const onPreviewFile = vi.fn();
    render({
      chrome: filesChrome(layout, { onOpenFile, onPreviewFile }),
      layout: { openSurfaces: ["files"], activeSurface: "files" },
    });
    const row = await treeRow("users.ts");

    act(() => row.click());
    expect(onPreviewFile).toHaveBeenCalledWith(expect.objectContaining({ name: "users.ts" }));
    expect(layout.actions).toEqual([{ kind: "maximizeRightPanel" }]);
    expect(reduceRecordedLayout(layout).rightPanelMaximized).toBe(true);

    act(() => {
      row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({ name: "users.ts" }));
    expect(layout.actions).toEqual([
      { kind: "maximizeRightPanel" },
      { kind: "maximizeRightPanel" },
    ]);
    expect(reduceRecordedLayout(layout)).toMatchObject({
      rightPanel: "open",
      openSurfaces: ["files"],
      activeSurface: "files",
      rightPanelMaximized: true,
    });
  });

  it("keeps the tree and the editor slot after a restore without re-maximizing", async () => {
    const maximized = recordedLayoutState({
      rightPanel: "open",
      openSurfaces: ["files"],
      activeSurface: "files",
      rightPanelMaximized: true,
    });
    render({
      chrome: filesChrome(maximized),
      layout: { openSurfaces: ["files"], activeSurface: "files" },
    });
    await treeRow("users.ts");

    const restored = recordedLayoutState(
      reduceRecordedLayout({
        ...maximized,
        actions: [{ kind: "toggleMaximized" }],
      }),
    );
    expect(restored.layout.rightPanelMaximized).toBe(false);
    render({
      chrome: filesChrome(restored),
      layout: { openSurfaces: ["files"], activeSurface: "files" },
    });

    expect(host.querySelector("[data-agent-surface-tree]")).not.toBeNull();
    expect(host.querySelector(".agent-surface__editor-slot")).not.toBeNull();
    expect(restored.actions).toEqual([]);
  });

  it("wires Search files to the quick-open capability with its keymap chord", async () => {
    const onSearchFiles = vi.fn();
    const layout = recordedLayoutState({
      rightPanel: "open",
      openSurfaces: ["files"],
      activeSurface: "files",
    });
    render({
      chrome: filesChrome(layout, { onSearchFiles, searchFilesShortcut: "Ctrl+P" }),
      layout: { openSurfaces: ["files"], activeSurface: "files" },
    });
    await treeRow("users.ts");

    const search = host.querySelector<HTMLButtonElement>(".agent-surface-tree__search");
    expect(search?.getAttribute("aria-keyshortcuts")).toBe("Control+P");
    act(() => search?.click());
    expect(onSearchFiles).toHaveBeenCalledTimes(1);
    expect(layout.actions).toEqual([]);
  });

  async function treeRow(name: string): Promise<HTMLButtonElement> {
    let row: HTMLButtonElement | null = null;
    await waitForReact(() => {
      row =
        Array.from(host.querySelectorAll<HTMLButtonElement>(".tree-row")).find((candidate) =>
          candidate.textContent?.includes(name),
        ) ?? null;
      expect(row).not.toBeNull();
    });
    return row!;
  }

  function render(overrides: Partial<AgentSurfaceHostProps> = {}): void {
    act(() => root.render(<AgentSurfaceHost {...defaultProps()} {...overrides} />));
  }
});

function filesChrome(
  layout: RecordedAgentWorkbenchLayout,
  overrides: Partial<AgentWorkbenchFileTreeChrome> = {},
): AgentWorkbenchChrome {
  return {
    ...chrome(fakeTerminalGateway()),
    layout,
    fileTree: {
      files: {
        readDirectory: async (path: string): Promise<FileEntry[]> => [
          { name: "users.ts", path: `${path}/users.ts`, kind: "file" },
        ],
      },
      fileChanges: null,
      activePath: null,
      revealActivePathSignal: 0,
      onOpenFile: () => undefined,
      onPreviewFile: () => undefined,
      ...overrides,
    },
  };
}

function chrome(
  terminalGateway: AgentWorkbenchChrome["terminal"] extends infer T
    ? T extends { readonly terminalGateway: infer G }
      ? G
      : never
    : never,
): AgentWorkbenchChrome {
  return {
    layout: { layout: { openSurfaces: ["terminal"], activeSurface: "terminal" } } as never,
    bottomPanelVisible: false,
    shortcuts: null,
    scripts: UNAVAILABLE_AGENT_SCRIPT_RUNNER,
    workspaceId: "ws-1",
    workspaceTrusted: true,
    fileTree: null,
    diff: { monacoTheme: "calm-dark" },
    terminal: {
      terminalGateway,
      terminalTheme: new Proxy({} as TerminalTheme, { get: () => "#000000" }),
      shellIntegrationEnabled: false,
    },
    onToggleBottomPanel: () => undefined,
    onShowTerminalPanel: () => undefined,
    onOpenScriptsView: null,
    addProject: null,
    revealPath: async () => undefined,
  };
}

function defaultProps(): AgentSurfaceHostProps {
  return {
    chrome: chrome(fakeTerminalGateway()),
    layout: { openSurfaces: [], activeSurface: null },
    thread: surfaceThreadView(),
    workspaceRoot: SURFACE_FIXTURE_ROOT,
    hidden: false,
    chooserAutoFocus: true,
    agents: {
      showChanges: async () => undefined,
      showFileDiff: async () => undefined,
      hideFileDiff: () => undefined,
      openChangedFile: async () => undefined,
      openChangedFileDiff: async () => undefined,
    },
    layoutControls: null,
    onOpenSurface: () => undefined,
    onActivateSurface: () => undefined,
    onCloseSurfaceTab: () => undefined,
  };
}
