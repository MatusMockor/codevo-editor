// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classicTerminalTheme, type TerminalTheme } from "../../domain/appColorThemes";
import {
  TERMINAL_SCROLLBACK_LINES,
  observeXtermFit,
  useXtermHost,
  type XtermBackend,
  type XtermHost,
  type XtermInitialInput,
} from "./useXtermHost";

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  fitAddons: [] as Array<{ fit: ReturnType<typeof vi.fn> }>,
  observers: [] as Array<{
    callback: () => void;
    disconnect: ReturnType<typeof vi.fn>;
    observe: ReturnType<typeof vi.fn>;
  }>,
  terminals: [] as Array<{
    dispose: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    loadAddon: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
    options: { disableStdin?: boolean; scrollback?: number; theme?: TerminalTheme };
  }>,
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(function FitAddonMock() {
    const addon = { fit: vi.fn(() => mocks.events.push("fit")) };
    mocks.fitAddons.push(addon);
    return addon;
  }),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(function TerminalMock(options: Record<string, unknown>) {
    const terminal = {
      dispose: vi.fn(() => mocks.events.push("terminal.dispose")),
      focus: vi.fn(),
      loadAddon: vi.fn(() => mocks.events.push("loadAddon")),
      open: vi.fn(() => mocks.events.push("open")),
      options: { ...options },
    };
    mocks.terminals.push(terminal);
    return terminal;
  }),
}));

interface HarnessProps {
  readonly backend: XtermBackend;
  readonly initialInput?: XtermInitialInput;
  readonly onHost?: (host: XtermHost) => void;
  readonly restartKey?: string | number;
  readonly theme: TerminalTheme;
}

function Harness({
  backend,
  initialInput = "enabled",
  onHost,
  restartKey = 0,
  theme,
}: HarnessProps) {
  const xterm = useXtermHost({ backend, initialInput, restartKey, theme });
  onHost?.(xterm);
  return <div ref={xterm.hostRef} />;
}

function recordingBackend() {
  const attachments: Array<{ dispose: ReturnType<typeof vi.fn>; fit: ReturnType<typeof vi.fn> }> =
    [];
  const backend = vi.fn<XtermBackend>(() => {
    const attachment = {
      dispose: vi.fn(() => mocks.events.push("attachment.dispose")),
      fit: vi.fn(),
    };
    attachments.push(attachment);
    return attachment;
  });
  return { attachments, backend };
}

describe("useXtermHost", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.events.length = 0;
    mocks.fitAddons.length = 0;
    mocks.observers.length = 0;
    mocks.terminals.length = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        readonly disconnect = vi.fn();
        readonly observe = vi.fn();
        constructor(callback: () => void) {
          mocks.observers.push({ callback, disconnect: this.disconnect, observe: this.observe });
        }
      },
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("creates one bounded xterm per attachment and hands it to the backend", () => {
    const { backend } = recordingBackend();
    const theme = classicTerminalTheme("classicDark");
    act(() => root.render(<Harness backend={backend} initialInput="disabled" theme={theme} />));

    expect(mocks.terminals).toHaveLength(1);
    expect(mocks.terminals[0].options).toMatchObject({
      disableStdin: true,
      scrollback: TERMINAL_SCROLLBACK_LINES,
      theme,
    });
    expect(backend).toHaveBeenCalledTimes(1);
    const screen = backend.mock.calls[0][0];
    expect(screen.host).toBe(container.firstElementChild);
    expect(screen.terminal).toBe(mocks.terminals[0]);
    expect(screen.fitAddon).toBe(mocks.fitAddons[0]);
  });

  it("disposes the backend before the xterm exactly once on unmount", () => {
    const { attachments, backend } = recordingBackend();
    backend.mockImplementation((screen) => {
      const attachment = {
        dispose: vi.fn(() => {
          mocks.events.push("attachment.dispose");
          screen.dispose();
        }),
        fit: vi.fn(),
      };
      attachments.push(attachment);
      return attachment;
    });
    act(() =>
      root.render(<Harness backend={backend} theme={classicTerminalTheme("classicDark")} />),
    );
    act(() => root.render(<></>));

    expect(attachments[0].dispose).toHaveBeenCalledTimes(1);
    expect(mocks.terminals[0].dispose).toHaveBeenCalledTimes(1);
    expect(mocks.events).toEqual(["attachment.dispose", "terminal.dispose"]);
  });

  it("applies theme changes in place without restarting the attachment", () => {
    const { attachments, backend } = recordingBackend();
    const light = classicTerminalTheme("classicLight");
    act(() =>
      root.render(<Harness backend={backend} theme={classicTerminalTheme("classicDark")} />),
    );
    act(() => root.render(<Harness backend={backend} theme={light} />));

    expect(backend).toHaveBeenCalledTimes(1);
    expect(mocks.terminals).toHaveLength(1);
    expect(mocks.terminals[0].options.theme).toBe(light);
    expect(attachments[0].dispose).not.toHaveBeenCalled();
  });

  it("restarts with a fresh xterm on restart key or backend change", () => {
    const first = recordingBackend();
    const second = recordingBackend();
    const theme = classicTerminalTheme("classicDark");
    act(() => root.render(<Harness backend={first.backend} restartKey={0} theme={theme} />));
    act(() => root.render(<Harness backend={first.backend} restartKey={1} theme={theme} />));
    act(() => root.render(<Harness backend={second.backend} restartKey={1} theme={theme} />));

    expect(first.attachments.map((item) => item.dispose.mock.calls.length)).toEqual([1, 1]);
    expect(second.attachments).toHaveLength(1);
    expect(mocks.terminals.map((terminal) => terminal.dispose.mock.calls.length)).toEqual([
      1, 1, 0,
    ]);
  });

  it("routes fit and focus to the live attachment only", () => {
    const { attachments, backend } = recordingBackend();
    let host: XtermHost | null = null;
    const theme = classicTerminalTheme("classicDark");
    act(() =>
      root.render(<Harness backend={backend} onHost={(next) => (host = next)} theme={theme} />),
    );
    const live = host as unknown as XtermHost;
    live.fit();
    live.focus();
    expect(attachments[0].fit).toHaveBeenCalledTimes(1);
    expect(mocks.terminals[0].focus).toHaveBeenCalledTimes(1);

    act(() => root.render(<></>));
    live.fit();
    live.focus();
    expect(attachments[0].fit).toHaveBeenCalledTimes(1);
    expect(mocks.terminals[0].focus).toHaveBeenCalledTimes(1);
  });

  it("observes host resize for fitted attachments and stops after dispose", () => {
    let fitting: ReturnType<typeof observeXtermFit> | null = null;
    const backend: XtermBackend = (screen) => {
      fitting = observeXtermFit(screen);
      return fitting;
    };
    act(() =>
      root.render(<Harness backend={backend} theme={classicTerminalTheme("classicDark")} />),
    );

    expect(mocks.events).toEqual(["loadAddon", "open", "fit"]);
    expect(mocks.observers).toHaveLength(1);
    expect(mocks.observers[0].observe).toHaveBeenCalledWith(container.firstElementChild);
    mocks.observers[0].callback();
    expect(mocks.fitAddons[0].fit).toHaveBeenCalledTimes(2);

    act(() => root.render(<></>));
    expect(mocks.observers[0].disconnect).toHaveBeenCalledTimes(1);
    mocks.observers[0].callback();
    expect(mocks.fitAddons[0].fit).toHaveBeenCalledTimes(2);
    expect(fitting).not.toBeNull();
  });

  it("tolerates a hidden host whose fit throws", () => {
    const backend: XtermBackend = (screen) => observeXtermFit(screen);
    act(() =>
      root.render(<Harness backend={backend} theme={classicTerminalTheme("classicDark")} />),
    );
    mocks.fitAddons[0].fit.mockImplementation(() => {
      throw new Error("no dimensions");
    });
    expect(() => mocks.observers[0].callback()).not.toThrow();
  });
});
