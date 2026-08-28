// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { terminalThemeForAppTheme, type TerminalTheme } from "../domain/settings";
import type { TerminalGateway } from "../domain/terminal";
import { TERMINAL_SCROLLBACK_LINES, TerminalPanel } from "./TerminalPanel";

interface FakeTerminal {
  buffer: {
    active: {
      getLine: ReturnType<typeof vi.fn>;
      type: "alternate" | "normal";
      viewportY: number;
    };
  };
  attachCustomKeyEventHandler: ReturnType<typeof vi.fn>;
  cols: number;
  dispose: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  loadAddon: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  onResize: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  registerLinkProvider: ReturnType<typeof vi.fn>;
  registerMarker: ReturnType<typeof vi.fn>;
  registerDecoration: ReturnType<typeof vi.fn>;
  options: {
    scrollback?: number;
    theme?: TerminalTheme;
  };
  rows: number;
  scrollToLine: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
}

interface FakeSession {
  dispose: ReturnType<typeof vi.fn>;
  fit: ReturnType<typeof vi.fn>;
}

interface FakeSessionOptions {
  onCwdChange(cwd: string | null): void;
  onOpenLink(path: string, line?: number, column?: number): void;
  onSessionReady(sessionId: number | null): void;
  onSessionStartFailed(): void;
  onSessionSettled(sessionId: number, exitCode: number | null): void;
  startSession?(size: { cols: number; rows: number }): Promise<unknown>;
  terminal: {
    buffer: {
      active: {
        type: "alternate" | "normal";
      };
    };
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void;
    registerMarker(cursorYOffset?: number): unknown;
    registerDecoration(options: unknown): unknown;
    scrollToLine(line: number): void;
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
  Terminal: vi.fn(function TerminalMock(options: { scrollback?: number; theme?: TerminalTheme }) {
    const terminal = {
      cols: 80,
      buffer: {
        active: {
          getLine: vi.fn(),
          type: "normal" as "alternate" | "normal",
          viewportY: 7,
        },
      },
      attachCustomKeyEventHandler: vi.fn(),
      dispose: vi.fn(),
      focus: vi.fn(),
      loadAddon: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onResize: vi.fn(() => ({ dispose: vi.fn() })),
      open: vi.fn(),
      registerLinkProvider: vi.fn(() => ({ dispose: vi.fn() })),
      registerMarker: vi.fn(() => ({
        dispose: vi.fn(),
        isDisposed: false,
        line: 12,
      })),
      registerDecoration: vi.fn(() => ({
        dispose: vi.fn(),
        onRender: vi.fn(),
      })),
      options: { ...options },
      rows: 24,
      scrollToLine: vi.fn(),
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

  it("bounds retained terminal scrollback", () => {
    act(() => {
      root.render(
        <TerminalPanel
          isActive
          profileId="default"
          rootPath="/workspace"
          shellIntegrationEnabled={false}
          terminalGateway={terminalGateway()}
          terminalTheme={terminalThemeForAppTheme("dark")}
        />,
      );
    });

    expect(terminalPanelMocks.terminals[0]?.options.scrollback).toBe(TERMINAL_SCROLLBACK_LINES);
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

  it("refits an active session when its containing layout changes without restarting", () => {
    const props = {
      isActive: true,
      layoutRevision: 1,
      profileId: "default",
      rootPath: "/workspace",
      shellIntegrationEnabled: false,
      terminalGateway: terminalGateway(),
      terminalTheme: terminalThemeForAppTheme("dark"),
    };
    act(() => root.render(<TerminalPanel {...props} />));
    const session = terminalPanelMocks.sessions[0];
    expect(session.fit).toHaveBeenCalledTimes(1);

    act(() => root.render(<TerminalPanel {...props} layoutRevision={2} />));
    expect(terminalPanelMocks.createTerminalSession).toHaveBeenCalledTimes(1);
    expect(session.fit).toHaveBeenCalledTimes(2);

    act(() => root.render(<TerminalPanel {...props} isActive={false} layoutRevision={3} />));
    expect(session.fit).toHaveBeenCalledTimes(2);
    act(() => root.render(<TerminalPanel {...props} layoutRevision={4} />));
    expect(session.fit).toHaveBeenCalledTimes(3);
    expect(session.dispose).not.toHaveBeenCalled();
  });

  it("attaches an exact semantic session and forwards only its settlement", async () => {
    const cancelStart = vi.fn();
    const start = vi.fn(async () => ({ kind: "starting" as const, sessionId: 71 }));
    const settle = vi.fn(async () => undefined);
    const gateway = terminalGateway();
    const theme = terminalThemeForAppTheme("dark");

    act(() => {
      root.render(
        <TerminalPanel
          isActive
          profileId={null}
          rootPath="/workspace"
          semanticSession={{ key: "claude-1", cancelStart, start, settle }}
          shellIntegrationEnabled={false}
          terminalGateway={gateway}
          terminalTheme={theme}
        />,
      );
    });

    const options = terminalPanelMocks.createTerminalSession.mock
      .calls[0]?.[0] as FakeSessionOptions;
    expect(terminalPanelMocks.terminals[0]?.focus).toHaveBeenCalledTimes(1);
    options.onSessionStartFailed();
    expect(cancelStart).toHaveBeenCalledTimes(1);
    await expect(options.startSession?.({ cols: 90, rows: 30 })).resolves.toEqual({
      kind: "starting",
      sessionId: 71,
    });
    options.onSessionSettled(71, 0);
    expect(start).toHaveBeenCalledExactlyOnceWith({ cols: 90, rows: 30 });
    expect(settle).toHaveBeenCalledExactlyOnceWith(71, 0);

    act(() => {
      root.render(
        <TerminalPanel
          isActive
          profileId={null}
          rootPath="/workspace"
          semanticSession={{ key: "codex-2", cancelStart: () => undefined, start, settle }}
          shellIntegrationEnabled={false}
          terminalGateway={gateway}
          terminalTheme={theme}
        />,
      );
    });
    expect(terminalPanelMocks.sessions[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(terminalPanelMocks.createTerminalSession).toHaveBeenCalledTimes(2);

    const replacement = terminalPanelMocks.createTerminalSession.mock
      .calls[1]?.[0] as FakeSessionOptions;
    replacement.onSessionReady(72);
    act(() => {
      root.render(
        <TerminalPanel
          isActive
          profileId="default"
          rootPath="/workspace"
          shellIntegrationEnabled={false}
          terminalGateway={gateway}
          terminalTheme={theme}
        />,
      );
    });
    await act(async () => Promise.resolve());
    expect(gateway.stop).toHaveBeenCalledWith(72);
    expect(settle).toHaveBeenLastCalledWith(72, null);
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
      terminalPanelMocks.createTerminalSession.mock.calls[0]?.[0] as FakeSessionOptions
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

  it("drops late callbacks from a replaced same-root session generation", () => {
    const onCwdChange = vi.fn();
    const onOpenLink = vi.fn();
    const onSessionReady = vi.fn();
    const gateway = terminalGateway();
    const theme = terminalThemeForAppTheme("dark");
    const render = (profileId: string) => {
      act(() => {
        root.render(
          <TerminalPanel
            isActive
            onCwdChange={onCwdChange}
            onOpenLink={onOpenLink}
            onSessionReady={onSessionReady}
            profileId={profileId}
            rootPath="/workspace"
            shellIntegrationEnabled={false}
            terminalGateway={gateway}
            terminalTheme={theme}
          />,
        );
      });
    };

    render("first");
    const stale = terminalPanelMocks.createTerminalSession.mock.calls[0]?.[0] as FakeSessionOptions;
    render("second");
    const current = terminalPanelMocks.createTerminalSession.mock
      .calls[1]?.[0] as FakeSessionOptions;
    onCwdChange.mockClear();
    onOpenLink.mockClear();
    onSessionReady.mockClear();

    current.onSessionReady(22);
    current.onCwdChange("/workspace/current");
    stale.onSessionReady(null);
    stale.onCwdChange("/workspace/stale");
    stale.onOpenLink("stale.ts", 1, 1);

    expect(onSessionReady).toHaveBeenCalledExactlyOnceWith(22);
    expect(onCwdChange).toHaveBeenCalledExactlyOnceWith("/workspace/current");
    expect(onOpenLink).not.toHaveBeenCalled();
  });

  it("forwards key handling, scrolling, writes, markers, and decorations to xterm", () => {
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
    const keyHandler = vi.fn(() => true);

    terminal.buffer.active.type = "alternate";
    sessionTerminal.attachCustomKeyEventHandler(keyHandler);
    sessionTerminal.scrollToLine(12);
    sessionTerminal.write("output", writeCallback);
    sessionTerminal.registerDecoration(options);

    expect(terminal.attachCustomKeyEventHandler).toHaveBeenCalledWith(keyHandler);
    expect(sessionTerminal.buffer.active.type).toBe("alternate");
    expect(terminal.scrollToLine).toHaveBeenCalledWith(12);
    expect(terminal.write).toHaveBeenCalledWith("output", writeCallback);
    expect(terminal.registerMarker).toHaveBeenCalledWith(-1);
    expect(marker).toMatchObject({ isDisposed: false, line: 12 });
    expect(terminal.registerDecoration).toHaveBeenCalledWith({ marker });
  });
});

function terminalGateway(): TerminalGateway {
  return {
    acknowledgeStart: vi.fn(async () => undefined),
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
