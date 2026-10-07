import { describe, expect, it, vi } from "vitest";
import wireContract from "../../contracts/agent-mcp-servers-wire.json";
import type { AgentMcpServersErrorKind, AgentMcpServersRequest } from "../domain/agentMcpServers";
import {
  DeferredAgentMcpServersGateway,
  agentMcpServersFixture,
} from "../test/agentMcpServersTestSupport";
import type { AgentMcpServersGateway } from "./agentMcpServersGateway";
import {
  AgentMcpServersStatusStore,
  IDLE_AGENT_MCP_SERVERS_STATE,
  MAX_AGENT_MCP_SERVERS_KEYS,
  agentMcpServersFailureKeepsSnapshot,
  agentMcpServersSnapshot,
  agentMcpServersTargetKey,
} from "./agentMcpServersStore";

const A: AgentMcpServersRequest = { repositoryRoot: "/work/a", provider: "claudeCode" };
const B: AgentMcpServersRequest = { repositoryRoot: "/work/b", provider: "claudeCode" };
const A_CODEX: AgentMcpServersRequest = { repositoryRoot: "/work/a", provider: "codex" };
const first = agentMcpServersFixture("claudeCode", [{ name: "first" }]);
const second = agentMcpServersFixture("claudeCode", [{ name: "second" }]);
const other = agentMcpServersFixture("claudeCode", [{ name: "other" }]);
const forCodex = agentMcpServersFixture("codex", [{ name: "codex-docs" }]);

function setup(maxKeys?: number) {
  const gateway = new DeferredAgentMcpServersGateway();
  const clock = { now: 1_000 };
  const store = new AgentMcpServersStatusStore(gateway, maxKeys, () => clock.now);
  const watch = (target: AgentMcpServersRequest) => {
    const published = vi.fn();
    return { published, unsubscribe: store.subscribe(target, published) };
  };
  return { clock, gateway, store, watch };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
}

function target(index: number): AgentMcpServersRequest {
  return { repositoryRoot: `/work/project-${index}`, provider: "claudeCode" };
}

describe("AgentMcpServersStatusStore", () => {
  it("stays idle and silent until a refresh is asked for", async () => {
    vi.useFakeTimers();
    try {
      const { gateway, store, watch } = setup();
      const { published } = watch(A);
      expect(store.state(A)).toBe(IDLE_AGENT_MCP_SERVERS_STATE);
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
      expect(vi.getTimerCount()).toBe(0);
      expect(gateway.requests()).toEqual([]);
      expect(published).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("publishes loading, then the checked snapshot stamped at settlement", async () => {
    const { clock, gateway, store, watch } = setup();
    const { published } = watch(A);
    store.refresh(A);
    expect(gateway.requests()).toEqual([A]);
    expect(store.state(A)).toEqual({ kind: "loading", previous: null });
    expect(published).toHaveBeenCalledTimes(1);
    clock.now = 4_000;
    gateway.checks[0]?.resolve(first);
    await settle();
    expect(store.state(A)).toEqual({
      kind: "loaded",
      snapshot: { result: first, checkedAtMs: 4_000 },
    });
    expect(published).toHaveBeenCalledTimes(2);
  });

  it("returns a stable state object between transitions", async () => {
    const { gateway, store } = setup();
    store.refresh(A);
    expect(store.state(A)).toBe(store.state(A));
    gateway.checks[0]?.resolve(first);
    await settle();
    expect(store.state(A)).toBe(store.state(A));
    expect(Object.isFrozen(store.state(A))).toBe(true);
  });

  it("runs one check per key no matter how often refresh is asked", async () => {
    const { gateway, store, watch } = setup();
    const { published } = watch(A);
    store.refresh(A);
    store.refresh(A);
    store.refresh({ ...A });
    expect(gateway.requests()).toEqual([A]);
    expect(published).toHaveBeenCalledTimes(1);
    gateway.checks[0]?.resolve(first);
    await settle();
    store.refresh(A);
    expect(gateway.requests()).toEqual([A, A]);
  });

  it("keeps showing the previous snapshot while a new check runs", async () => {
    const { clock, gateway, store } = setup();
    store.refresh(A);
    gateway.checks[0]?.resolve(first);
    await settle();
    const previous = agentMcpServersSnapshot(store.state(A));
    clock.now = 9_000;
    store.refresh(A);
    expect(store.state(A)).toEqual({ kind: "loading", previous });
    expect(previous).toEqual({ result: first, checkedAtMs: 1_000 });
    gateway.checks[1]?.resolve(second);
    await settle();
    expect(store.state(A)).toEqual({
      kind: "loaded",
      snapshot: { result: second, checkedAtMs: 9_000 },
    });
  });

  it("checks each provider of one project independently", async () => {
    const { gateway, store, watch } = setup();
    const claude = watch(A);
    const codex = watch(A_CODEX);
    store.refresh(A);
    store.refresh(A_CODEX);
    expect(gateway.requests()).toEqual([A, A_CODEX]);
    gateway.checks[0]?.reject(wireContract.errors.timedOut);
    await settle();
    expect(store.state(A)).toEqual({ kind: "failed", error: "timedOut", previous: null });
    expect(store.state(A_CODEX)).toEqual({ kind: "loading", previous: null });
    gateway.checks[1]?.resolve(forCodex);
    await settle();
    expect(agentMcpServersSnapshot(store.state(A_CODEX))?.result).toBe(forCodex);
    expect(store.state(A).kind).toBe("failed");
    expect(claude.published).toHaveBeenCalledTimes(2);
    expect(codex.published).toHaveBeenCalledTimes(2);
  });

  it("keeps projects isolated across an A to B to A switch", async () => {
    const { gateway, store, watch } = setup();
    const a = watch(A);
    store.refresh(A);
    store.refresh(B);
    gateway.checks[1]?.resolve(other);
    await settle();
    expect(store.state(B)).toEqual({
      kind: "loaded",
      snapshot: { result: other, checkedAtMs: 1_000 },
    });
    expect(store.state(A)).toEqual({ kind: "loading", previous: null });
    expect(a.published).toHaveBeenCalledTimes(1);
    store.refresh(A);
    expect(gateway.requests()).toEqual([A, B]);
    gateway.checks[0]?.resolve(first);
    await settle();
    expect(agentMcpServersSnapshot(store.state(A))?.result).toBe(first);
    expect(agentMcpServersSnapshot(store.state(B))?.result).toBe(other);
  });

  it("drops a late result of a superseded check after a newer one settled", async () => {
    const { gateway, store } = setup(1);
    store.refresh(A);
    store.refresh(B);
    expect(store.state(A)).toBe(IDLE_AGENT_MCP_SERVERS_STATE);
    store.refresh(A);
    expect(gateway.requests()).toEqual([A, B, A]);
    gateway.checks[2]?.resolve(second);
    await settle();
    gateway.checks[0]?.resolve(first);
    await settle();
    expect(store.state(A)).toEqual({
      kind: "loaded",
      snapshot: { result: second, checkedAtMs: 1_000 },
    });
  });

  it("drops a superseded check that settles while the newer one is still running", async () => {
    const { gateway, store, watch } = setup(1);
    store.refresh(A);
    store.refresh(B);
    store.refresh(A);
    const { published } = watch(A);
    gateway.checks[0]?.reject(wireContract.errors.untrustedWorkspace);
    await settle();
    expect(store.state(A)).toEqual({ kind: "loading", previous: null });
    expect(published).not.toHaveBeenCalled();
    gateway.checks[2]?.resolve(second);
    await settle();
    expect(agentMcpServersSnapshot(store.state(A))?.result).toBe(second);
  });

  it("never publishes the result of an evicted check to the key that replaced it", async () => {
    const { gateway, store } = setup(1);
    store.refresh(A);
    store.refresh(B);
    gateway.checks[0]?.resolve(first);
    await settle();
    expect(store.state(A)).toBe(IDLE_AGENT_MCP_SERVERS_STATE);
    expect(store.state(B)).toEqual({ kind: "loading", previous: null });
  });

  it.each(Object.entries(wireContract.errors) as Array<[AgentMcpServersErrorKind, string]>)(
    "reports the %s refusal as a closed error kind",
    async (kind, refusal) => {
      const { gateway, store } = setup();
      store.refresh(A);
      gateway.checks[0]?.reject(refusal);
      await settle();
      expect(store.state(A)).toEqual({ kind: "failed", error: kind, previous: null });
    },
  );

  it.each(["busy", "timedOut", "unavailable"] as const)(
    "keeps the last snapshot when a later check fails with the passing %s error",
    async (kind) => {
      const { gateway, store } = setup();
      store.refresh(A);
      gateway.checks[0]?.resolve(first);
      await settle();
      store.refresh(A);
      gateway.checks[1]?.reject(wireContract.errors[kind]);
      await settle();
      expect(agentMcpServersFailureKeepsSnapshot(kind)).toBe(true);
      expect(store.state(A)).toEqual({
        kind: "failed",
        error: kind,
        previous: { result: first, checkedAtMs: 1_000 },
      });
      store.refresh(A);
      expect(store.state(A)).toEqual({
        kind: "loading",
        previous: { result: first, checkedAtMs: 1_000 },
      });
    },
  );

  it.each(["unknownWorkspace", "untrustedWorkspace", "providerDisabled"] as const)(
    "forgets the last snapshot when the %s refusal revokes the right to show it",
    async (kind) => {
      const { gateway, store } = setup();
      store.refresh(A);
      gateway.checks[0]?.resolve(first);
      await settle();
      store.refresh(A);
      gateway.checks[1]?.reject(wireContract.errors[kind]);
      await settle();
      expect(agentMcpServersFailureKeepsSnapshot(kind)).toBe(false);
      expect(store.state(A)).toEqual({ kind: "failed", error: kind, previous: null });
    },
  );

  it("fails closed on an unrecognized rejection and on a foreign-provider answer", async () => {
    const { gateway, store } = setup();
    store.refresh(A);
    gateway.checks[0]?.reject(new TypeError("Invalid agent MCP servers at agentMcpServers."));
    await settle();
    expect(store.state(A)).toEqual({ kind: "failed", error: "unavailable", previous: null });
    store.refresh(A);
    gateway.checks[1]?.resolve(forCodex);
    await settle();
    expect(store.state(A)).toEqual({ kind: "failed", error: "unavailable", previous: null });
  });

  it("reports a gateway that throws synchronously instead of stranding the key", async () => {
    const gateway: AgentMcpServersGateway = {
      check() {
        throw wireContract.errors.providerDisabled;
      },
    };
    const store = new AgentMcpServersStatusStore(gateway);
    store.refresh(A);
    await settle();
    expect(store.state(A)).toEqual({ kind: "failed", error: "providerDisabled", previous: null });
  });

  it("lets a listener ask for the next check as soon as one settles", async () => {
    const { gateway, store } = setup();
    let asked = false;
    store.subscribe(A, () => {
      if (asked || store.state(A).kind !== "failed") return;
      asked = true;
      store.refresh(A);
    });
    store.refresh(A);
    gateway.checks[0]?.reject(wireContract.errors.busy);
    await settle();
    expect(gateway.requests()).toEqual([A, A]);
    expect(store.state(A)).toEqual({ kind: "loading", previous: null });
  });

  it("stops notifying a listener once it unsubscribes", async () => {
    const { gateway, store, watch } = setup();
    const { published, unsubscribe } = watch(A);
    store.refresh(A);
    unsubscribe();
    gateway.checks[0]?.resolve(first);
    await settle();
    expect(published).toHaveBeenCalledTimes(1);
    expect(agentMcpServersSnapshot(store.state(A))?.result).toBe(first);
  });

  it("retains a bounded number of keys and evicts the least recently refreshed", async () => {
    const { gateway, store } = setup();
    for (let index = 0; index < MAX_AGENT_MCP_SERVERS_KEYS; index += 1) {
      store.refresh(target(index));
      gateway.checks[index]?.resolve(first);
    }
    await settle();
    store.refresh(target(0));
    store.refresh(target(MAX_AGENT_MCP_SERVERS_KEYS));
    expect(store.state(target(1))).toBe(IDLE_AGENT_MCP_SERVERS_STATE);
    expect(agentMcpServersSnapshot(store.state(target(0)))?.result).toBe(first);
    expect(agentMcpServersSnapshot(store.state(target(2)))?.result).toBe(first);
    const retained = Array.from({ length: MAX_AGENT_MCP_SERVERS_KEYS + 1 }, (_, index) =>
      store.state(target(index)),
    ).filter((state) => state.kind !== "idle");
    expect(retained).toHaveLength(MAX_AGENT_MCP_SERVERS_KEYS);
  });

  it("never evicts a key that is being watched", async () => {
    const { gateway, store, watch } = setup(1);
    const { unsubscribe } = watch(A);
    store.refresh(A);
    gateway.checks[0]?.resolve(first);
    await settle();
    store.refresh(B);
    expect(agentMcpServersSnapshot(store.state(A))?.result).toBe(first);
    expect(store.state(B)).toEqual({ kind: "loading", previous: null });
    unsubscribe();
    expect(store.state(A)).toBe(IDLE_AGENT_MCP_SERVERS_STATE);
    expect(store.state(B)).toEqual({ kind: "loading", previous: null });
  });

  it("keys by the exact root and provider without separator collisions", () => {
    const keys = [
      A,
      B,
      A_CODEX,
      { repositoryRoot: "/work/a/", provider: "claudeCode" },
      { repositoryRoot: '/work/a","codex', provider: "claudeCode" },
    ].map((item) => agentMcpServersTargetKey(item as AgentMcpServersRequest));
    expect(new Set(keys).size).toBe(keys.length);
    expect(agentMcpServersTargetKey({ ...A })).toBe(agentMcpServersTargetKey(A));
  });
});
