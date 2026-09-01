// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetKeymapPlatformCacheForTests } from "./domain/keymap";
import { defaultAppSettings, defaultWorkspaceSettings } from "./domain/settings";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
  surfaceRenderCount: { value: 0 },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => false,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => undefined),
}));

vi.mock("./infrastructure/shikiHighlighter", () => ({
  createAppHighlighter: vi.fn(async () => ({
    codeToTokens: vi.fn(),
  })),
}));

vi.mock("./components/agentMode/AgentWorkbenchScreen", () => ({
  AgentWorkbenchScreen: () => <div data-testid="agent-mode-view" />,
}));

vi.mock("./components/TerminalTabsPanel", () => ({
  TerminalTabsPanel: () => <div data-testid="terminal-tabs-panel" />,
}));

vi.mock("./components/ScopedEditorSurface", () => ({
  ScopedEditorSurface: ({ activeDocument }: { activeDocument: { name: string } | null }) => {
    mocks.surfaceRenderCount.value += 1;
    return <div aria-label="Active editor document">{activeDocument?.name ?? ""}</div>;
  },
}));

vi.mock("./components/StatusBar", () => ({
  StatusBar: ({ activePath }: { activePath: string | null }) => (
    <div aria-label="Active editor path">{activePath ?? ""}</div>
  ),
}));

vi.mock("./components/WorkbenchOverlayHosts", () => ({
  WorkbenchOverlayHosts: ({
    workbench,
  }: {
    workbench: {
      workspaceDescriptor: unknown;
      workspaceTrust: unknown;
    };
  }) => (
    <div
      data-testid="workspace-ready"
      data-ready={Boolean(workbench.workspaceDescriptor && workbench.workspaceTrust)}
    />
  ),
}));

describe("App docked text search integration", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    });
    __resetKeymapPlatformCacheForTests();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        addEventListener: vi.fn(),
        matches: false,
        removeEventListener: vi.fn(),
      })),
    });
    localStorage.clear();
    mocks.surfaceRenderCount.value = 0;
    await Promise.all([
      import("./components/agentMode/AgentWorkbenchScreen"),
      import("./components/ScopedEditorSurface"),
      import("./components/TerminalTabsPanel"),
      import("./components/WorkbenchEditorHost"),
      import("./components/WorkbenchSettingsDialogHost"),
    ]);
    localStorage.setItem(
      "editor.settings.app",
      JSON.stringify({
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      }),
    );
    localStorage.setItem(
      "editor.settings.workspace:canonical:%2Fworkspace",
      JSON.stringify(expandedEditorWorkspaceSettings()),
    );
    mocks.invoke.mockImplementation((command, args) => {
      if (command === "register_workspace_path") {
        return Promise.resolve({
          descriptor: {
            canonicalRootPath: "/workspace",
            caseSensitive: true,
            selectedRootPath: "/workspace",
            unicodeNormalizationPolicy: "preserved",
            workspaceId: "workspace-1",
          },
          registration: {
            admissionToken: 1,
            createdIdentity: true,
            workspaceId: "workspace-1",
          },
        });
      }

      if (command === "detect_workspace") {
        return Promise.resolve({
          javaScriptTypeScript: null,
          php: null,
          rootPath: "/workspace",
        });
      }

      if (command === "get_workspace_trust") {
        return Promise.resolve({ rootPath: "/workspace", trusted: true });
      }

      if (command === "workspace_read_directory_bounded") {
        return Promise.resolve({ entries: [], truncated: false });
      }

      if (command === "workspace_search_text") {
        return Promise.resolve({
          requestGeneration: args?.requestGeneration,
          results: [
            {
              column: 7,
              lineNumber: 3,
              lineText: "const needle = true;",
              matchEnd: 12,
              matchStart: 6,
              matchTruncated: false,
              previewTruncated: false,
              relativePath: "src/needle.ts",
            },
            {
              column: 4,
              lineNumber: 8,
              lineText: "useNeedle();",
              matchEnd: 9,
              matchStart: 3,
              matchTruncated: false,
              previewTruncated: false,
              relativePath: "src/other.ts",
            },
          ],
          truncated: false,
        });
      }

      if (command === "workspace_read_text_file") {
        return new Promise(() => undefined);
      }

      if (command === "set_smart_mode") {
        return Promise.resolve({ message: "Basic", mode: "basic", status: "off" });
      }

      return Promise.resolve(undefined);
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    localStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("keeps the selected docked search result visible after navigating to its match", async () => {
    const { default: App } = await import("./App");
    await act(async () => {
      root.render(<App />);
    });
    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("detect_workspace", {
        path: "/workspace",
      });
    });
    await waitFor(() => {
      expect(
        host.querySelector('[data-testid="workspace-ready"]')?.getAttribute("data-ready"),
      ).toBe("true");
    });
    await settleAsyncTurns();

    const shortcutEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "f",
      metaKey: true,
      shiftKey: true,
    });
    act(() => {
      window.dispatchEvent(shortcutEvent);
    });
    expect(shortcutEvent.defaultPrevented).toBe(true);

    const panel = await waitForElement<HTMLElement>(host, 'section[aria-label="Panel"]');
    const search = panel.querySelector<HTMLElement>('section[aria-label="Find in path"]');
    expect(search).not.toBeNull();
    const input = search?.querySelector<HTMLInputElement>('input[aria-label="Search text"]');
    expect(input).not.toBeNull();

    vi.useFakeTimers();
    act(() => {
      if (!input) return;
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "needle",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(181);
      await Promise.resolve();
      await Promise.resolve();
    });
    vi.useRealTimers();

    const selectedResult = await waitForElement<HTMLButtonElement>(
      panel,
      ".text-search-result.active",
    );
    expect(selectedResult.textContent).toContain("src/needle.ts:3:7");

    act(() => {
      selectedResult.click();
    });
    expect(mocks.invoke).toHaveBeenCalledWith("workspace_read_text_file", {
      relativePath: "src/needle.ts",
      workspaceId: "workspace-1",
    });

    expect(panel.querySelector('section[aria-label="Find in path"]')).not.toBeNull();
    expect(panel.querySelector(".text-search-result.active")).toBe(selectedResult);
    expect(selectedResult.getAttribute("aria-selected")).toBe("true");

    const terminalTab = Array.from(panel.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
      (tab) => tab.textContent === "Terminal",
    );
    expect(terminalTab).not.toBeUndefined();
    await act(async () => {
      terminalTab?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(terminalTab?.getAttribute("aria-selected")).toBe("true");

    const settingsEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: ",",
      metaKey: true,
    });
    act(() => window.dispatchEvent(settingsEvent));
    expect(settingsEvent.defaultPrevented).toBe(true);
    expect(panel.isConnected).toBe(true);
    expect(terminalTab?.getAttribute("aria-selected")).toBe("true");

    act(() => window.dispatchEvent(shortcutEvent));
    const searchTab = Array.from(panel.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
      (tab) => tab.textContent === "Search",
    );
    expect(searchTab?.getAttribute("aria-selected")).toBe("true");
    await act(async () => {
      terminalTab?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const workspaceSymbolsEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "t",
      metaKey: true,
    });
    act(() => window.dispatchEvent(workspaceSymbolsEvent));
    expect(workspaceSymbolsEvent.defaultPrevented).toBe(true);
    expect(panel.isConnected).toBe(true);
    expect(terminalTab?.getAttribute("aria-selected")).toBe("true");
  }, 10_000);

  it("keeps the mounted editor surface out of twenty Text Search query commits", async () => {
    const { default: App } = await import("./App");
    await act(async () => {
      root.render(<App />);
    });
    await waitFor(() => {
      expect(
        host.querySelector('[data-testid="workspace-ready"]')?.getAttribute("data-ready"),
      ).toBe("true");
    });
    await openEditorSidebarForIntegration(host);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "f",
          metaKey: true,
          shiftKey: true,
        }),
      );
    });

    const input = await waitForElement<HTMLInputElement>(host, 'input[aria-label="Search text"]');
    const rendersBeforeTyping = mocks.surfaceRenderCount.value;
    let query = "";
    for (const character of "abcdefghijklmnopqrst") {
      query += character;
      act(() => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
          input,
          query,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    expect(query).toHaveLength(20);
    expect(input.value).toBe(query);
    await settleAsyncTurns();
    expect(mocks.surfaceRenderCount.value - rendersBeforeTyping).toBe(0);
  }, 10_000);

  it("keeps twenty bottom-panel resize updates out of the mounted editor surface", async () => {
    const { default: App } = await import("./App");
    await act(async () => {
      root.render(<App />);
    });
    await waitFor(() => {
      expect(
        host.querySelector('[data-testid="workspace-ready"]')?.getAttribute("data-ready"),
      ).toBe("true");
    });
    await openEditorSidebarForIntegration(host);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "f",
          metaKey: true,
          shiftKey: true,
        }),
      );
    });
    const resizeHandle = await waitForElement<HTMLElement>(host, ".bottom-panel-resize-handle");
    const workbench = await waitForElement<HTMLElement>(host, ".editor-workbench");
    expect(workbench.style.getPropertyValue("--agent-bottom-panel-committed")).toBe("280px");
    act(() => {
      resizeHandle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientY: 600 }));
    });
    const rendersBeforeResize = mocks.surfaceRenderCount.value;

    for (let offset = 1; offset <= 20; offset += 1) {
      act(() => {
        window.dispatchEvent(
          new MouseEvent("pointermove", { bubbles: true, clientY: 600 - offset }),
        );
      });
    }
    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    });
    await settleAsyncTurns();

    expect(workbench.style.getPropertyValue("--agent-bottom-panel-committed")).toBe("300px");
    expect(mocks.surfaceRenderCount.value - rendersBeforeResize).toBe(0);
  }, 10_000);
});

async function openEditorSidebarForIntegration(host: ParentNode): Promise<void> {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        altKey: true,
        bubbles: true,
        cancelable: true,
        code: "KeyF",
        key: "f",
        metaKey: true,
      }),
    );
  });
  await waitFor(() => {
    expect(host.querySelector(".editor-workbench")?.getAttribute("data-layout")).toBe("agent");
    expect(host.querySelector('[data-slot="editor"]')?.getAttribute("hidden")).toBeNull();
  });
  await settleAsyncTurns();
}

async function settleAsyncTurns(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 5; turn += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  });
}

async function waitFor(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    let passed = false;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
      try {
        assertion();
        passed = true;
      } catch {
        passed = false;
      }
    });
    if (passed) return;
  }

  assertion();
}

async function waitForElement<T extends Element>(host: HTMLElement, selector: string): Promise<T> {
  let element: T | null = null;
  await waitFor(() => {
    element = host.querySelector<T>(selector);
    expect(element).not.toBeNull();
  });
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}

function expandedEditorWorkspaceSettings() {
  const settings = defaultWorkspaceSettings();
  return {
    ...settings,
    session: {
      ...settings.session,
      agentWorkbench: {
        layout: "editor-expanded",
        rightSurface: null,
        bottomPanel: false,
        rightPanelWidth: 540,
        bottomPanelHeight: 280,
      },
    },
  };
}
