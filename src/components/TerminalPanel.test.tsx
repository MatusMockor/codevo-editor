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
  cols: number;
  dispose: ReturnType<typeof vi.fn>;
  loadAddon: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  onResize: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
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

const terminalPanelMocks = vi.hoisted(() => {
  const sessions: FakeSession[] = [];
  const terminals: FakeTerminal[] = [];

  return {
    createTerminalSession: vi.fn(() => {
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
      dispose: vi.fn(),
      loadAddon: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onResize: vi.fn(() => ({ dispose: vi.fn() })),
      open: vi.fn(),
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
    subscribeOutput: vi.fn(async () => () => undefined),
    writeInput: vi.fn(async () => undefined),
  };
}
