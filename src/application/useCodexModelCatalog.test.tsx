// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import wireContract from "../../contracts/codex-model-catalog-wire.json";
import {
  BUNDLED_CODEX_MODEL_CATALOG,
  parseCodexModelCatalog,
  type CodexModelCatalog,
} from "../domain/codexModelCatalog";
import type { CodexModelCatalogGateway } from "./codexModelCatalogGateway";
import { useCodexModelCatalog } from "./useCodexModelCatalog";

const live = parseCodexModelCatalog(wireContract.catalogs[0].value);
const newer = parseCodexModelCatalog({ ...wireContract.catalogs[0].value, revision: 9 });

function pending() {
  let resolve!: (value: CodexModelCatalog) => void;
  const promise = new Promise<CodexModelCatalog>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function renderCatalog(gateway: CodexModelCatalogGateway) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  let current = BUNDLED_CODEX_MODEL_CATALOG;
  function Harness({ port }: { readonly port: CodexModelCatalogGateway }) {
    current = useCodexModelCatalog(port);
    return null;
  }
  act(() => root.render(<Harness port={gateway} />));
  return {
    result: {
      get current() {
        return current;
      },
    },
    rerender(next: CodexModelCatalogGateway) {
      act(() => root.render(<Harness port={next} />));
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

describe("useCodexModelCatalog", () => {
  afterEach(() => vi.useRealTimers());

  it("starts from the bundle, loads the live list and keeps it when a refresh fails", async () => {
    vi.useFakeTimers();
    const gateway = {
      read: vi.fn().mockResolvedValueOnce(live).mockRejectedValue(new Error("offline")),
    };
    const hook = renderCatalog(gateway);
    expect(hook.result.current).toBe(BUNDLED_CODEX_MODEL_CATALOG);
    await act(async () => {});
    expect(hook.result.current).toBe(live);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(hook.result.current).toBe(live);
    hook.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(gateway.read).toHaveBeenCalledTimes(2);
  });

  it("never lets a late older revision replace a newer snapshot", async () => {
    let publish!: (catalog: CodexModelCatalog) => void;
    const read = pending();
    const hook = renderCatalog({
      read: () => read.promise,
      subscribe: async (listener) => {
        publish = listener;
        return () => {};
      },
    });
    await act(async () => {});
    act(() => publish(newer));
    expect(hook.result.current).toBe(newer);
    await act(async () => read.resolve(live));
    expect(hook.result.current).toBe(newer);
    hook.unmount();
  });

  it("keeps the current snapshot object when a poll returns the same revision", async () => {
    let publish!: (catalog: CodexModelCatalog) => void;
    const hook = renderCatalog({
      read: async () => live,
      subscribe: async (listener) => {
        publish = listener;
        return () => {};
      },
    });
    await act(async () => {});
    expect(hook.result.current).toBe(live);
    act(() => publish(parseCodexModelCatalog(wireContract.catalogs[0].value)));
    expect(hook.result.current).toBe(live);
    hook.unmount();
  });

  it("drops results and events from a replaced gateway", async () => {
    let publish!: (catalog: CodexModelCatalog) => void;
    const stop = vi.fn();
    const old = pending();
    const hook = renderCatalog({
      read: () => old.promise,
      subscribe: async (listener) => {
        publish = listener;
        return stop;
      },
    });
    await act(async () => {});
    hook.rerender({ read: async () => BUNDLED_CODEX_MODEL_CATALOG });
    expect(stop).toHaveBeenCalledOnce();
    await act(async () => old.resolve(live));
    act(() => publish(newer));
    await act(async () => {});
    expect(hook.result.current).toBe(BUNDLED_CODEX_MODEL_CATALOG);
    hook.unmount();
  });
});
