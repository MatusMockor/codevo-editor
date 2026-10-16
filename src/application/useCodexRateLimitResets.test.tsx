// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodexRateLimitResetGateway } from "./codexRateLimitResetGateway";
import { useCodexRateLimitResets } from "./useCodexRateLimitResets";

const credit = {
  id: "credit-1",
  title: "Full reset",
  description: null,
  grantedAtEpochMs: 1_000,
  expiresAtEpochMs: null,
};
const snapshot = {
  accountIdentity: "a",
  availableCount: 2,
  credits: [credit] as (typeof credit)[] | null,
  history: [],
  historyTruncated: false,
  pendingOperationId: null as string | null,
};
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function gateway(): CodexRateLimitResetGateway {
  return {
    read: vi.fn().mockResolvedValue(snapshot),
    prepare: vi.fn().mockResolvedValue({ confirmationToken: "token" }),
    consume: vi.fn().mockResolvedValue({ outcome: "reset" }),
  };
}
function render(port: CodexRateLimitResetGateway, generation: number | null = 1) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.createElement("div"));
  const refreshLimits = vi.fn();
  let current!: ReturnType<typeof useCodexRateLimitResets>;
  function Harness({
    providerGeneration,
    gateway: adapter,
  }: {
    providerGeneration: number | null;
    gateway: CodexRateLimitResetGateway;
  }) {
    current = useCodexRateLimitResets({ gateway: adapter, providerGeneration, refreshLimits });
    return null;
  }
  act(() => root.render(<Harness providerGeneration={generation} gateway={port} />));
  return {
    get current() {
      return current;
    },
    refreshLimits,
    rerender(nextGeneration: number | null, adapter = port) {
      act(() => root.render(<Harness providerGeneration={nextGeneration} gateway={adapter} />));
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

describe("useCodexRateLimitResets", () => {
  afterEach(() => vi.useRealTimers());
  it.each([0, 2])(
    "adopts a newly discovered pending reset with %i available credits",
    async (availableCount) => {
      const port = gateway();
      vi.mocked(port.read)
        .mockResolvedValueOnce(snapshot)
        .mockResolvedValueOnce({
          ...snapshot,
          availableCount,
          pendingOperationId: "other-window-key",
        })
        .mockResolvedValue({ ...snapshot, availableCount });
      const hook = render(port);
      await act(async () => {});
      await act(async () => hook.current.requestReset(null));
      await act(async () => hook.current.confirmReset());
      expect(vi.mocked(port.consume).mock.calls[0][0].idempotencyKey).toBe("other-window-key");
      hook.unmount();
    },
  );
  it("leaves retry recovery actionable when its account changes", async () => {
    const port = gateway();
    vi.mocked(port.consume).mockRejectedValue(new Error("disconnected"));
    const hook = render(port);
    await act(async () => {});
    await act(async () => hook.current.requestReset(null));
    await act(async () => hook.current.confirmReset());
    expect(hook.current.state.status).toBe("uncertain");
    vi.mocked(port.read).mockResolvedValue({ ...snapshot, accountIdentity: "different" });
    await act(async () => hook.current.retryReset());
    expect(hook.current.state.status).toBe("error");
    expect(hook.current.state.snapshot).toBeNull();
    await act(async () => hook.current.refresh());
    expect(hook.current.state.status).toBe("ready");
    hook.unmount();
  });
  it("keeps new resets disabled until post-consume account refresh settles", async () => {
    const port = gateway();
    const refreshed = pending<typeof snapshot>();
    vi.mocked(port.read)
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(snapshot)
      .mockReturnValueOnce(refreshed.promise);
    const hook = render(port);
    await act(async () => {});
    await act(async () => hook.current.requestReset(null));
    let confirmation!: Promise<void>;
    await act(async () => {
      confirmation = hook.current.confirmReset();
    });
    expect(hook.current.state.status).toBe("loading");
    expect(hook.current.canReset).toBe(false);
    await act(async () => hook.current.requestReset(null));
    expect(port.prepare).toHaveBeenCalledOnce();
    await act(async () => refreshed.resolve({ ...snapshot, availableCount: 1 }));
    await confirmation;
    expect(hook.current.state.snapshot?.availableCount).toBe(1);
    hook.unmount();
  });
  it("shows availability but disables resetting an unidentified account", async () => {
    const port = gateway();
    vi.mocked(port.read).mockResolvedValue({ ...snapshot, accountIdentity: null });
    const hook = render(port);
    await act(async () => {});
    expect(hook.current.state.snapshot?.availableCount).toBe(2);
    expect(hook.current.canReset).toBe(false);
    await act(async () => hook.current.requestReset(null));
    expect(port.prepare).not.toHaveBeenCalled();
    hook.unmount();
  });
  it("reads display information and requires a separate confirmation before consuming", async () => {
    const port = gateway();
    const hook = render(port);
    await act(async () => {});
    expect(hook.current.state.status).toBe("ready");
    expect(hook.current.state.snapshot).not.toHaveProperty("accountIdentity");
    await act(async () => hook.current.requestReset(null));
    expect(hook.current.state.status).toBe("confirming");
    expect(hook.current.state).not.toHaveProperty("confirmationToken");
    expect(port.consume).not.toHaveBeenCalled();
    await act(async () => hook.current.confirmReset());
    expect(hook.current.state.outcome).toBe("reset");
    expect(hook.refreshLimits).toHaveBeenCalledOnce();
    hook.unmount();
  });
  it("uses fresh preparation and the same key for uncertain retries, including cancelled retry", async () => {
    const port = gateway();
    vi.mocked(port.consume)
      .mockRejectedValueOnce(new Error("disconnected"))
      .mockResolvedValue({ outcome: "alreadyRedeemed" });
    const hook = render(port);
    await act(async () => {});
    await act(async () => hook.current.requestReset(null));
    await act(async () => hook.current.confirmReset());
    expect(hook.current.state.status).toBe("uncertain");
    const first = vi.mocked(port.consume).mock.calls[0][0];
    vi.mocked(port.read).mockResolvedValue({
      ...snapshot,
      pendingOperationId: first.idempotencyKey,
    });
    await act(async () => hook.current.retryReset());
    act(() => hook.current.cancelReset());
    expect(hook.current.state.status).toBe("uncertain");
    await act(async () => hook.current.retryReset());
    await act(async () => hook.current.confirmReset());
    expect(vi.mocked(port.consume).mock.calls[1][0].idempotencyKey).toBe(first.idempotencyKey);
    expect(port.prepare).toHaveBeenCalledTimes(3);
    expect(hook.current.state.outcome).toBe("alreadyRedeemed");
    hook.unmount();
  });
  it("blocks expiry and duplicate confirms", async () => {
    vi.useFakeTimers();
    const port = gateway();
    const hook = render(port);
    await act(async () => {});
    await act(async () => hook.current.requestReset(null));
    vi.setSystemTime(Date.now() + 60_001);
    await act(async () => hook.current.confirmReset());
    expect(port.consume).not.toHaveBeenCalled();
    await act(async () => hook.current.requestReset(null));
    await act(async () => {
      await Promise.all([hook.current.confirmReset(), hook.current.confirmReset()]);
    });
    expect(port.consume).toHaveBeenCalledOnce();
    hook.unmount();
  });
  it("restores the native pending key after remount even with no remaining credits", async () => {
    const port = gateway();
    vi.mocked(port.read).mockResolvedValue({
      ...snapshot,
      availableCount: 0,
      pendingOperationId: "persisted-key",
    });
    const hook = render(port);
    await act(async () => {});
    expect(hook.current.state.status).toBe("uncertain");
    expect(hook.current.state.snapshot).not.toHaveProperty("pendingOperationId");
    await act(async () => hook.current.retryReset());
    await act(async () => hook.current.confirmReset());
    expect(vi.mocked(port.consume).mock.calls[0][0].idempotencyKey).toBe("persisted-key");
    hook.unmount();
  });
  it("drops pending account/generation A to B to A results and never prepares on changed accounts", async () => {
    const port = gateway();
    const first = pending<typeof snapshot>();
    vi.mocked(port.read).mockReturnValueOnce(first.promise);
    const hook = render(port);
    hook.rerender(2);
    hook.rerender(1);
    await act(async () => {});
    await act(async () => first.resolve({ ...snapshot, availableCount: 99 }));
    expect(hook.current.state.snapshot?.availableCount).toBe(2);
    vi.mocked(port.read).mockResolvedValue({ ...snapshot, accountIdentity: "b" });
    await act(async () => hook.current.requestReset(null));
    expect(port.prepare).not.toHaveBeenCalled();
    expect(hook.current.state.snapshot).toBeNull();
    hook.unmount();
  });
  it("ignores late preparation after unmount and truthful null/zero counts", async () => {
    const port = gateway();
    vi.mocked(port.read).mockResolvedValue({ ...snapshot, availableCount: null });
    const hook = render(port);
    await act(async () => {});
    await act(async () => hook.current.requestReset(null));
    expect(hook.current.state.snapshot?.availableCount).toBeNull();
    expect(port.prepare).not.toHaveBeenCalled();
    vi.mocked(port.read).mockResolvedValue(snapshot);
    await act(async () => hook.current.refresh());
    const prepare = pending<{ confirmationToken: string }>();
    vi.mocked(port.prepare).mockReturnValue(prepare.promise);
    let request!: Promise<void>;
    await act(async () => {
      request = hook.current.requestReset(null);
    });
    hook.unmount();
    await act(async () => prepare.resolve({ confirmationToken: "late" }));
    await request;
    expect(port.consume).not.toHaveBeenCalled();
  });
  it("disables provider-unavailable and unreadable capabilities", async () => {
    const port = gateway();
    const hook = render(port, null);
    await act(async () => {});
    expect(port.read).not.toHaveBeenCalled();
    hook.rerender(1);
    vi.mocked(port.read).mockRejectedValue(new Error("unsupported"));
    await act(async () => {});
    await act(async () => hook.current.refresh());
    expect(hook.current.state.status).toBe("error");
    expect(hook.current.state.snapshot).toBeNull();
    hook.unmount();
  });
  it("prepares and confirms the chosen credit and exposes it only while targeting", async () => {
    const port = gateway();
    const prepare = pending<{ confirmationToken: string }>();
    const consume = pending<{ outcome: "reset" }>();
    vi.mocked(port.prepare).mockReturnValueOnce(prepare.promise);
    vi.mocked(port.consume).mockReturnValueOnce(consume.promise);
    const hook = render(port);
    await act(async () => {});
    expect(hook.current.state.snapshot?.credits).toEqual([credit]);
    expect(hook.current.state.targetCreditId).toBeNull();
    let request!: Promise<void>;
    await act(async () => {
      request = hook.current.requestReset("credit-1");
    });
    expect(hook.current.state).toMatchObject({ status: "preparing", targetCreditId: "credit-1" });
    await act(async () => prepare.resolve({ confirmationToken: "token" }));
    await request;
    expect(port.prepare).toHaveBeenCalledWith({
      providerGeneration: 1,
      accountIdentity: "a",
      creditId: "credit-1",
    });
    expect(hook.current.state).toMatchObject({ status: "confirming", targetCreditId: "credit-1" });
    act(() => hook.current.cancelReset());
    expect(hook.current.state).toMatchObject({ status: "ready", targetCreditId: null });
    await act(async () => hook.current.requestReset("credit-1"));
    let confirmation!: Promise<void>;
    await act(async () => {
      confirmation = hook.current.confirmReset();
    });
    expect(hook.current.state).toMatchObject({ status: "consuming", targetCreditId: "credit-1" });
    await act(async () => consume.resolve({ outcome: "reset" }));
    await confirmation;
    expect(hook.current.state).toMatchObject({
      status: "ready",
      outcome: "reset",
      targetCreditId: null,
    });
    hook.unmount();
  });
  it("ignores credits missing from the latest snapshot and reports credits that vanished", async () => {
    const port = gateway();
    const hook = render(port);
    await act(async () => {});
    await act(async () => hook.current.requestReset("unknown-credit"));
    expect(port.read).toHaveBeenCalledOnce();
    expect(hook.current.state.status).toBe("ready");
    vi.mocked(port.read).mockResolvedValue({ ...snapshot, availableCount: 1, credits: [] });
    await act(async () => hook.current.requestReset("credit-1"));
    expect(port.prepare).not.toHaveBeenCalled();
    expect(hook.current.state).toMatchObject({
      status: "ready",
      error: "This reset is no longer available. Check resets again.",
      targetCreditId: null,
      snapshot: { availableCount: 1, credits: [] },
    });
    vi.mocked(port.read).mockResolvedValue({ ...snapshot, credits: null });
    await act(async () => hook.current.refresh());
    await act(async () => hook.current.requestReset("credit-1"));
    expect(port.read).toHaveBeenCalledTimes(3);
    await act(async () => hook.current.requestReset(null));
    expect(port.prepare).toHaveBeenCalledWith({
      providerGeneration: 1,
      accountIdentity: "a",
      creditId: null,
    });
    hook.unmount();
  });
  async function uncertainAfterLostReceipt(port: CodexRateLimitResetGateway) {
    vi.mocked(port.consume).mockRejectedValueOnce(new Error("receipt lost"));
    const hook = render(port);
    await act(async () => {});
    await act(async () => hook.current.requestReset("credit-1"));
    await act(async () => hook.current.confirmReset());
    expect(hook.current.state.status).toBe("uncertain");
    return { hook, key: vi.mocked(port.consume).mock.calls[0][0].idempotencyKey };
  }
  const settledThrough = {
    retry: (hook: ReturnType<typeof render>) => hook.current.retryReset(),
    refresh: (hook: ReturnType<typeof render>) => hook.current.refresh(),
  } as const;
  it.each(["retry", "refresh"] as const)(
    "settles a finished reset found in history through %s without consuming again",
    async (path) => {
      const port = gateway();
      const { hook, key } = await uncertainAfterLostReceipt(port);
      vi.mocked(port.read).mockResolvedValue({
        ...snapshot,
        availableCount: 1,
        history: [{ operationId: key, usedAtEpochMs: 5_000, creditTitle: "Full reset" }],
      });
      await act(async () => settledThrough[path](hook));
      expect(port.prepare).toHaveBeenCalledOnce();
      expect(port.consume).toHaveBeenCalledOnce();
      expect(hook.current.state).toMatchObject({
        status: "ready",
        outcome: "reset",
        error: null,
        intent: null,
        targetCreditId: null,
      });
      expect(hook.current.state.snapshot?.availableCount).toBe(1);
      expect(hook.refreshLimits).toHaveBeenCalledOnce();
      expect(hook.current.canReset).toBe(true);
      hook.unmount();
    },
  );
  it.each(["retry", "refresh"] as const)(
    "settles a reset that never went through with no credits left through %s",
    async (path) => {
      const port = gateway();
      const { hook } = await uncertainAfterLostReceipt(port);
      vi.mocked(port.read).mockResolvedValue({ ...snapshot, availableCount: 0, credits: [] });
      await act(async () => settledThrough[path](hook));
      expect(port.prepare).toHaveBeenCalledOnce();
      expect(port.consume).toHaveBeenCalledOnce();
      expect(hook.current.state).toMatchObject({
        status: "ready",
        outcome: "notApplied",
        error: null,
        intent: null,
      });
      expect(hook.refreshLimits).not.toHaveBeenCalled();
      await act(async () => hook.current.retryReset());
      expect(port.prepare).toHaveBeenCalledOnce();
      hook.unmount();
    },
  );
  it("settles instead of preparing when a credit is chosen while a settled reset looks uncertain", async () => {
    const port = gateway();
    const { hook } = await uncertainAfterLostReceipt(port);
    vi.mocked(port.read).mockResolvedValue({
      ...snapshot,
      credits: [credit, { ...credit, id: "credit-2" }],
    });
    await act(async () => hook.current.requestReset("credit-2"));
    expect(port.prepare).toHaveBeenCalledOnce();
    expect(hook.current.state).toMatchObject({ status: "ready", outcome: "notApplied" });
    await act(async () => hook.current.requestReset("credit-2"));
    expect(vi.mocked(port.prepare).mock.calls[1][0].creditId).toBe("credit-2");
    expect(hook.current.state).toMatchObject({ status: "confirming", intent: "reset" });
    hook.unmount();
  });
  it("lets the backend's persisted credit drive a retry of a pending reset", async () => {
    const port = gateway();
    vi.mocked(port.consume)
      .mockRejectedValueOnce(new Error("disconnected"))
      .mockResolvedValue({ outcome: "alreadyRedeemed" });
    const hook = render(port);
    await act(async () => {});
    await act(async () => hook.current.requestReset("credit-1"));
    await act(async () => hook.current.confirmReset());
    const first = vi.mocked(port.consume).mock.calls[0][0];
    vi.mocked(port.read).mockResolvedValue({
      ...snapshot,
      pendingOperationId: first.idempotencyKey,
    });
    await act(async () => hook.current.retryReset());
    expect(vi.mocked(port.prepare).mock.calls[1][0].creditId).toBeNull();
    expect(hook.current.state).toMatchObject({
      status: "confirming",
      targetCreditId: null,
      intent: "retry",
    });
    await act(async () => hook.current.confirmReset());
    expect(vi.mocked(port.consume).mock.calls[1][0].idempotencyKey).toBe(first.idempotencyKey);
    hook.unmount();
  });
  it("adopts another window's pending reset without targeting the chosen credit", async () => {
    const port = gateway();
    vi.mocked(port.read)
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce({ ...snapshot, pendingOperationId: "other-window-key" });
    const hook = render(port);
    await act(async () => {});
    await act(async () => hook.current.requestReset("credit-1"));
    expect(vi.mocked(port.prepare).mock.calls[0][0].creditId).toBeNull();
    expect(hook.current.state).toMatchObject({ status: "confirming", targetCreditId: null });
    hook.unmount();
  });
  it("drops a late chosen-credit preparation after an account generation change", async () => {
    const port = gateway();
    const prepare = pending<{ confirmationToken: string }>();
    vi.mocked(port.prepare).mockReturnValueOnce(prepare.promise);
    const hook = render(port);
    await act(async () => {});
    let request!: Promise<void>;
    await act(async () => {
      request = hook.current.requestReset("credit-1");
    });
    hook.rerender(2);
    await act(async () => prepare.resolve({ confirmationToken: "late" }));
    await request;
    expect(hook.current.state.targetCreditId).toBeNull();
    expect(hook.current.state.status).not.toBe("confirming");
    await act(async () => hook.current.confirmReset());
    expect(port.consume).not.toHaveBeenCalled();
    hook.unmount();
  });
  it("marks a normal attempt as a reset until it settles", async () => {
    const port = gateway();
    const prepared = pending<{ confirmationToken: string }>();
    const consumed = pending<{ outcome: "reset" }>();
    vi.mocked(port.prepare).mockReturnValueOnce(prepared.promise);
    vi.mocked(port.consume).mockReturnValueOnce(consumed.promise);
    const hook = render(port);
    await act(async () => {});
    expect(hook.current.state).toMatchObject({ status: "ready", intent: null });
    let request!: Promise<void>;
    await act(async () => {
      request = hook.current.requestReset("credit-1");
    });
    expect(hook.current.state).toMatchObject({ status: "preparing", intent: "reset" });
    await act(async () => {
      prepared.resolve({ confirmationToken: "token" });
      await request;
    });
    expect(hook.current.state).toMatchObject({ status: "confirming", intent: "reset" });
    let confirmation!: Promise<void>;
    await act(async () => {
      confirmation = hook.current.confirmReset();
    });
    expect(hook.current.state).toMatchObject({ status: "consuming", intent: "reset" });
    await act(async () => {
      consumed.resolve({ outcome: "reset" });
      await confirmation;
    });
    expect(hook.current.state).toMatchObject({ status: "ready", intent: null });
    hook.unmount();
  });
  it("clears the intent when a confirmation is cancelled or expires", async () => {
    vi.useFakeTimers();
    const port = gateway();
    const hook = render(port);
    await act(async () => {});
    await act(async () => hook.current.requestReset("credit-1"));
    expect(hook.current.state.intent).toBe("reset");
    act(() => hook.current.cancelReset());
    expect(hook.current.state).toMatchObject({ status: "ready", intent: null });
    await act(async () => hook.current.requestReset(null));
    vi.setSystemTime(Date.now() + 60_001);
    await act(async () => hook.current.confirmReset());
    expect(hook.current.state).toMatchObject({ status: "ready", intent: null });
    hook.unmount();
  });
  it("marks an explicit retry of an uncertain reset as a retry", async () => {
    const port = gateway();
    vi.mocked(port.consume)
      .mockRejectedValueOnce(new Error("disconnected"))
      .mockResolvedValue({ outcome: "alreadyRedeemed" });
    const hook = render(port);
    await act(async () => {});
    await act(async () => hook.current.requestReset("credit-1"));
    await act(async () => hook.current.confirmReset());
    expect(hook.current.state).toMatchObject({ status: "uncertain", intent: null });
    vi.mocked(port.read).mockResolvedValue({
      ...snapshot,
      pendingOperationId: vi.mocked(port.consume).mock.calls[0][0].idempotencyKey,
    });
    await act(async () => hook.current.retryReset());
    expect(hook.current.state).toMatchObject({ status: "confirming", intent: "retry" });
    act(() => hook.current.cancelReset());
    expect(hook.current.state).toMatchObject({ status: "uncertain", intent: null });
    await act(async () => hook.current.retryReset());
    const consumed = pending<{ outcome: "alreadyRedeemed" }>();
    vi.mocked(port.consume).mockReturnValueOnce(consumed.promise);
    let confirmation!: Promise<void>;
    await act(async () => {
      confirmation = hook.current.confirmReset();
    });
    expect(hook.current.state).toMatchObject({ status: "consuming", intent: "retry" });
    await act(async () => {
      consumed.resolve({ outcome: "alreadyRedeemed" });
      await confirmation;
    });
    expect(hook.current.state).toMatchObject({ status: "ready", intent: null });
    hook.unmount();
  });
  it("switches a chosen-credit request to a retry when the read adopts a pending reset", async () => {
    const port = gateway();
    const prepared = pending<{ confirmationToken: string }>();
    vi.mocked(port.prepare).mockReturnValueOnce(prepared.promise);
    vi.mocked(port.read)
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce({ ...snapshot, pendingOperationId: "other-window-key" });
    const hook = render(port);
    await act(async () => {});
    let request!: Promise<void>;
    await act(async () => {
      request = hook.current.requestReset("credit-1");
    });
    expect(hook.current.state).toMatchObject({
      status: "preparing",
      intent: "retry",
      targetCreditId: null,
    });
    await act(async () => {
      prepared.resolve({ confirmationToken: "token" });
      await request;
    });
    expect(hook.current.state).toMatchObject({
      status: "confirming",
      intent: "retry",
      targetCreditId: null,
    });
    hook.unmount();
  });
});
