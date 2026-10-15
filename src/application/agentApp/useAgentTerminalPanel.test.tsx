// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PENDING_AGENT_TERMINAL_REQUESTS,
  useAgentTerminalPanel,
  type AgentTerminalOwner,
} from "./useAgentTerminalPanel";

type TerminalPanel = ReturnType<typeof useAgentTerminalPanel>;

const unmounts: Array<() => void> = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

function renderTerminalPanel(initialOwner: AgentTerminalOwner | null) {
  const currentWorkspaceRootRef = { current: initialOwner?.rootPath ?? null };
  const captured: { current: TerminalPanel | null } = { current: null };
  function Probe({ owner }: { readonly owner: AgentTerminalOwner | null }) {
    captured.current = useAgentTerminalPanel({ currentWorkspaceRootRef, owner });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe owner={initialOwner} />));
  unmounts.push(() => act(() => root.unmount()));
  return {
    current: () => captured.current as TerminalPanel,
    switchTo: (owner: AgentTerminalOwner | null) => {
      currentWorkspaceRootRef.current = owner?.rootPath ?? null;
      act(() => root.render(<Probe owner={owner} />));
    },
  };
}

describe("useAgentTerminalPanel", () => {
  it("reveals the terminal and hands a request the session the owner registers", () => {
    const ownerA = { rootPath: "/workspace-a" };
    const panel = renderTerminalPanel(ownerA);
    const consumer = vi.fn();

    act(() => panel.current().requestActiveTerminalSession(consumer));
    expect(panel.current().bottomPanelVisible).toBe(true);
    expect(consumer).not.toHaveBeenCalled();

    act(() => panel.current().registerActiveTerminalSession(4));
    expect(consumer).toHaveBeenCalledExactlyOnceWith(4);

    const second = vi.fn();
    act(() => panel.current().requestActiveTerminalSession(second));
    expect(second).toHaveBeenCalledExactlyOnceWith(4);
  });

  it("keeps the panel visibility with the workspace that opened it across A to B to A", () => {
    const firstA = { rootPath: "/workspace-a" };
    const ownerB = { rootPath: "/workspace-b" };
    const panel = renderTerminalPanel(firstA);

    act(() => panel.current().showTerminalPanel());
    expect(panel.current().bottomPanelVisible).toBe(true);

    panel.switchTo(ownerB);
    expect(panel.current().bottomPanelVisible).toBe(false);
    act(() => panel.current().toggleBottomPanel());
    expect(panel.current().bottomPanelVisible).toBe(true);

    const secondA = { rootPath: "/workspace-a" };
    panel.switchTo(secondA);
    expect(panel.current().bottomPanelVisible).toBe(false);

    act(() => panel.current().showTerminalPanel());
    panel.switchTo(null);
    expect(panel.current().bottomPanelVisible).toBe(false);
    act(() => panel.current().showTerminalPanel());
    expect(panel.current().bottomPanelVisible).toBe(false);
  });

  it("never hands a session of A to a request after A to B to A", async () => {
    const firstA = { rootPath: "/workspace-a" };
    const panel = renderTerminalPanel(firstA);
    act(() => panel.current().registerActiveTerminalSession(4));
    const pending = vi.fn();

    panel.switchTo({ rootPath: "/workspace-b" });
    const secondA = { rootPath: "/workspace-a" };
    panel.switchTo(secondA);
    act(() => panel.current().requestActiveTerminalSession(pending));
    expect(pending).not.toHaveBeenCalled();

    act(() => panel.current().registerActiveTerminalSession(9));
    expect(pending).toHaveBeenCalledExactlyOnceWith(9);
  });

  it("settles a request pending for a replaced owner with no session", async () => {
    const panel = renderTerminalPanel({ rootPath: "/workspace-a" });
    const pending = vi.fn();
    act(() => panel.current().requestActiveTerminalSession(pending));

    panel.switchTo({ rootPath: "/workspace-b" });
    await act(async () => Promise.resolve());

    expect(pending).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("refuses requests without a workspace and beyond the bounded queue", () => {
    const empty = renderTerminalPanel(null);
    const refused = vi.fn();
    act(() => empty.current().requestActiveTerminalSession(refused));
    expect(refused).toHaveBeenCalledExactlyOnceWith(null);

    const panel = renderTerminalPanel({ rootPath: "/workspace-a" });
    const queued = Array.from({ length: MAX_PENDING_AGENT_TERMINAL_REQUESTS }, () => vi.fn());
    const overflow = vi.fn();
    act(() => {
      for (const consumer of queued) panel.current().requestActiveTerminalSession(consumer);
      panel.current().requestActiveTerminalSession(overflow);
    });
    expect(overflow).toHaveBeenCalledExactlyOnceWith(null);
    expect(queued.every((consumer) => consumer.mock.calls.length === 0)).toBe(true);
  });
});
