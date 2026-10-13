// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodexRateLimitResetGateway } from "./codexRateLimitResetGateway";
import { useCodexRateLimitResets } from "./useCodexRateLimitResets";

const snapshot = {
  accountIdentity: "a",
  availableCount: 2,
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
      await act(async () => hook.current.requestReset());
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
    await act(async () => hook.current.requestReset());
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
    await act(async () => hook.current.requestReset());
    let confirmation!: Promise<void>;
    await act(async () => {
      confirmation = hook.current.confirmReset();
    });
    expect(hook.current.state.status).toBe("loading");
    expect(hook.current.canReset).toBe(false);
    await act(async () => hook.current.requestReset());
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
    await act(async () => hook.current.requestReset());
    expect(port.prepare).not.toHaveBeenCalled();
    hook.unmount();
  });
  it("reads display information and requires a separate confirmation before consuming", async () => {
    const port = gateway();
    const hook = render(port);
    await act(async () => {});
    expect(hook.current.state.status).toBe("ready");
    expect(hook.current.state.snapshot).not.toHaveProperty("accountIdentity");
    await act(async () => hook.current.requestReset());
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
    await act(async () => hook.current.requestReset());
    await act(async () => hook.current.confirmReset());
    expect(hook.current.state.status).toBe("uncertain");
    const first = vi.mocked(port.consume).mock.calls[0][0];
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
    await act(async () => hook.current.requestReset());
    vi.setSystemTime(Date.now() + 60_001);
    await act(async () => hook.current.confirmReset());
    expect(port.consume).not.toHaveBeenCalled();
    await act(async () => hook.current.requestReset());
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
    await act(async () => hook.current.requestReset());
    expect(port.prepare).not.toHaveBeenCalled();
    expect(hook.current.state.snapshot).toBeNull();
    hook.unmount();
  });
  it("ignores late preparation after unmount and truthful null/zero counts", async () => {
    const port = gateway();
    vi.mocked(port.read).mockResolvedValue({ ...snapshot, availableCount: null });
    const hook = render(port);
    await act(async () => {});
    await act(async () => hook.current.requestReset());
    expect(hook.current.state.snapshot?.availableCount).toBeNull();
    expect(port.prepare).not.toHaveBeenCalled();
    vi.mocked(port.read).mockResolvedValue(snapshot);
    await act(async () => hook.current.refresh());
    const prepare = pending<{ confirmationToken: string }>();
    vi.mocked(port.prepare).mockReturnValue(prepare.promise);
    let request!: Promise<void>;
    await act(async () => {
      request = hook.current.requestReset();
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
});
