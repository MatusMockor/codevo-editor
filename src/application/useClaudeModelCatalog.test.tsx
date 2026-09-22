// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ClaudeModelCatalogGateway } from "./claudeModelCatalogGateway";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUNDLED_CLAUDE_MODEL_MANIFEST,
  type ClaudeModelManifest,
} from "../domain/claudeModelCatalog";
import { useClaudeModelCatalog } from "./useClaudeModelCatalog";

function pending() {
  let resolve!: (value: ClaudeModelManifest) => void;
  const promise = new Promise<ClaudeModelManifest>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
const updated = { ...BUNDLED_CLAUDE_MODEL_MANIFEST, updatedAt: "2027-01-01T00:00:00Z" } as const;

function renderCatalog(gateway: ClaudeModelCatalogGateway) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  let current = BUNDLED_CLAUDE_MODEL_MANIFEST;
  function Harness({ port }: { readonly port: ClaudeModelCatalogGateway }) {
    current = useClaudeModelCatalog(port);
    return null;
  }
  act(() => root.render(<Harness port={gateway} />));
  return {
    result: {
      get current() {
        return current;
      },
    },
    rerender({ gateway: next }: { readonly gateway: ClaudeModelCatalogGateway }) {
      act(() => root.render(<Harness port={next} />));
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

describe("useClaudeModelCatalog", () => {
  afterEach(() => vi.useRealTimers());
  it("loads remote metadata, retains it on errors and cancels refresh on unmount", async () => {
    vi.useFakeTimers();
    const gateway = {
      read: vi.fn().mockResolvedValueOnce(updated).mockRejectedValue(new Error("offline")),
    };
    const hook = renderCatalog(gateway);
    await act(async () => {});
    expect(hook.result.current).toBe(updated);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(hook.result.current).toBe(updated);
    hook.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(gateway.read).toHaveBeenCalledTimes(2);
  });
  it("rejects late results from a replaced gateway and never overlaps requests", async () => {
    vi.useFakeTimers();
    const old = pending();
    const current = pending();
    const first = { read: vi.fn(() => old.promise) };
    const second = { read: vi.fn(() => current.promise) };
    const hook = renderCatalog(first);
    await act(async () => vi.advanceTimersByTimeAsync(180_000));
    expect(first.read).toHaveBeenCalledTimes(1);
    hook.rerender({ gateway: second });
    await act(async () => old.resolve(updated));
    expect(hook.result.current).toBe(BUNDLED_CLAUDE_MODEL_MANIFEST);
    await act(async () => current.resolve(updated));
    expect(hook.result.current).toBe(updated);
    hook.unmount();
  });
  it("subscribes before the initial read and ignores events after replacement", async () => {
    let publish!: (catalog: ClaudeModelManifest) => void;
    const stop = vi.fn();
    const read = vi.fn().mockResolvedValue(BUNDLED_CLAUDE_MODEL_MANIFEST);
    const subscribe = vi.fn(async (listener: typeof publish) => {
      publish = listener;
      return stop;
    });
    const hook = renderCatalog({ read, subscribe });
    await act(async () => {});
    expect(subscribe.mock.invocationCallOrder[0]).toBeLessThan(read.mock.invocationCallOrder[0]);
    act(() => publish(updated));
    expect(hook.result.current).toBe(updated);
    hook.rerender({ gateway: { read: async () => BUNDLED_CLAUDE_MODEL_MANIFEST } });
    expect(stop).toHaveBeenCalledOnce();
    act(() => publish(updated));
    await act(async () => {});
    expect(hook.result.current).toBe(BUNDLED_CLAUDE_MODEL_MANIFEST);
    hook.unmount();
  });
});
