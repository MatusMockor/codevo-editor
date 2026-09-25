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
  const order: string[] = [];
  const deferOpenedProjectTrust = vi.fn((path: string) => {
    order.push(`defer:${path}`);
    return () => {
      order.push(`cancel:${path}`);
    };
  });
  function Harness() {
    current = useAgentWorkbenchProjectOpening({
      directoryListingGateway: gateway,
      deferOpenedProjectTrust,
      openWorkspaceRootWithReceipt: open,
      navigationSession,
      addProjectPending: pending,
    });
    return null;
  }
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    pending.current = null;
    order.length = 0;
    deferOpenedProjectTrust.mockClear();
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

  it("defers the automatic trust grant before opening a project that asks for trust", async () => {
    open.mockImplementation(async (path) => {
      order.push(`open:${path}`);
      return opened(path);
    });
    await act(async () => {
      await current.addProject("/code/app", { trust: "prompt" });
    });
    expect(order).toEqual(["defer:/code/app", "open:/code/app"]);
    order.length = 0;
    await act(async () => {
      await current.addProject("/code/app");
    });
    await act(async () => {
      await current.addProject("/code/app", { trust: "auto" });
    });
    expect(order).toEqual(["open:/code/app", "open:/code/app"]);
    expect(deferOpenedProjectTrust).toHaveBeenCalledTimes(1);
  });

  it("cancels the trust deferral when opening the project fails or is refused", async () => {
    open.mockRejectedValueOnce(new Error("unavailable"));
    await expect(current.addProject("/clone", { trust: "prompt" })).rejects.toThrow("unavailable");
    open.mockResolvedValueOnce({
      outcome: { kind: "cancelled", requestToken: 1 },
      isCurrent: () => true,
    });
    await expect(current.addProject("/clone", { trust: "prompt" })).rejects.toThrow();
    expect(order).toEqual(["defer:/clone", "cancel:/clone", "defer:/clone", "cancel:/clone"]);
    order.length = 0;
    open.mockResolvedValueOnce(opened("/clone"));
    await act(async () => {
      await current.addProject("/clone", { trust: "prompt" });
    });
    expect(order).toEqual(["defer:/clone"]);
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
