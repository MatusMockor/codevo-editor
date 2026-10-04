// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalTheme } from "../../domain/settings";
import type { FileEntry } from "../../domain/workspace";
import { waitForReact } from "../../test/reactTestLifecycle";
import type { AgentRemoteSurface } from "./agentRemoteSurface";
import { AgentSurfaceHost, type AgentSurfaceHostProps } from "./AgentSurfaceHost";
import { NO_AGENT_SURFACE_SCOPE, type AgentSurfaceScope } from "./agentSurfacePolicy";
import {
  SURFACE_FIXTURE_ROOT,
  SURFACE_FIXTURE_WORKTREE,
  surfaceActivation,
  surfaceRepositoryScope,
  surfaceThreadView,
} from "./agentSurfaceTestFixtures";
import { fakeTerminalGateway, installResizeObserver } from "./agentSurfaceTerminalTestSupport";
import { agentShortcutGlyphs } from "./agentThreadHeaderPresentation";
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
import { rightPanelTestContext } from "./rightPanel/agentRightPanelTestSupport";
import {
  EditorPanelDocumentsContext,
  type EditorPanelDocumentsValue,
} from "../editorPanel/EditorPanelDocumentsContext";

vi.mock("@xterm/xterm", async () =>
  (await import("./agentSurfaceTerminalTestSupport")).xtermMockModule(),
);
vi.mock("@xterm/addon-fit", async () =>
  (await import("./agentSurfaceTerminalTestSupport")).fitAddonMockModule(),
);

vi.mock("../remoteRunner/RemoteFilesPanel", () => ({
  RemoteFilesPanel: ({ scope }: { scope: { taskId?: string } }) => (
    <div data-remote-files={scope.taskId ?? "project"} />
  ),
}));
vi.mock("../remoteRunner/RemoteGitHistoryPanel", () => ({
  RemoteGitHistoryPanel: () => <div data-remote-history />,
}));
vi.mock("../remoteRunner/RemoteTerminalPanel", () => ({
  RemoteTerminalPanel: () => <div data-remote-terminal />,
}));

const TERMINAL_ACTIONS = '[role="toolbar"][aria-label="Terminal actions"]';
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

  it("renders supported server panels only through their remote gateway", async () => {
    const remoteSurface = readyRemoteSurface();
    const local = surfaceThreadView();
    const thread = {
      ...local,
      execution: {
        kind: "remote" as const,
        ...remoteSurface.scope,
        taskId: undefined,
        conversationId: "conversation",
        latestTaskId: "task",
        resume: null,
      },
    };
    const readDirectory = vi.fn(listing);
    const gateway = fakeTerminalGateway();
    for (const activeSurface of ["files", "history", "terminal"] as const) {
      render({
        thread,
        remoteSurface,
        chrome: {
          ...filesChrome(recordedLayoutState(FILES_LAYOUT), { files: { readDirectory } }),
          terminal: chrome(gateway).terminal,
        },
        layout: { openSurfaces: ["files", "history", "terminal"], activeSurface },
      });
      await waitForReact(() =>
        expect(host.querySelector(`[data-remote-${activeSurface}]`)).not.toBeNull(),
      );
      expect(host.querySelector("[data-agent-editor-slot]")).toBeNull();
      expect(host.textContent).not.toContain("not available");
    }
    expect(readDirectory).not.toHaveBeenCalled();
    expect(gateway.start).not.toHaveBeenCalled();
    render({ thread, remoteSurface, layout: { openSurfaces: [], activeSurface: null } });
    const cards = Array.from(host.querySelectorAll<HTMLButtonElement>(".agent-surface-card"));
    expect(cards).toHaveLength(4);
    expect(cards.every((card) => !card.disabled)).toBe(true);
    expect(host.textContent).not.toContain("not supported");
    render({
      thread,
      remoteSurface: {
        ...remoteSurface,
        capabilities: { ...remoteSurface.capabilities, terminal: false },
      },
      layout: { openSurfaces: [], activeSurface: null },
    });
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Server Terminal is not available.",
    );
    render({
      thread: null,
      remoteDraft: true,
      remoteSurface: { ...remoteSurface, scope: { ...remoteSurface.scope, taskId: undefined } },
      layout: FILES_LAYOUT,
    });
    await waitForReact(() =>
      expect(host.querySelector('[data-remote-files="project"]')).not.toBeNull(),
    );
    expect(host.querySelector("[data-agent-editor-slot]")).toBeNull();
  });

  it("rejects remote surface authority belonging to another task or runner", async () => {
    const remoteSurface = readyRemoteSurface();
    const local = surfaceThreadView();
    const execution = {
      kind: "remote" as const,
      serverId: "server",
      runnerId: "runner",
      projectId: "project",
      conversationId: "conversation",
      latestTaskId: "task",
      resume: null,
    };
    for (const scope of [
      { ...remoteSurface.scope, taskId: "foreign" },
      { ...remoteSurface.scope, runnerId: "replacement" },
    ]) {
      render({
        thread: { ...local, execution },
        remoteSurface: { ...remoteSurface, scope },
        layout: FILES_LAYOUT,
      });
      await act(async () => Promise.resolve());
      expect(host.querySelector("[data-remote-files]")).toBeNull();
      expect(host.querySelector("[data-agent-editor-slot]")).toBeNull();
    }
  });

  it.each(["remote:server:task", "remote-thread:server:conversation"])(
    "renders Agents for %s without server panel capabilities",
    (threadId) => {
      const local = surfaceThreadView();
      render({
        thread: { ...local, thread: { ...local.thread, threadId } },
        agentsPanel: <div data-test-agents>Thread agents</div>,
        layout: { openSurfaces: ["agents"], activeSurface: "agents" },
      });
      expect(host.querySelector("[data-test-agents]")).not.toBeNull();
      expect(host.textContent).not.toContain("This server panel is unavailable.");
    },
  );

  it("keeps Agents unavailable for a remote draft without a thread", () => {
    render({
      thread: null,
      remoteDraft: true,
      agentsPanel: <div data-test-agents>Thread agents</div>,
      layout: { openSurfaces: ["agents"], activeSurface: "agents" },
    });
    expect(host.querySelector("[data-test-agents]")).toBeNull();
    expect(host.textContent).toContain("This server panel is unavailable.");
  });

  it("uses the original changes surface with remote facade callbacks", async () => {
    const local = surfaceThreadView();
    const thread = {
      ...local,
      changeSummary: null,
      thread: { ...local.thread, threadId: "remote:server:task" },
    };
    const showChanges = vi.fn(async () => undefined);
    render({
      thread,
      agents: { ...defaultProps().agents, showChanges },
      layout: { openSurfaces: ["diff"], activeSurface: "diff" },
    });
    await waitForReact(() => expect(showChanges).toHaveBeenCalledWith(thread.thread.threadId));
    expect(host.textContent).not.toContain(
      "This server panel is unavailable. Check the server connection and runner version.",
    );
  });

  it("does not mount hidden local surface bodies retained from the previous project", async () => {
    const local = surfaceThreadView();
    const thread = {
      ...local,
      changeSummary: null,
      thread: { ...local.thread, threadId: "remote-thread:server:conversation" },
    };
    const gateway = fakeTerminalGateway();
    const readDirectory = vi.fn(listing);
    for (const activeSurface of ["diff", null] as const) {
      render({
        chrome: {
          ...filesChrome(recordedLayoutState(FILES_LAYOUT), { files: { readDirectory } }),
          terminal: chrome(gateway).terminal,
        },
        thread,
        layout: { openSurfaces: ["files", "diff", "terminal", "history"], activeSurface },
      });
      await act(async () => Promise.resolve());
      expect(host.querySelector("[data-agent-editor-slot]")).toBeNull();
      expect(host.querySelector('[data-surface-panel="files"]')).toBeNull();
      expect(host.querySelector('[data-surface-panel="terminal"]')).toBeNull();
      expect(host.querySelector('[data-surface-panel="history"]')).toBeNull();
      expect(
        Array.from(host.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent),
      ).toEqual(["Diff"]);
    }
    expect(readDirectory).not.toHaveBeenCalled();
    expect(gateway.start).not.toHaveBeenCalled();
  });

  it("blocks remote threads even when their projected roots match the local workspace", async () => {
    const gateway = fakeTerminalGateway();
    const local = surfaceThreadView();
    const thread = { ...local, thread: { ...local.thread, threadId: "remote:server:task" } };
    render({
      chrome: chrome(gateway),
      thread,
      layout: { openSurfaces: ["terminal"], activeSurface: "terminal" },
    });
    await act(async () => Promise.resolve());
    expect(gateway.start).not.toHaveBeenCalled();
    expect(host.textContent).toContain(
      "This server panel is unavailable. Check the server connection and runner version.",
    );
  });

  it("retains the server draft context without exposing local project surfaces", async () => {
    const gateway = fakeTerminalGateway();
    const readDirectory = vi.fn(listing);
    const base = {
      ...filesChrome(recordedLayoutState(FILES_LAYOUT), { files: { readDirectory } }),
      terminal: chrome(gateway).terminal,
    };
    for (const activeSurface of ["files", "history", "terminal", "diff", null] as const) {
      render({
        chrome: base,
        thread: null,
        remoteDraft: true,
        scope: surfaceRepositoryScope(),
        layout: { openSurfaces: ["files", "diff", "terminal", "history"], activeSurface },
      });
      await act(async () => Promise.resolve());
      expect(host.textContent).not.toContain("Select an available project");
      expect(host.querySelector(".agent-surface__editor-slot")).toBeNull();
      expect(host.querySelector('[aria-label="Open Files surface"]')).toBeNull();
      expect(host.querySelector('[aria-label="Project diff"]')).toBeNull();
      expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0);
    }
    expect(readDirectory).not.toHaveBeenCalled();
    expect(gateway.start).not.toHaveBeenCalled();
  });

  it("uses the selected local thread even if the new-thread draft targets the server", async () => {
    const gateway = fakeTerminalGateway();
    render({
      chrome: chrome(gateway),
      remoteDraft: true,
      layout: { openSurfaces: ["terminal"], activeSurface: "terminal" },
    });
    await waitForReact(() => expect(gateway.start).toHaveBeenCalledTimes(1));
  });

  it("starts the thread terminal on the registered workspace root, not the thread checkout", async () => {
    const gateway = fakeTerminalGateway();
    render({
      chrome: chrome(gateway),
      layout: { openSurfaces: ["terminal"], activeSurface: "terminal" },
    });
    await waitForReact(() => expect(host.querySelector(TERMINAL_ACTIONS)).not.toBeNull());
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
    expect(host.querySelector(TERMINAL_ACTIONS)).toBeNull();
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
            state: surfaceActivation("pending"),
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
          state: {
            ...surfaceActivation("pending"),
            kind: "failed",
            message: "Could not open app.",
          },
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
    expect(host.querySelector(TERMINAL_ACTIONS)).toBeNull();
    expect(gateway.start).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "preserves panel maximization (%s) when previewing or opening a file",
    async (rightPanelMaximized) => {
      const layout = recordedLayoutState({
        rightPanel: "open",
        openSurfaces: ["files"],
        activeSurface: "files",
        rightPanelMaximized,
        rightPanelWidth: 680,
      });
      const onOpenFile = vi.fn();
      const onPreviewFile = vi.fn();
      render({ chrome: filesChrome(layout, { onOpenFile, onPreviewFile }), layout: FILES_LAYOUT });
      const row = await treeRow("users.ts");

      act(() => row.click());
      expect(onPreviewFile).toHaveBeenCalledWith(expect.objectContaining({ name: "users.ts" }));
      expect(layout.actions).toEqual([]);
      expect(reduceRecordedLayout(layout)).toEqual(layout.layout);

      act(() => {
        row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      });
      expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({ name: "users.ts" }));
      expect(layout.actions).toEqual([]);
      expect(reduceRecordedLayout(layout)).toMatchObject({
        rightPanel: "open",
        openSurfaces: ["files"],
        activeSurface: "files",
        rightPanelMaximized,
        rightPanelWidth: 680,
      });
    },
  );

  it("keeps the tree after a restore without re-maximizing", async () => {
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
    expect(host.querySelector(".cv-editor-slot")).toBeNull();
    const restoredRow = await treeRow("users.ts");
    act(() => restoredRow.click());
    expect(restored.actions).toEqual([]);
  });

  it("searches the thread checkout inline from the Files surface header", async () => {
    const searchFiles = vi.fn(async (root: string) => [
      { name: "users.ts", path: `${root}/src/users.ts`, relativePath: "src/users.ts" },
    ]);
    const onPreviewFile = vi.fn();
    const layout = recordedLayoutState({
      rightPanel: "open",
      openSurfaces: ["files"],
      activeSurface: "files",
    });
    render({
      chrome: {
        ...filesChrome(layout, { onPreviewFile, searchFilesShortcut: "Ctrl+P" }),
        rightPanel: rightPanelTestContext({}, { fileSearch: { searchFiles } }).chrome,
      },
      layout: FILES_LAYOUT,
    });
    await treeRow("users.ts");

    const enabled = host.querySelector<HTMLInputElement>(
      'input[aria-label="Search workspace files"]',
    );
    expect(enabled?.disabled).toBe(false);
    expect(host.querySelector(".cv-files__search .cv-kbd")?.textContent).toBe(
      agentShortcutGlyphs("Ctrl+P"),
    );
    act(() => {
      if (enabled === null) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        enabled,
        "users",
      );
      enabled.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await waitForReact(() =>
      expect(host.querySelector('[role="listbox"][aria-label="Matching files"]')).not.toBeNull(),
    );
    expect(searchFiles).toHaveBeenCalledWith(SURFACE_FIXTURE_WORKTREE, "users", 201);
    act(() => host.querySelector<HTMLElement>('[role="option"]')?.click());
    expect(onPreviewFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: `${SURFACE_FIXTURE_WORKTREE}/src/users.ts` }),
    );
    expect(layout.actions).toEqual([]);
  });

  it("shows the thread's package scripts on the Scripts surface", async () => {
    const runScript = vi.fn(() => true);
    const layout = recordedLayoutState({
      rightPanel: "open",
      openSurfaces: ["scripts"],
      activeSurface: "scripts",
    });
    render({
      chrome: {
        ...chrome(fakeTerminalGateway()),
        layout,
        scriptsSurface: {
          vscodeProcessTasks: null,
          openScriptTerminal: () => undefined,
          refreshScripts: () => undefined,
        },
      },
      layout: { openSurfaces: ["scripts"], activeSurface: "scripts" },
      scripts: {
        entries: [
          {
            key: "package.json:dev",
            label: "dev",
            detail: null,
            availability: { kind: "available" },
            manifestRelativePath: "package.json",
            command: "npm run dev",
          },
        ],
        preferred: null,
        truncated: false,
        run: { kind: "idle" },
        outcomes: new Map(),
        runScript,
        stopScript: () => undefined,
      },
    });

    const run = host.querySelector<HTMLButtonElement>('button[aria-label="Run dev"]');
    expect(run?.closest(".cv-script-row")?.querySelector(".cv-script-row__cmd")?.textContent).toBe(
      "npm run dev",
    );
    act(() => run?.click());
    expect(runScript).toHaveBeenCalledWith("package.json:dev");
  });

  describe("without a selected thread", () => {
    it("browses the trusted rail scope repository root with Refresh", async () => {
      const readDirectory = vi.fn(listing);
      const layout = recordedLayoutState(FILES_LAYOUT);
      render({
        chrome: filesChrome(layout, { files: { readDirectory } }),
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
    });

    it.each([false, true])(
      "opens a scope file without changing panel maximization (%s)",
      async (rightPanelMaximized) => {
        const onOpenFile = vi.fn();
        const onPreviewFile = vi.fn();
        const layout = recordedLayoutState({
          rightPanel: "open",
          ...FILES_LAYOUT,
          rightPanelMaximized,
          rightPanelWidth: 680,
        });
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
        expect(layout.actions).toEqual([]);
        expect(reduceRecordedLayout(layout)).toEqual(layout.layout);
      },
    );

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

  it("feeds the editor documents from context into the strip, only for a local pane", () => {
    const onActivate = vi.fn();
    const documents: EditorPanelDocumentsValue = {
      documents: [
        {
          documentId: "/w/a.ts",
          title: "a.ts",
          path: "/w/a.ts",
          dirty: true,
          preview: false,
          gitStatus: null,
        },
      ],
      activeDocumentId: "/w/a.ts",
      onActivate,
      onClose: vi.fn(),
      onOpenFile: vi.fn(),
      onPin: vi.fn(),
    };
    const renderWith = (overrides: Partial<AgentSurfaceHostProps>) =>
      act(() =>
        root.render(
          <EditorPanelDocumentsContext.Provider value={documents}>
            <AgentSurfaceHost {...defaultProps()} {...overrides} />
          </EditorPanelDocumentsContext.Provider>,
        ),
      );

    renderWith({ layout: { openSurfaces: ["editor"], activeSurface: "editor" } });
    const tab = host.querySelector<HTMLElement>('[role="tab"][title="a.ts"]');
    expect(tab?.getAttribute("aria-selected")).toBe("true");
    act(() => tab?.click());
    expect(onActivate).toHaveBeenCalledWith("/w/a.ts");

    renderWith({
      thread: null,
      remoteDraft: true,
      layout: { openSurfaces: ["editor"], activeSurface: "editor" },
    });
    expect(host.querySelector('[role="tab"][title="a.ts"]')).toBeNull();
    expect(host.querySelector('[aria-label="Open file"]')).toBeNull();
  });

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
      onPreviewFile: async () => true,
      revealEditor: () => undefined,
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

function readyRemoteSurface(): AgentRemoteSurface {
  const unused = vi.fn(async (): Promise<never> => {
    throw new Error("Unexpected gateway call");
  });
  return {
    paneKey: "server-conversation",
    scope: { serverId: "server", runnerId: "runner", projectId: "project", taskId: "task" },
    capabilities: { files: true, history: true, terminal: true },
    gateway: {
      capabilities: unused,
      listDirectory: unused,
      readFile: unused,
      writeFile: unused,
      history: unused,
      commitFiles: unused,
      commitDiff: unused,
      openTerminal: unused,
      pollTerminal: unused,
      writeTerminal: unused,
      resizeTerminal: unused,
      closeTerminal: unused,
    },
  };
}
