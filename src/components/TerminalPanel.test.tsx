// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  terminalThemeForAppTheme,
  type TerminalTheme,
} from "../domain/settings";
import type { TerminalGateway } from "../domain/terminal";
import { TerminalPanel } from "./TerminalPanel";

interface FakeTerminal {
  buffer: {
    active: {
      getLine: ReturnType<typeof vi.fn>;
    };
  };
  cols: number;
  dispose: ReturnType<typeof vi.fn>;
  loadAddon: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  onResize: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  registerLinkProvider: ReturnType<typeof vi.fn>;
  registerMarker: ReturnType<typeof vi.fn>;
  registerDecoration: ReturnType<typeof vi.fn>;
  options: {
    theme?: TerminalTheme;
  };
  rows: number;
  write: ReturnType<typeof vi.fn>;
}

interface FakeSession {
  dispose: ReturnType<typeof vi.fn>;
  fit: ReturnType<typeof vi.fn>;
}

interface FakeSessionOptions {
  onOpenLink(path: string, line?: number, column?: number): void;
  terminal: {
    registerMarker(cursorYOffset?: number): unknown;
    registerDecoration(options: unknown): unknown;
    write(data: string, callback?: () => void): void;
  };
}

const terminalPanelMocks = vi.hoisted(() => {
  const sessions: FakeSession[] = [];
  const terminals: FakeTerminal[] = [];

  return {
    createTerminalSession: vi.fn((_options: unknown) => {
      const session = {
        dispose: vi.fn(),
        fit: vi.fn(),
      };
      sessions.push(session);

      return session;
    }),
    sessions,
    terminals,
  };
});

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(function FitAddonMock() {
    return {
      fit: vi.fn(),
    };
  }),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(function TerminalMock(options: { theme?: TerminalTheme }) {
    const terminal = {
      cols: 80,
      buffer: {
        active: {
          getLine: vi.fn(),
        },
      },
      dispose: vi.fn(),
      loadAddon: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onResize: vi.fn(() => ({ dispose: vi.fn() })),
      open: vi.fn(),
      registerLinkProvider: vi.fn(() => ({ dispose: vi.fn() })),
      registerMarker: vi.fn(() => ({ dispose: vi.fn() })),
      registerDecoration: vi.fn(() => ({
        dispose: vi.fn(),
        onRender: vi.fn(),
      })),
      options: { ...options },
      rows: 24,
      write: vi.fn(),
    };
    terminalPanelMocks.terminals.push(terminal);

    return terminal;
  }),
}));

vi.mock("./terminalSession", () => ({
  createTerminalSession: terminalPanelMocks.createTerminalSession,
}));

describe("TerminalPanel", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    terminalPanelMocks.createTerminalSession.mockClear();
    terminalPanelMocks.sessions.length = 0;
    terminalPanelMocks.terminals.length = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("updates the xterm theme without restarting the terminal session", () => {
    const gateway = terminalGateway();
    const darkTheme = terminalThemeForAppTheme("dark");
    const lightTheme = terminalThemeForAppTheme("light");

    act(() => {
      root.render(
        <TerminalPanel
          isActive
          profileId="default"
          rootPath="/workspace"
          shellIntegrationEnabled={false}
          terminalGateway={gateway}
          terminalTheme={darkTheme}
        />,
      );
    });

    const terminal = terminalPanelMocks.terminals[0];

    expect(terminal.options.theme).toBe(darkTheme);
    expect(terminalPanelMocks.createTerminalSession).toHaveBeenCalledTimes(1);

    act(() => {
      root.render(
        <TerminalPanel
          isActive
          profileId="default"
          rootPath="/workspace"
          shellIntegrationEnabled={false}
          terminalGateway={gateway}
          terminalTheme={lightTheme}
        />,
      );
    });

    expect(terminalPanelMocks.terminals).toHaveLength(1);
    expect(terminalPanelMocks.createTerminalSession).toHaveBeenCalledTimes(1);
    expect(terminal.options.theme).toBe(lightTheme);
    expect(terminalPanelMocks.sessions[0].dispose).not.toHaveBeenCalled();
  });

  it("resolves links inside the mounted workspace and drops unsafe paths", () => {
    const onOpenLink = vi.fn();

    act(() => {
      root.render(
        <TerminalPanel
          isActive
          onOpenLink={onOpenLink}
          profileId="default"
          rootPath="/workspace/project"
          shellIntegrationEnabled={false}
          terminalGateway={terminalGateway()}
          terminalTheme={terminalThemeForAppTheme("dark")}
        />,
      );
    });

    const sessionOptions = terminalPanelMocks.createTerminalSession.mock
      .calls[0]?.[0] as FakeSessionOptions;

    sessionOptions.onOpenLink("./tests/../src/Foo.php", 12, 4);
    sessionOptions.onOpenLink("/workspace/project/tests/FooTest.php", 8);
    sessionOptions.onOpenLink("/workspace/project-other/Secret.php", 1);
    sessionOptions.onOpenLink("/outside/Secret.php", 1);

    expect(onOpenLink.mock.calls).toEqual([
      ["/workspace/project/src/Foo.php", 12, 4],
      ["/workspace/project/tests/FooTest.php", 8, undefined],
    ]);
  });

  it("drops activations from a session mounted for a stale workspace", () => {
    const onOpenLink = vi.fn(async () => undefined);
    const gateway = terminalGateway();
    const theme = terminalThemeForAppTheme("dark");

    act(() => {
      root.render(
        <TerminalPanel
          isActive
          onOpenLink={onOpenLink}
          profileId="default"
          rootPath="/workspace/old"
          shellIntegrationEnabled={false}
          terminalGateway={gateway}
          terminalTheme={theme}
        />,
      );
    });

    const staleOpenLink = (
      terminalPanelMocks.createTerminalSession.mock.calls[0]?.[0] as
        FakeSessionOptions
    ).onOpenLink;

    act(() => {
      root.render(
        <TerminalPanel
          isActive
          onOpenLink={onOpenLink}
          profileId="default"
          rootPath="/workspace/new"
          shellIntegrationEnabled={false}
          terminalGateway={gateway}
          terminalTheme={theme}
        />,
      );
    });

    staleOpenLink("src/Foo.php", 2, 3);

    expect(onOpenLink).not.toHaveBeenCalled();
  });

  it("forwards writes, markers, and decoration registration to xterm", () => {
    act(() => {
      root.render(
        <TerminalPanel
          isActive
          profileId="default"
          rootPath="/workspace"
          shellIntegrationEnabled
          terminalGateway={terminalGateway()}
          terminalTheme={terminalThemeForAppTheme("dark")}
        />,
      );
    });

    const terminal = terminalPanelMocks.terminals[0];
    const sessionTerminal = (
      terminalPanelMocks.createTerminalSession.mock.calls[0]?.[0] as FakeSessionOptions
    ).terminal;
    const marker = sessionTerminal.registerMarker(-1);
    const options = {
      backgroundColor: "var(--color-success)",
      marker,
      tooltip: "Exit code 0",
    };
    const writeCallback = vi.fn();

    sessionTerminal.write("output", writeCallback);
    sessionTerminal.registerDecoration(options);

    expect(terminal.write).toHaveBeenCalledWith("output", writeCallback);
    expect(terminal.registerMarker).toHaveBeenCalledWith(-1);
    expect(terminal.registerDecoration).toHaveBeenCalledWith({ marker });
  });
});

function terminalGateway(): TerminalGateway {
  return {
    listProfiles: vi.fn(async () => []),
    resize: vi.fn(async () => undefined),
    start: vi.fn(async () => ({
      cols: 80,
      cwd: "/workspace",
      kind: "running" as const,
      rows: 24,
      sessionId: 1,
    })),
    stop: vi.fn(async (sessionId) => ({
      kind: "stopped" as const,
      sessionId,
    })),
    stopAll: vi.fn(async () => undefined),
    stopRoot: vi.fn(async () => undefined),
    subscribeOutput: vi.fn(async () => () => undefined),
    writeInput: vi.fn(async () => undefined),
  };
}
