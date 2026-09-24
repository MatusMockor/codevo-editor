// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { AgentShipStepResult } from "../../domain/agentShip";
import type { AgentShipActions } from "./useAgentShipActions";
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

it("forwards the commit selection and resolves after the local ship step settles", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const settled: string[] = [];
  const agents: AgentShipSurface = {
    refreshShipStatus: vi.fn(async () => undefined),
    commitThreadChanges: vi.fn(async (): Promise<AgentShipStepResult> => {
      settled.push("commit");
      return { kind: "succeeded" };
    }),
    pushThreadBranch: vi.fn(async (): Promise<AgentShipStepResult> => {
      settled.push("push");
      return { kind: "failed", failure: { step: "push", reason: "noRemote", message: "none" } };
    }),
    openThreadCompareUrl: vi.fn(),
    integrateThreadBranch: vi.fn(),
    removeThreadWorktree: vi.fn(),
    removeWorktree: vi.fn(),
    resetThreadShip: vi.fn(),
  };
  const local = surfaceThreadView();
  const captured: { actions: AgentShipActions | null } = { actions: null };
  function Harness() {
    captured.actions = useAgentShipActions({ agents, selectedThread: local });
    return null;
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<Harness />));
  const actions = captured.actions;
  expect(actions).not.toBeNull();
  const selection = { kind: "paths", relativePaths: ["src/a.ts"] } as const;
  const results: AgentShipStepResult[] = [];
  await act(async () => {
    const committed = await actions?.onCommit(local.thread.threadId, "Pick one", selection);
    const pushed = await actions?.onPush(local.thread.threadId);
    if (committed !== undefined) results.push(committed);
    if (pushed !== undefined) results.push(pushed);
  });
  expect(results).toEqual([
    { kind: "succeeded" },
    { kind: "failed", failure: { step: "push", reason: "noRemote", message: "none" } },
  ]);
  expect(agents.commitThreadChanges).toHaveBeenCalledWith(
    local.thread.threadId,
    "Pick one",
    selection,
  );
  expect(settled).toEqual(["commit", "push"]);
  act(() => root.unmount());
});
