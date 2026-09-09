// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentWorkbenchScreenWorkbench } from "./AgentWorkbenchScreen";
import type { AgentWorkbenchAddProjectChrome } from "./agentWorkbenchChrome";
import { NO_SCOPE_STATE, type AgentNavigationSession } from "./useAgentThreadNavigation";
import {
  useAgentWorkbenchProjectOpening,
  type AgentPendingProjectOpen,
} from "./useAgentWorkbenchProjectOpening";

type Open = AgentWorkbenchScreenWorkbench["openWorkspaceRootWithReceipt"];
type Outcome = Awaited<ReturnType<Open>>;
function opened(rootPath: string, current = true): Outcome {
  return {
    isCurrent: () => current,
    outcome: {
      kind: "opened",
      receipt: {
        kind: "registeredWorkspaceOpenReceipt",
        canonicalRoot: rootPath,
        workspaceId: rootPath,
        selectedPath: rootPath,
        requestToken: 1,
        admissionGeneration: 1,
        admissionToken: 1,
        descriptor: {
          policy: { caseSensitive: true, unicodeNormalization: "none" },
          canonicalRoot: rootPath,
          caseSensitive: true,
          selectedPath: rootPath,
          unicodeNormalizationPolicy: "preserved",
          workspaceId: rootPath,
        },
      },
    },
  };
}
function deferred() {
  let resolve: (result: Outcome) => void = () => undefined;
  const promise = new Promise<Outcome>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("project opening selection ownership", () => {
  let root: ReturnType<typeof createRoot>;
  let current: AgentWorkbenchAddProjectChrome;
  const pending: { current: AgentPendingProjectOpen | null } = { current: null };
  const navigationSession: AgentNavigationSession = {
    current: { selectedThreadId: null, selectedThreadOwnerKey: null, scopeState: NO_SCOPE_STATE },
  };
  const open = vi.fn<Open>();
  const gateway = { listDirectoryEntries: vi.fn(), revealDirectory: vi.fn() };
  function Harness() {
    current = useAgentWorkbenchProjectOpening({
      directoryListingGateway: gateway,
      openWorkspaceRootWithReceipt: open,
      navigationSession,
      addProjectPending: pending,
    });
    return null;
  }
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    pending.current = null;
    open.mockReset();
    root = createRoot(document.createElement("div"));
    act(() => root.render(<Harness />));
  });
  afterEach(() => act(() => root.unmount()));

  it("does not let an older failure release a newer pending selection", async () => {
    const first = deferred();
    const second = deferred();
    open.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a = current.addProject("/a").catch(() => undefined);
    const b = current.addProject("/b");
    const epoch = pending.current;
    await act(async () => {
      first.resolve({ outcome: { kind: "cancelled", requestToken: 1 }, isCurrent: () => false });
      await a;
    });
    expect(pending.current).toBe(epoch);
    await act(async () => {
      second.resolve(opened("/b"));
      await b;
    });
    expect(pending.current).toBe(epoch);
    const receipt = await b;
    act(() => current.consumeSelection?.(receipt));
    expect(pending.current).toBeNull();
  });

  it("releases a published receipt that becomes stale without clearing a newer add", async () => {
    let valid = true;
    open.mockResolvedValueOnce({ ...opened("/a"), isCurrent: () => valid });
    await act(async () => {
      await current.addProject("/a");
    });
    expect(pending.current).not.toBeNull();
    valid = false;
    act(() => root.render(<Harness />));
    expect(pending.current).toBeNull();

    valid = true;
    open.mockResolvedValueOnce({ ...opened("/a"), isCurrent: () => valid });
    await act(async () => {
      await current.addProject("/a");
    });
    const next = deferred();
    open.mockReturnValueOnce(next.promise);
    const request = current.addProject("/b");
    const epoch = pending.current;
    valid = false;
    act(() => root.render(<Harness />));
    expect(pending.current).toBe(epoch);
    await act(async () => {
      next.resolve(opened("/b"));
      await request;
    });
  });

  it("releases synchronization suppression when opening rejects", async () => {
    open.mockRejectedValue(new Error("unavailable"));
    await expect(current.addProject("/a")).rejects.toThrow("unavailable");
    expect(pending.current).toBeNull();
  });

  it("releases suppression for an already stale receipt", async () => {
    open.mockResolvedValue(opened("/a", false));
    const receipt = await current.addProject("/a");
    expect(receipt.isCurrent()).toBe(false);
    expect(pending.current).toBeNull();
    expect(current.receipt).toBeNull();
  });
});
