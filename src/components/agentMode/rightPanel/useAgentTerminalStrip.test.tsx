// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountUi, type MountedUi } from "../../../ui/foundation/foundationTestSupport";
import type { TerminalTabsCommands } from "../../TerminalTabsPanel";
import { useAgentTerminalStrip } from "./useAgentTerminalStrip";

let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

function harness() {
  const box: { current: ReturnType<typeof useAgentTerminalStrip> | null } = { current: null };
  function Probe() {
    box.current = useAgentTerminalStrip();
    return null;
  }
  ui = mountUi();
  ui.render(<Probe />);
  return box;
}

function commands(): TerminalTabsCommands {
  return {
    activate: vi.fn(),
    close: vi.fn(),
    create: vi.fn(),
    toggleSplit: vi.fn(),
    stopActive: vi.fn(),
    restartActive: vi.fn(),
  };
}

describe("useAgentTerminalStrip", () => {
  it("maps snapshots to strip state and forwards commands", () => {
    const box = harness();
    const fake = commands();
    act(() => {
      box.current?.externalStrip.onSnapshot({
        tabs: [
          { id: "terminal-0", title: "dev", live: true, closable: true },
          { id: "terminal-1", title: "zsh", live: false, closable: true },
        ],
        activeTabId: "terminal-1",
        canCreate: true,
        split: false,
      });
    });
    if (box.current !== null) box.current.externalStrip.commandsRef.current = fake;

    expect(box.current?.state).toEqual({
      sessions: [
        { id: "terminal-0", title: "dev", live: true, closable: true },
        { id: "terminal-1", title: "zsh", live: false, closable: true },
      ],
      activeSessionId: "terminal-1",
    });
    const closeSurface = vi.fn();
    box.current?.command({ kind: "close", sessionId: "terminal-0" }, closeSurface);
    expect(fake.close).toHaveBeenCalledWith("terminal-0");
    expect(closeSurface).not.toHaveBeenCalled();
  });

  it("closes the terminal surface when the last session tab is closed", () => {
    const box = harness();
    const fake = commands();
    act(() => {
      box.current?.externalStrip.onSnapshot({
        tabs: [{ id: "terminal-0", title: "Terminal 1", live: true, closable: true }],
        activeTabId: "terminal-0",
        canCreate: true,
        split: false,
      });
    });
    if (box.current !== null) box.current.externalStrip.commandsRef.current = fake;
    const closeSurface = vi.fn();

    box.current?.command({ kind: "close", sessionId: "terminal-0" }, closeSurface);

    expect(closeSurface).toHaveBeenCalledOnce();
    expect(fake.close).not.toHaveBeenCalled();
  });

  it("forgets sessions when the panel publishes null", () => {
    const box = harness();
    act(() => box.current?.externalStrip.onSnapshot(null));
    expect(box.current?.state).toBeNull();
  });
});
