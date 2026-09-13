// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { AgentShipActions } from "./AgentShipPanel";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import { useAgentShipActions, type AgentShipSurface } from "./useAgentShipActions";

it("never refreshes or ships a server thread through local git actions", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const agents: AgentShipSurface = {
    refreshShipStatus: vi.fn(),
    commitThreadChanges: vi.fn(),
    pushThreadBranch: vi.fn(),
    openThreadCompareUrl: vi.fn(),
    integrateThreadBranch: vi.fn(),
    removeThreadWorktree: vi.fn(),
    removeWorktree: vi.fn(),
    resetThreadShip: vi.fn(),
  };
  const local = surfaceThreadView();
  const remote = { ...local, thread: { ...local.thread, threadId: "remote:server:task" } };
  let actions: AgentShipActions | null = null;
  function Harness() {
    actions = useAgentShipActions({ agents, selectedThread: remote });
    return null;
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    act(() => root.render(<Harness />));
    const current = actions as AgentShipActions | null;
    if (current === null) throw new Error("Hook did not mount");
    current.onRefreshShipStatus(remote.thread.threadId);
    current.onCommit(remote.thread.threadId, "message");
    current.onPush(remote.thread.threadId);
    current.onOpenCompareUrl(remote.thread.threadId);
    current.onDiscardWorktree(remote.thread.threadId);
    current.onDismissFailure(remote.thread.threadId);
    for (const action of Object.values(agents)) expect(action).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
  }
});
