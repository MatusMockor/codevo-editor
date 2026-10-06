import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentCommandCatalogLocalTarget,
  AgentCommandCatalogServerTarget,
  AgentCommandCatalogTarget,
} from "../domain/agentCommandCatalogTarget";
import {
  DeferredAgentCommandCatalogGateway,
  DeferredRemoteCommandCatalogGateway,
  agentCommandCatalogFixture,
} from "../test/agentCommandCatalogTestSupport";
import { agentCommandCatalogSource } from "./agentCommandCatalogGateway";
import {
  AGENT_COMMAND_CATALOG_READ_TIMEOUT_MS,
  AGENT_COMMAND_CATALOG_RETRY_DELAYS_MS,
  AGENT_COMMAND_CATALOG_TTL_MS,
  AgentCommandCatalogCache,
  MAX_AGENT_COMMAND_CATALOG_KEYS,
} from "./agentCommandCatalogStore";

const SERVER_ONE = "3f2b8c1e-5a47-4d09-9c3e-7b1a2d4e6f80";
const SERVER_TWO = "9a1c2b3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";

function local(repositoryRoot: string, provider: "claudeCode" | "codex" = "claudeCode") {
  return { kind: "local", repositoryRoot, provider } satisfies AgentCommandCatalogLocalTarget;
}

function server(
  serverId: string,
  runnerId: string,
  projectId: string,
  provider: "claudeCode" | "codex" = "claudeCode",
) {
  return {
    kind: "server",
    serverId,
    runnerId,
    projectId,
    provider,
  } satisfies AgentCommandCatalogServerTarget;
}

function wire({ repositoryRoot, provider }: AgentCommandCatalogLocalTarget) {
  return { repositoryRoot, provider };
}

const A = local("/work/a");
const B = local("/work/b");
const A_CODEX = local("/work/a", "codex");
const REMOTE = server(SERVER_ONE, "runner-home", "codevo-editor");
const first = agentCommandCatalogFixture("claudeCode", [{ name: "first" }]);
const second = agentCommandCatalogFixture("claudeCode", [{ name: "second" }]);
const other = agentCommandCatalogFixture("claudeCode", [{ name: "other" }]);
const skills = agentCommandCatalogFixture("codex", [{ name: "skill" }]);
const [FIRST_RETRY, SECOND_RETRY, THIRD_RETRY, LAST_RETRY] = AGENT_COMMAND_CATALOG_RETRY_DELAYS_MS;

function setup(maxKeys?: number, withRemote = true) {
  const gateway = new DeferredAgentCommandCatalogGateway();
  const remote = new DeferredRemoteCommandCatalogGateway();
  const store = new AgentCommandCatalogCache(
    agentCommandCatalogSource(gateway, withRemote ? remote : null),
    maxKeys,
  );
  const watch = (target: AgentCommandCatalogTarget) => {
    const published = vi.fn();
    return { published, unsubscribe: store.subscribe(target, published) };
  };
  return { gateway, remote, store, watch };
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("AgentCommandCatalogCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers repeat requests for a fresh key from the cache", async () => {
    const { gateway, store, watch } = setup();
    const { published } = watch(A);
    expect(store.snapshot(A)).toBeNull();
    store.refresh(A);
    expect(gateway.requests()).toEqual([wire(A)]);
    gateway.reads[0]?.resolve(first);
    await settle();
    expect(store.snapshot(A)).toBe(first);
    expect(published).toHaveBeenCalledTimes(1);
    store.refresh(A);
    store.refresh({ ...A });
    await settle();
    expect(gateway.reads).toHaveLength(1);
    expect(store.snapshot({ ...A })).toBe(first);
  });

  it("revalidates only once the entry is older than the TTL and serves it meanwhile", async () => {
    const { gateway, store, watch } = setup();
    const { published } = watch(A);
    store.refresh(A);
    gateway.reads[0]?.resolve(first);
    await settle();
    vi.advanceTimersByTime(AGENT_COMMAND_CATALOG_TTL_MS - 1);
    store.refresh(A);
    expect(gateway.reads).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(gateway.reads).toHaveLength(1);
    store.refresh(A);
    expect(gateway.reads).toHaveLength(2);
    expect(store.snapshot(A)).toBe(first);
    gateway.reads[1]?.resolve(second);
    await settle();
    expect(store.snapshot(A)).toBe(second);
    expect(published).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent requests for one key into a single read", async () => {
    const { gateway, store } = setup();
    store.refresh(A);
    store.refresh(A);
    store.refresh(A);
    vi.advanceTimersByTime(AGENT_COMMAND_CATALOG_READ_TIMEOUT_MS - 1);
    store.refresh(A);
    expect(gateway.reads).toHaveLength(1);
    gateway.reads[0]?.resolve(first);
    await settle();
    expect(store.snapshot(A)).toBe(first);
  });

  it("keeps the last good catalog when a refresh fails", async () => {
    const { gateway, store, watch } = setup();
    const { published } = watch(A);
    store.refresh(A);
    gateway.reads[0]?.resolve(first);
    await settle();
    vi.advanceTimersByTime(AGENT_COMMAND_CATALOG_TTL_MS);
    store.refresh(A);
    gateway.reads[1]?.reject("probe failed");
    await settle();
    expect(store.snapshot(A)).toBe(first);
    expect(published).toHaveBeenCalledTimes(1);
  });

  it("stays empty and silent when the first read fails", async () => {
    const { gateway, store, watch } = setup();
    const { published } = watch(A);
    store.refresh(A);
    gateway.reads[0]?.reject(new TypeError("Invalid agent command catalog."));
    await settle();
    expect(store.snapshot(A)).toBeNull();
    expect(published).not.toHaveBeenCalled();
  });

  it("treats a gateway that answers with nothing as a failed read", async () => {
    const read = vi.fn(() => Promise.resolve(undefined as never));
    const store = new AgentCommandCatalogCache(agentCommandCatalogSource({ read }, null));
    store.refresh(A);
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    expect(store.snapshot(A)).toBeNull();
    store.refresh(A);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("rejects an answer for a different provider than the one requested", async () => {
    const { gateway, store, watch } = setup();
    const { published } = watch(A);
    store.refresh(A);
    gateway.reads[0]?.resolve(skills);
    await settle();
    expect(store.snapshot(A)).toBeNull();
    expect(published).not.toHaveBeenCalled();
  });

  it("stores out-of-order results under the workspace that asked, across A, B, A", async () => {
    const { gateway, store } = setup();
    store.refresh(A);
    store.refresh(B);
    store.refresh(A);
    expect(gateway.requests()).toEqual([wire(A), wire(B)]);
    gateway.reads[1]?.resolve(other);
    await settle();
    expect(store.snapshot(B)).toBe(other);
    expect(store.snapshot(A)).toBeNull();
    gateway.reads[0]?.resolve(first);
    await settle();
    expect(store.snapshot(A)).toBe(first);
    expect(store.snapshot(B)).toBe(other);
  });

  it("isolates providers that share one workspace root", async () => {
    const { gateway, store } = setup();
    store.refresh(A);
    store.refresh(A_CODEX);
    expect(gateway.requests()).toEqual([wire(A), wire(A_CODEX)]);
    gateway.reads[1]?.resolve(skills);
    await settle();
    expect(store.snapshot(A)).toBeNull();
    expect(store.snapshot(A_CODEX)).toBe(skills);
    gateway.reads[0]?.resolve(first);
    await settle();
    expect(store.snapshot(A)).toBe(first);
    expect(store.snapshot(A_CODEX)).toBe(skills);
  });

  it("never lets a superseded read overwrite the newer result, in either order", async () => {
    const lateOld = setup();
    const { published } = lateOld.watch(A);
    lateOld.store.refresh(A);
    vi.advanceTimersByTime(AGENT_COMMAND_CATALOG_READ_TIMEOUT_MS);
    lateOld.store.refresh(B);
    lateOld.store.refresh(A);
    expect(lateOld.gateway.requests()).toEqual([wire(A), wire(B), wire(A)]);
    lateOld.gateway.reads[2]?.resolve(second);
    await settle();
    lateOld.gateway.reads[0]?.resolve(first);
    await settle();
    expect(lateOld.store.snapshot(A)).toBe(second);
    expect(published).toHaveBeenCalledTimes(1);

    const earlyOld = setup();
    earlyOld.store.refresh(A);
    vi.advanceTimersByTime(AGENT_COMMAND_CATALOG_READ_TIMEOUT_MS);
    earlyOld.store.refresh(A);
    earlyOld.gateway.reads[0]?.resolve(first);
    await settle();
    expect(earlyOld.store.snapshot(A)).toBeNull();
    earlyOld.gateway.reads[1]?.resolve(second);
    await settle();
    expect(earlyOld.store.snapshot(A)).toBe(second);
  });

  it("does not let a superseded failure mark the newer read as failed", async () => {
    const { gateway, store, watch } = setup();
    watch(A);
    store.refresh(A);
    vi.advanceTimersByTime(AGENT_COMMAND_CATALOG_READ_TIMEOUT_MS);
    store.refresh(A);
    gateway.reads[0]?.reject("stale failure");
    await settle();
    await vi.advanceTimersByTimeAsync(LAST_RETRY);
    expect(gateway.reads).toHaveLength(2);
    gateway.reads[1]?.resolve(first);
    await settle();
    expect(store.snapshot(A)).toBe(first);
  });

  it("evicts the least recently requested key first", async () => {
    const { gateway, store } = setup(2);
    const C = local("/work/c");
    store.refresh(A);
    store.refresh(B);
    gateway.reads[1]?.resolve(other);
    await settle();
    store.refresh(A);
    store.refresh(C);
    expect(store.snapshot(B)).toBeNull();
    gateway.reads[0]?.resolve(first);
    await settle();
    expect(store.snapshot(A)).toBe(first);
    store.refresh(B);
    expect(gateway.requests()).toEqual([wire(A), wire(B), wire(C), wire(B)]);
    expect(store.snapshot(A)).toBeNull();
    gateway.reads[2]?.resolve(second);
    await settle();
    expect(store.snapshot(C)).toBe(second);
  });

  it("drops a read whose key was evicted and requested again before it settled", async () => {
    const { gateway, store, watch } = setup(1);
    store.refresh(A);
    store.refresh(B);
    const { published } = watch(A);
    store.refresh(A);
    expect(gateway.requests()).toEqual([wire(A), wire(B), wire(A)]);
    gateway.reads[0]?.resolve(first);
    await settle();
    expect(store.snapshot(A)).toBeNull();
    expect(published).not.toHaveBeenCalled();
    gateway.reads[2]?.resolve(second);
    await settle();
    expect(store.snapshot(A)).toBe(second);
    expect(published).toHaveBeenCalledTimes(1);
  });

  it("retains at most the configured number of targets nobody watches", async () => {
    const { gateway, store } = setup();
    const targets = Array.from({ length: MAX_AGENT_COMMAND_CATALOG_KEYS + 1 }, (_, index) =>
      local(`/work/${index}`),
    );
    targets.forEach((target) => store.refresh(target));
    gateway.reads.forEach((read) => read.resolve(first));
    await settle();
    expect(MAX_AGENT_COMMAND_CATALOG_KEYS).toBe(16);
    expect(targets.map((target) => store.snapshot(target) !== null)).toEqual([
      false,
      ...targets.slice(1).map(() => true),
    ]);
  });

  it("keeps a loaded, watched target when 16 other targets are refreshed", async () => {
    const { gateway, store, watch } = setup();
    const { published } = watch(A);
    store.refresh(A);
    gateway.reads[0]?.resolve(first);
    await settle();
    const others = Array.from({ length: MAX_AGENT_COMMAND_CATALOG_KEYS }, (_, index) =>
      local(`/work/other-${index}`),
    );
    others.forEach((target) => store.refresh(target));
    gateway.reads.slice(1).forEach((read) => read.resolve(other));
    await settle();
    expect(store.snapshot(A)).toBe(first);
    expect(published).toHaveBeenCalledTimes(1);
    store.refresh(A);
    expect(gateway.reads).toHaveLength(1 + MAX_AGENT_COMMAND_CATALOG_KEYS);
    expect(others.map((target) => store.snapshot(target) !== null)).toEqual([
      false,
      ...others.slice(1).map(() => true),
    ]);
  });

  it("keeps a watched target's pending read when other targets push past the cap", async () => {
    const { gateway, store, watch } = setup(1);
    const { published } = watch(A);
    store.refresh(A);
    store.refresh(B);
    store.refresh(local("/work/c"));
    store.refresh(A);
    expect(gateway.requests()).toEqual([wire(A), wire(B), wire(local("/work/c"))]);
    gateway.reads[0]?.resolve(first);
    gateway.reads[1]?.resolve(other);
    await settle();
    expect(store.snapshot(A)).toBe(first);
    expect(published).toHaveBeenCalledTimes(1);
    expect(store.snapshot(B)).toBeNull();
  });

  it("holds the watched targets plus the newest request when more than the cap are watched", async () => {
    const { gateway, store, watch } = setup(2);
    const watched = [A, B, local("/work/c")];
    const subscriptions = watched.map((target) => watch(target));
    watched.forEach((target) => store.refresh(target));
    const transient = [local("/work/x"), local("/work/y"), local("/work/z")];
    transient.forEach((target) => store.refresh(target));
    gateway.reads.forEach((read) => read.resolve(first));
    await settle();
    expect(watched.map((target) => store.snapshot(target))).toEqual([first, first, first]);
    expect(transient.map((target) => store.snapshot(target))).toEqual([null, null, first]);

    subscriptions[0]?.unsubscribe();
    expect([...watched, ...transient].filter((target) => store.snapshot(target) !== null)).toEqual([
      B,
      local("/work/c"),
    ]);
    subscriptions[1]?.unsubscribe();
    subscriptions[2]?.unsubscribe();
    expect([...watched, ...transient].filter((target) => store.snapshot(target) !== null)).toEqual([
      B,
      local("/work/c"),
    ]);
    store.refresh(A);
    expect([...watched, ...transient].filter((target) => store.snapshot(target) !== null)).toEqual([
      local("/work/c"),
    ]);
  });

  it("keeps the snapshot identity and stays quiet when a refresh returns the same content", async () => {
    const { gateway, store, watch } = setup();
    const { published } = watch(A);
    store.refresh(A);
    gateway.reads[0]?.resolve(first);
    await settle();
    vi.advanceTimersByTime(AGENT_COMMAND_CATALOG_TTL_MS);
    store.refresh(A);
    gateway.reads[1]?.resolve(agentCommandCatalogFixture("claudeCode", [{ name: "first" }]));
    await settle();
    expect(store.snapshot(A)).toBe(first);
    expect(published).toHaveBeenCalledTimes(1);
    store.refresh(A);
    expect(gateway.reads).toHaveLength(2);
  });

  it("notifies only the watchers of the target that changed", async () => {
    const { gateway, store, watch } = setup();
    const onA = watch(A);
    const onB = watch(B);
    const left = watch(A);
    left.unsubscribe();
    left.unsubscribe();
    store.refresh(A);
    gateway.reads[0]?.resolve(first);
    await settle();
    expect(onA.published).toHaveBeenCalledTimes(1);
    expect(onB.published).not.toHaveBeenCalled();
    expect(left.published).not.toHaveBeenCalled();
  });

  it("refreshes rather than trusting an entry stamped in the future", async () => {
    const { gateway, store } = setup();
    vi.setSystemTime(1_000_000);
    store.refresh(A);
    gateway.reads[0]?.resolve(first);
    await settle();
    vi.setSystemTime(500_000);
    store.refresh(A);
    expect(gateway.reads).toHaveLength(2);
  });
});

describe("AgentCommandCatalogCache failed-read retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function fail(gateway: DeferredAgentCommandCatalogGateway): Promise<void> {
    gateway.reads[gateway.reads.length - 1]?.reject("Agent command catalog is still loading.");
    await settle();
  }

  it("retries a watched target quickly, backs off, and stops after a bounded number of attempts", async () => {
    const { gateway, store, watch } = setup();
    watch(A);
    store.refresh(A);
    await fail(gateway);
    expect([FIRST_RETRY, SECOND_RETRY, THIRD_RETRY, LAST_RETRY]).toEqual([
      1_500, 3_000, 6_000, 10_000,
    ]);
    await vi.advanceTimersByTimeAsync(FIRST_RETRY - 1);
    expect(gateway.reads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(gateway.reads).toHaveLength(2);
    await fail(gateway);
    await vi.advanceTimersByTimeAsync(SECOND_RETRY - 1);
    expect(gateway.reads).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(gateway.reads).toHaveLength(3);
    await fail(gateway);
    await vi.advanceTimersByTimeAsync(THIRD_RETRY);
    expect(gateway.reads).toHaveLength(4);
    await fail(gateway);
    await vi.advanceTimersByTimeAsync(LAST_RETRY);
    expect(gateway.reads).toHaveLength(5);
    await fail(gateway);
    await vi.advanceTimersByTimeAsync(AGENT_COMMAND_CATALOG_TTL_MS * 10);
    expect(gateway.reads).toHaveLength(5);
    expect(vi.getTimerCount()).toBe(0);
    store.refresh(A);
    expect(gateway.reads).toHaveLength(6);
  });

  it("shows the catalog as soon as a quick retry succeeds and starts the backoff over", async () => {
    const { gateway, store, watch } = setup();
    const { published } = watch(A);
    store.refresh(A);
    await fail(gateway);
    await vi.advanceTimersByTimeAsync(FIRST_RETRY);
    gateway.reads[1]?.resolve(first);
    await settle();
    expect(store.snapshot(A)).toBe(first);
    expect(published).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(AGENT_COMMAND_CATALOG_TTL_MS);
    store.refresh(A);
    await fail(gateway);
    await vi.advanceTimersByTimeAsync(FIRST_RETRY);
    expect(gateway.reads).toHaveLength(4);
    expect(store.snapshot(A)).toBe(first);
  });

  it("gates manual refreshes of a failed target on the same backoff", async () => {
    const { gateway, store } = setup();
    store.refresh(A);
    await fail(gateway);
    vi.advanceTimersByTime(FIRST_RETRY - 1);
    store.refresh(A);
    expect(gateway.reads).toHaveLength(1);
    vi.advanceTimersByTime(1);
    store.refresh(A);
    expect(gateway.reads).toHaveLength(2);
    await fail(gateway);
    vi.advanceTimersByTime(SECOND_RETRY - 1);
    store.refresh(A);
    expect(gateway.reads).toHaveLength(2);
  });

  it("never retries on its own while nobody watches the target", async () => {
    const { gateway, store } = setup();
    store.refresh(A);
    await fail(gateway);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(AGENT_COMMAND_CATALOG_TTL_MS);
    expect(gateway.reads).toHaveLength(1);
  });

  it("cancels the pending retry when the last watcher leaves", async () => {
    const { gateway, store, watch } = setup();
    const one = watch(A);
    const two = watch(A);
    store.refresh(A);
    await fail(gateway);
    expect(vi.getTimerCount()).toBe(1);
    one.unsubscribe();
    expect(vi.getTimerCount()).toBe(1);
    two.unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(LAST_RETRY);
    expect(gateway.reads).toHaveLength(1);
  });

  it("resumes the retry for a watcher that arrives after an unwatched failure", async () => {
    const { gateway, store, watch } = setup();
    store.refresh(A);
    await fail(gateway);
    vi.advanceTimersByTime(500);
    watch(A);
    store.refresh(A);
    store.refresh(A);
    expect(gateway.reads).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(FIRST_RETRY - 500 - 1);
    expect(gateway.reads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(gateway.reads).toHaveLength(2);
  });

  it("keeps an independent retry per watched target even past the cap", async () => {
    const { gateway, store, watch } = setup(1);
    watch(A);
    watch(B);
    store.refresh(A);
    await fail(gateway);
    expect(vi.getTimerCount()).toBe(1);
    store.refresh(B);
    await fail(gateway);
    expect(vi.getTimerCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(FIRST_RETRY);
    expect(gateway.requests()).toEqual([wire(A), wire(B), wire(A), wire(B)]);
  });

  it("leaves no retry behind for a target that lost its watcher and was then evicted", async () => {
    const { gateway, store, watch } = setup(1);
    const { unsubscribe } = watch(A);
    store.refresh(A);
    await fail(gateway);
    unsubscribe();
    store.refresh(B);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(AGENT_COMMAND_CATALOG_TTL_MS);
    expect(gateway.requests()).toEqual([wire(A), wire(B)]);
  });

  it("retries a busy server runner on the same schedule", async () => {
    const { remote, store, watch } = setup();
    watch(REMOTE);
    store.refresh(REMOTE);
    remote.reads[0]?.reject("Runner request failed (HTTP 503).");
    await settle();
    await vi.advanceTimersByTimeAsync(FIRST_RETRY);
    expect(remote.reads).toHaveLength(2);
    remote.reads[1]?.resolve(first);
    await settle();
    expect(store.snapshot(REMOTE)).toBe(first);
  });
});

describe("AgentCommandCatalogCache server targets", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads a server target from the runner with the runner's provider name", async () => {
    const { gateway, remote, store, watch } = setup();
    const { published } = watch(REMOTE);
    const codexTarget = server(SERVER_ONE, "runner-home", "codevo-editor", "codex");
    store.refresh(REMOTE);
    store.refresh(codexTarget);
    expect(remote.requests()).toEqual([
      {
        serverId: SERVER_ONE,
        runnerId: "runner-home",
        projectId: "codevo-editor",
        provider: "claude",
      },
      {
        serverId: SERVER_ONE,
        runnerId: "runner-home",
        projectId: "codevo-editor",
        provider: "codex",
      },
    ]);
    expect(gateway.reads).toHaveLength(0);
    remote.reads[0]?.resolve(first);
    remote.reads[1]?.resolve(skills);
    await settle();
    expect(store.snapshot(REMOTE)).toBe(first);
    expect(store.snapshot(codexTarget)).toBe(skills);
    expect(published).toHaveBeenCalledTimes(1);
  });

  it("never shares an entry between servers, runner identities or projects", async () => {
    const { remote, store } = setup();
    const otherServer = server(SERVER_TWO, "runner-home", "codevo-editor");
    const otherRunner = server(SERVER_ONE, "runner-replaced", "codevo-editor");
    const otherProject = server(SERVER_ONE, "runner-home", "codevo-runner");
    const targets = [REMOTE, otherServer, otherRunner, otherProject];
    targets.forEach((target) => store.refresh(target));
    expect(remote.reads).toHaveLength(4);
    remote.reads[2]?.resolve(other);
    await settle();
    expect(targets.map((target) => store.snapshot(target))).toEqual([null, null, other, null]);
    remote.reads[0]?.resolve(first);
    remote.reads[1]?.resolve(second);
    await settle();
    expect(targets.map((target) => store.snapshot(target))).toEqual([first, second, other, null]);
  });

  it("keeps a local workspace and a server project apart even when their names coincide", async () => {
    const { gateway, remote, store } = setup();
    const lookalike = local(`/${SERVER_ONE}/runner-home/codevo-editor`);
    const hostile = local(JSON.stringify(["server", "claudeCode", SERVER_ONE, "runner-home", "x"]));
    store.refresh(lookalike);
    store.refresh(REMOTE);
    store.refresh(hostile);
    expect(gateway.reads).toHaveLength(2);
    expect(remote.reads).toHaveLength(1);
    remote.reads[0]?.resolve(first);
    await settle();
    expect(store.snapshot(REMOTE)).toBe(first);
    expect(store.snapshot(lookalike)).toBeNull();
    expect(store.snapshot(hostile)).toBeNull();
    gateway.reads[0]?.resolve(second);
    await settle();
    expect(store.snapshot(lookalike)).toBe(second);
    expect(store.snapshot(REMOTE)).toBe(first);
  });

  it("stores out-of-order results under the target that asked across a local and server switch", async () => {
    const { gateway, remote, store } = setup();
    store.refresh(A);
    store.refresh(REMOTE);
    store.refresh(A);
    remote.reads[0]?.resolve(other);
    await settle();
    expect(store.snapshot(A)).toBeNull();
    gateway.reads[0]?.resolve(first);
    await settle();
    expect(store.snapshot(A)).toBe(first);
    expect(store.snapshot(REMOTE)).toBe(other);
  });

  it("keeps the last good runner catalog when the runner answers for the wrong provider", async () => {
    const { remote, store } = setup();
    store.refresh(REMOTE);
    remote.reads[0]?.resolve(first);
    await settle();
    vi.advanceTimersByTime(AGENT_COMMAND_CATALOG_TTL_MS);
    store.refresh(REMOTE);
    remote.reads[1]?.resolve(skills);
    await settle();
    expect(store.snapshot(REMOTE)).toBe(first);
  });

  it("fails closed, with bounded retries, when no runner gateway is wired", async () => {
    const { gateway, remote, store, watch } = setup(undefined, false);
    watch(REMOTE);
    store.refresh(REMOTE);
    await vi.advanceTimersByTimeAsync(AGENT_COMMAND_CATALOG_TTL_MS * 10);
    expect(store.snapshot(REMOTE)).toBeNull();
    expect(remote.reads).toHaveLength(0);
    expect(gateway.reads).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
