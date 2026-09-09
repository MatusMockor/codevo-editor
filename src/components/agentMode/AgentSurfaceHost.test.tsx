// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalTheme } from "../../domain/settings";
import type { FileEntry } from "../../domain/workspace";
import { waitForReact } from "../../test/reactTestLifecycle";
import { AgentSurfaceHost, type AgentSurfaceHostProps } from "./AgentSurfaceHost";
import { NO_AGENT_SURFACE_SCOPE, type AgentSurfaceScope } from "./agentSurfacePolicy";
import {
  SURFACE_FIXTURE_ROOT,
  SURFACE_FIXTURE_WORKTREE,
  surfaceRepositoryScope,
  surfaceThreadView,
} from "./agentSurfaceTestFixtures";
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
const FILES_LAYOUT = { openSurfaces: ["files"], activeSurface: "files" } as const;
const OTHER_ROOT = "/workspace/other";

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
    await act(async () => Promise.resolve());
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Select an available project to use this panel.",
    );
    expect(host.querySelector(TABLIST)).toBeNull();
    expect(gateway.start).not.toHaveBeenCalled();
    render({ chrome: chrome(gateway), layout: { openSurfaces: [], activeSurface: null }, thread });
    expect(host.querySelector('[aria-label="Open Terminal surface"]')).toBeNull();
  });

  it("opens a project terminal before its first thread exists", async () => {
    const gateway = fakeTerminalGateway();
    render({
      chrome: chrome(gateway),
      thread: null,
      threadRootPath: null,
      layout: { openSurfaces: ["terminal"], activeSurface: "terminal" },
    });
    await waitForReact(() => expect(gateway.start).toHaveBeenCalledTimes(1));
    expect(gateway.start).toHaveBeenCalledWith(
      SURFACE_FIXTURE_ROOT,
      { cols: 80, rows: 24 },
      undefined,
      false,
      { kind: "workspaceRoot" },
    );
    expect(host.querySelector('[aria-label="Project terminal"]')).not.toBeNull();
  });

  it("masks every surface during activation and offers retry after failure", async () => {
    const gateway = fakeTerminalGateway();
    const readDirectory = vi.fn(listing);
    const layout = recordedLayoutState(FILES_LAYOUT);
    const retry = vi.fn();
    const base = {
      ...filesChrome(layout, { files: { readDirectory } }),
      terminal: chrome(gateway).terminal,
    };
    for (const activeSurface of ["files", "diff", "history", "terminal"] as const) {
      render({
        chrome: {
          ...base,
          workspaceActivation: {
            state: { kind: "pending", rootPath: SURFACE_FIXTURE_ROOT },
            select: vi.fn(),
            retry,
          },
        },
        layout: { openSurfaces: [activeSurface], activeSurface },
      });
      await act(async () => Promise.resolve());
      expect(host.querySelector('[role="status"]')?.textContent).toBe("Opening project…");
      expect(host.querySelector('[role="tab"]')).not.toBeNull();
      expect(host.querySelector(".agent-surface__editor-slot")).toBeNull();
      expect(host.querySelector('[role="tabpanel"]')).toBeNull();
    }
    expect(readDirectory).not.toHaveBeenCalled();
    expect(gateway.start).not.toHaveBeenCalled();
    render({
      chrome: {
        ...base,
        workspaceActivation: {
          state: { kind: "failed", rootPath: SURFACE_FIXTURE_ROOT, message: "Could not open app." },
          select: vi.fn(),
          retry,
        },
      },
      layout: FILES_LAYOUT,
    });
    act(() => host.querySelector<HTMLButtonElement>('[role="status"] button')?.click());
    expect(retry).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Could not open app.");
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
    render({ chrome: filesChrome(layout, { onOpenFile, onPreviewFile }), layout: FILES_LAYOUT });
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
    render({ chrome: filesChrome(maximized), layout: FILES_LAYOUT });
    await treeRow("users.ts");

    const restored = recordedLayoutState(
      reduceRecordedLayout({
        ...maximized,
        actions: [{ kind: "toggleMaximized" }],
      }),
    );
    expect(restored.layout.rightPanelMaximized).toBe(false);
    render({ chrome: filesChrome(restored), layout: FILES_LAYOUT });

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
      layout: FILES_LAYOUT,
    });
    await treeRow("users.ts");

    const search = host.querySelector<HTMLButtonElement>(".agent-surface-tree__search");
    expect(search?.getAttribute("aria-keyshortcuts")).toBe("Control+P");
    act(() => search?.click());
    expect(onSearchFiles).toHaveBeenCalledTimes(1);
    expect(layout.actions).toEqual([]);
  });

  describe("without a selected thread", () => {
    it("browses the trusted rail scope repository root with Refresh and Search files", async () => {
      const readDirectory = vi.fn(listing);
      const onSearchFiles = vi.fn();
      const layout = recordedLayoutState(FILES_LAYOUT);
      render({
        chrome: filesChrome(layout, { files: { readDirectory }, onSearchFiles }),
        layout: FILES_LAYOUT,
        thread: null,
        threadRootPath: null,
        scope: { ...surfaceRepositoryScope(OTHER_ROOT), repositoryRoot: `${OTHER_ROOT}/pa-ai-be` },
        workspaceRoot: OTHER_ROOT,
      });

      const row = await treeRow(`${OTHER_ROOT}/users.ts`);
      expect(readDirectory).toHaveBeenCalledWith(OTHER_ROOT);
      expect(readDirectory).not.toHaveBeenCalledWith(`${OTHER_ROOT}/pa-ai-be`);
      expect(readDirectory).not.toHaveBeenCalledWith(SURFACE_FIXTURE_WORKTREE);
      expect(row).not.toBeNull();
      expect(host.querySelector("[data-agent-surface-tree]")?.getAttribute("aria-label")).toBe(
        "Project files",
      );
      expect(host.querySelector("[data-agent-surface-tree-unavailable]")).toBeNull();

      const refresh = host.querySelector<HTMLButtonElement>(
        '[aria-label="Refresh workspace files"]',
      );
      expect(refresh?.disabled).toBe(false);
      act(() => refresh?.click());
      await waitForReact(() => expect(readDirectory).toHaveBeenCalledTimes(2));

      act(() => host.querySelector<HTMLButtonElement>(".agent-surface-tree__search")?.click());
      expect(onSearchFiles).toHaveBeenCalledTimes(1);
    });

    it("opens a scope file through the chrome and maximizes the docked panel", async () => {
      const onOpenFile = vi.fn();
      const onPreviewFile = vi.fn();
      const layout = recordedLayoutState({ rightPanel: "open", ...FILES_LAYOUT });
      render({
        chrome: filesChrome(layout, { onOpenFile, onPreviewFile }),
        layout: FILES_LAYOUT,
        thread: null,
        scope: surfaceRepositoryScope(),
      });
      const row = await treeRow(`${SURFACE_FIXTURE_ROOT}/users.ts`);

      act(() => row.click());
      expect(onPreviewFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: `${SURFACE_FIXTURE_ROOT}/users.ts` }),
      );
      act(() => {
        row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      });
      expect(onOpenFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: `${SURFACE_FIXTURE_ROOT}/users.ts` }),
      );
      expect(layout.actions).toEqual([
        { kind: "maximizeRightPanel" },
        { kind: "maximizeRightPanel" },
      ]);
    });

    it("shows the trust notice for an untrusted scope and never reads its files", async () => {
      const readDirectory = vi.fn(listing);
      const onTrustScope = vi.fn();
      const layout = recordedLayoutState(FILES_LAYOUT);
      render({
        chrome: filesChrome(layout, { files: { readDirectory } }),
        layout: FILES_LAYOUT,
        thread: null,
        scope: { kind: "untrusted", projectRootKey: "key:other", repositoryRoot: OTHER_ROOT },
        onTrustScope,
      });
      await act(async () => Promise.resolve());

      const note = host.querySelector('[role="status"]');
      expect(note?.textContent).toBe("Select an available project to use this panel.");
      expect(host.querySelector(".tree-row")).toBeNull();
      expect(readDirectory).not.toHaveBeenCalled();
      expect(
        host.querySelector<HTMLButtonElement>('[aria-label="Refresh workspace files"]'),
      ).toBeNull();

      expect(host.querySelector('[aria-label="Trust the project"]')).toBeNull();
      expect(onTrustScope).not.toHaveBeenCalled();
    });

    it("hides foreign project content until its workspace is activated", async () => {
      const readDirectory = vi.fn(listing);
      const onSwitchScope = vi.fn();
      const layout = recordedLayoutState(FILES_LAYOUT);
      const scope: AgentSurfaceScope = {
        kind: "foreignRoot",
        projectRootKey: "key:other",
        repositoryRoot: OTHER_ROOT,
        rootPath: OTHER_ROOT,
        label: "other",
      };
      render({
        chrome: filesChrome(layout, { files: { readDirectory }, activePath: `${OTHER_ROOT}/a.ts` }),
        layout: FILES_LAYOUT,
        thread: null,
        scope,
        onSwitchScope,
      });
      await act(async () => Promise.resolve());

      expect(host.querySelector('[role="status"]')?.textContent).toBe(
        "Select an available project to use this panel.",
      );
      expect(host.querySelector(".tree-row")).toBeNull();
      expect(host.querySelector(".tree-row.active")).toBeNull();
      expect(readDirectory).not.toHaveBeenCalled();
      expect(host.querySelector(".agent-surface__editor-slot")).toBeNull();

      act(() => host.querySelector<HTMLButtonElement>('[aria-label="Switch to other"]')?.click());
      expect(onSwitchScope).not.toHaveBeenCalled();
      expect(layout.actions).toEqual([]);

      render({
        chrome: filesChrome(layout, { files: { readDirectory } }),
        layout: FILES_LAYOUT,
        thread: null,
        scope,
        onSwitchScope: null,
      });
      expect(host.querySelector('[aria-label="Switch to other"]')).toBeNull();
      expect(readDirectory).not.toHaveBeenCalled();
    });

    it("hides the editor portal with a truthful note when the scope has no project", async () => {
      const readDirectory = vi.fn(listing);
      const layout = recordedLayoutState(FILES_LAYOUT);
      render({
        chrome: filesChrome(layout, { files: { readDirectory } }),
        layout: FILES_LAYOUT,
        thread: null,
        scope: NO_AGENT_SURFACE_SCOPE,
      });
      await act(async () => Promise.resolve());

      expect(host.querySelector('[role="status"]')?.textContent).toBe(
        "Select an available project to use this panel.",
      );
      expect(host.querySelector(".agent-surface__editor-slot")).toBeNull();
      expect(host.querySelector(".tree-row")).toBeNull();
      expect(readDirectory).not.toHaveBeenCalled();
    });

    it("drops rows of a superseded scope across A -> B -> A", async () => {
      const pending = new Map<string, (entries: FileEntry[]) => void>();
      const readDirectory = vi.fn(
        (path: string) =>
          new Promise<FileEntry[]>((resolve) => {
            pending.set(`${path}#${readDirectory.mock.calls.length}`, resolve);
          }),
      );
      const layout = recordedLayoutState(FILES_LAYOUT);
      const chromeWithFiles = filesChrome(layout, { files: { readDirectory } });
      const scopeA = surfaceRepositoryScope(SURFACE_FIXTURE_ROOT, 1);
      const scopeB = surfaceRepositoryScope(OTHER_ROOT, 1);

      render({ chrome: chromeWithFiles, layout: FILES_LAYOUT, thread: null, scope: scopeA });
      await waitForReact(() => expect(readDirectory).toHaveBeenCalledTimes(1));
      render({
        chrome: chromeWithFiles,
        layout: FILES_LAYOUT,
        thread: null,
        scope: scopeB,
        workspaceRoot: OTHER_ROOT,
      });
      await waitForReact(() => expect(readDirectory).toHaveBeenCalledTimes(2));
      render({ chrome: chromeWithFiles, layout: FILES_LAYOUT, thread: null, scope: scopeA });
      await waitForReact(() => expect(readDirectory).toHaveBeenCalledTimes(3));

      await act(async () => {
        pending.get(`${SURFACE_FIXTURE_ROOT}#1`)?.([file(`${SURFACE_FIXTURE_ROOT}/stale-a.ts`)]);
        pending.get(`${OTHER_ROOT}#2`)?.([file(`${OTHER_ROOT}/stale-b.ts`)]);
        await Promise.resolve();
      });
      expect(rowPaths()).toEqual([]);

      await act(async () => {
        pending.get(`${SURFACE_FIXTURE_ROOT}#3`)?.([file(`${SURFACE_FIXTURE_ROOT}/fresh-a.ts`)]);
        await Promise.resolve();
      });
      await waitForReact(() => expect(rowPaths()).toEqual([`${SURFACE_FIXTURE_ROOT}/fresh-a.ts`]));
    });

    it("resets the tree when the same scope root is re-leased under a new generation", async () => {
      const readDirectory = vi.fn(listing);
      const layout = recordedLayoutState(FILES_LAYOUT);
      const chromeWithFiles = filesChrome(layout, { files: { readDirectory } });
      render({
        chrome: chromeWithFiles,
        layout: FILES_LAYOUT,
        thread: null,
        scope: surfaceRepositoryScope(SURFACE_FIXTURE_ROOT, 1),
      });
      await treeRow("users.ts");
      render({
        chrome: chromeWithFiles,
        layout: FILES_LAYOUT,
        thread: null,
        scope: surfaceRepositoryScope(SURFACE_FIXTURE_ROOT, 2),
      });
      await waitForReact(() => expect(readDirectory).toHaveBeenCalledTimes(2));
    });
  });

  it("browses the project folder for an in-place thread and the checkout for a worktree thread", async () => {
    const readDirectory = vi.fn(listing);
    const layout = recordedLayoutState(FILES_LAYOUT);
    const nested = `${SURFACE_FIXTURE_ROOT}/pa-ai-be`;
    const inPlace = surfaceThreadView({
      thread: {
        ...surfaceThreadView().thread,
        owner: { ...surfaceThreadView().thread.owner, repositoryRoot: nested },
        target: { isolation: "in-place", worktreePath: null },
      },
    });
    render({
      chrome: filesChrome(layout, { files: { readDirectory } }),
      layout: FILES_LAYOUT,
      scope: surfaceRepositoryScope(),
      thread: inPlace,
      threadRootPath: SURFACE_FIXTURE_ROOT,
    });

    await treeRow(`${SURFACE_FIXTURE_ROOT}/users.ts`);
    expect(readDirectory).toHaveBeenCalledWith(SURFACE_FIXTURE_ROOT);
    expect(readDirectory).not.toHaveBeenCalledWith(nested);
    expect(readDirectory).not.toHaveBeenCalledWith(OTHER_ROOT);

    render({
      chrome: filesChrome(layout, { files: { readDirectory } }),
      layout: FILES_LAYOUT,
      scope: surfaceRepositoryScope(),
      thread: surfaceThreadView(),
      threadRootPath: SURFACE_FIXTURE_WORKTREE,
    });

    await treeRow(`${SURFACE_FIXTURE_WORKTREE}/users.ts`);
    expect(readDirectory).toHaveBeenCalledWith(SURFACE_FIXTURE_WORKTREE);
  });

  it("hides a thread checkout when the selected project does not own it", async () => {
    const readDirectory = vi.fn(listing);
    const layout = recordedLayoutState(FILES_LAYOUT);
    render({
      chrome: filesChrome(layout, { files: { readDirectory } }),
      layout: FILES_LAYOUT,
      scope: surfaceRepositoryScope(OTHER_ROOT),
      workspaceRoot: OTHER_ROOT,
    });
    await act(async () => Promise.resolve());
    expect(readDirectory).not.toHaveBeenCalled();
    expect(host.querySelector(".tree-row")).toBeNull();
    expect(host.querySelector(".agent-surface__editor-slot")).toBeNull();
  });

  function rowPaths(): string[] {
    return Array.from(host.querySelectorAll<HTMLButtonElement>(".tree-row")).map(
      (row) => row.title,
    );
  }

  async function treeRow(name: string): Promise<HTMLButtonElement> {
    let row: HTMLButtonElement | null = null;
    await waitForReact(() => {
      row =
        Array.from(host.querySelectorAll<HTMLButtonElement>(".tree-row")).find((candidate) =>
          candidate.textContent?.includes(name.slice(name.lastIndexOf("/") + 1)),
        ) ?? null;
      expect(row).not.toBeNull();
    });
    return row!;
  }

  function render(overrides: Partial<AgentSurfaceHostProps> = {}): void {
    act(() => root.render(<AgentSurfaceHost {...defaultProps()} {...overrides} />));
  }
});

function file(path: string): FileEntry {
  return { name: path.slice(path.lastIndexOf("/") + 1), path, kind: "file" };
}

async function listing(path: string): Promise<FileEntry[]> {
  return [file(`${path}/users.ts`)];
}

function filesChrome(
  layout: RecordedAgentWorkbenchLayout,
  overrides: Partial<AgentWorkbenchFileTreeChrome> = {},
): AgentWorkbenchChrome {
  return {
    ...chrome(fakeTerminalGateway()),
    layout,
    fileTree: {
      files: { readDirectory: listing },
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
  const scope: AgentSurfaceScope = surfaceRepositoryScope();
  return {
    chrome: chrome(fakeTerminalGateway()),
    layout: { openSurfaces: [], activeSurface: null },
    thread: surfaceThreadView(),
    threadRootPath: SURFACE_FIXTURE_WORKTREE,
    scope,
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
    onTrustScope: () => undefined,
    onSwitchScope: null,
  };
}
