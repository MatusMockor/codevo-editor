// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalTheme } from "../../domain/settings";
import { waitForReact } from "../../test/reactTestLifecycle";
import { AgentSurfaceHost, type AgentSurfaceHostProps } from "./AgentSurfaceHost";
import { SURFACE_FOREIGN_ROOT_TERMINAL_REASON } from "./agentSurfacePolicy";
import { SURFACE_FIXTURE_ROOT, surfaceThreadView } from "./agentSurfaceTestFixtures";
import { fakeTerminalGateway, installResizeObserver } from "./agentSurfaceTerminalTestSupport";
import { UNAVAILABLE_AGENT_SCRIPT_RUNNER, type AgentWorkbenchChrome } from "./agentWorkbenchChrome";

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

  function render(overrides: Partial<AgentSurfaceHostProps> = {}): void {
    act(() => root.render(<AgentSurfaceHost {...defaultProps()} {...overrides} />));
  }
});

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
    onClosePanel: () => undefined,
  };
}
