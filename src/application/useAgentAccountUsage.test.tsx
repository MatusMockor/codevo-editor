// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentAccountUsageSnapshot } from "../domain/agentAccountUsage";
import { BrowserAgentAccountUsageStoreGateway } from "../infrastructure/browserAgentAccountUsageStoreGateway";
import { useAgentAccountUsage } from "./useAgentAccountUsage";

type Surface = ReturnType<typeof useAgentAccountUsage>;
function snapshot(fetchedAtEpochMs: number, usedPercent: number): AgentAccountUsageSnapshot {
  return {
    provider: "codex",
    fetchedAtEpochMs,
    windows: [
      {
        id: "weekly",
        label: "Weekly limit",
        usedPercent,
        windowDurationMinutes: 10080,
        resetsAtEpochMs: null,
        resetsLabel: null,
      },
    ],
  };
}
function gateway() {
  const values = new Map<string, string>();
  return new BrowserAgentAccountUsageStoreGateway({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  });
}

describe("useAgentAccountUsage", () => {
  const roots: Root[] = [];
  beforeEach(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));
  afterEach(() => {
    act(() => roots.splice(0).forEach((root) => root.unmount()));
  });
  function mount(store: BrowserAgentAccountUsageStoreGateway) {
    const root = createRoot(document.createElement("div"));
    roots.push(root);
    let current!: Surface;
    function Harness({ gateway }: { readonly gateway: BrowserAgentAccountUsageStoreGateway }) {
      current = useAgentAccountUsage(gateway);
      return null;
    }
    const render = (next = store) => act(() => root.render(<Harness gateway={next} />));
    render();
    return {
      current: () => current,
      render,
      unmount: () => {
        act(() => root.unmount());
        roots.splice(roots.indexOf(root), 1);
      },
    };
  }

  it("updates all mounted workspaces from one observation without merging their older windows", () => {
    const store = gateway();
    const a = mount(store);
    const b = mount(store);
    act(() => a.current().recordAccountUsage(snapshot(10, 31)));
    expect(a.current().accountUsage.codex).toEqual(b.current().accountUsage.codex);
    expect(b.current().accountUsage.codex).toMatchObject({
      kind: "ready",
      snapshot: { windows: [{ usedPercent: 31 }] },
    });
    act(() => store.saveAgentAccountUsage(snapshot(Date.now() + 1, 32)));
    expect(a.current().accountUsage.codex).toEqual(b.current().accountUsage.codex);
  });

  it("rejects a poll overtaken by a live observation or shared account invalidation", () => {
    const store = gateway();
    const a = mount(store);
    const b = mount(store);
    const poll = a.current().captureUsage("codex");
    act(() => b.current().recordAccountUsage(snapshot(10, 40)));
    expect(a.current().publishRefresh(snapshot(Date.now() + 1, 20), poll)).toBe(false);
    const nextPoll = a.current().captureUsage("codex");
    act(() => b.current().invalidateAccountUsage("codex"));
    expect(a.current().accountUsage.codex).toEqual({ kind: "idle" });
    expect(a.current().publishRefresh(snapshot(Date.now() + 2, 20), nextPoll)).toBe(false);
    expect(store.loadAgentAccountUsage()).toEqual([]);
  });

  it("rejects retained gateway A callbacks after A -> B -> A and after unmount", () => {
    const a = gateway();
    const b = gateway();
    const h = mount(a);
    const old = h.current();
    const expected = old.captureUsage("codex");
    h.render(b);
    h.render(a);
    act(() => old.recordAccountUsage(snapshot(10, 30)));
    expect(old.publishRefresh(snapshot(11, 40), expected)).toBe(false);
    expect(h.current().accountUsage.codex).toEqual({ kind: "idle" });
    expect(a.loadAgentAccountUsage()).toEqual([]);
    const latest = h.current();
    h.unmount();
    act(() => latest.recordAccountUsage(snapshot(10, 30)));
    expect(latest.publishRefresh(snapshot(12, 60), latest.captureUsage("codex"))).toBe(false);
    expect(a.loadAgentAccountUsage()).toEqual([]);
  });

  it("keeps independent local storage authorities separate", () => {
    const a = mount(gateway());
    const b = mount(gateway());
    act(() => a.current().recordAccountUsage(snapshot(10, 31)));
    expect(b.current().accountUsage.codex).toEqual({ kind: "idle" });
  });

  it("replays account invalidation that occurs between initial render and subscription", () => {
    class InvalidatedAtSubscribe extends BrowserAgentAccountUsageStoreGateway {
      override subscribeAgentAccountUsage(
        listener: Parameters<BrowserAgentAccountUsageStoreGateway["subscribeAgentAccountUsage"]>[0],
      ) {
        this.invalidateAgentAccountUsage("codex");
        return super.subscribeAgentAccountUsage(listener);
      }
    }
    const values = new Map<string, string>();
    const store = new InvalidatedAtSubscribe({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value),
      removeItem: (key) => void values.delete(key),
    });
    store.saveAgentAccountUsage(snapshot(10, 80));
    const h = mount(store);
    expect(h.current().accountUsage.codex).toEqual({ kind: "idle" });
  });
});
