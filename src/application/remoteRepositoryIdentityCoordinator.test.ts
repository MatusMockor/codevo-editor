import type { invoke } from "@tauri-apps/api/core";
import { describe, expect, it } from "vitest";
import { TauriRemoteRepositoryIdentityGateway } from "../infrastructure/tauriRemoteRepositoryIdentityGateway";
import {
  deferred,
  manualIdentityTimers,
  recordingRemoteIdentityGateway,
} from "../test/repositoryIdentityTestSupport";
import {
  MAX_REMOTE_REPOSITORY_IDENTITY_CACHE,
  MAX_REMOTE_REPOSITORY_IDENTITY_CONCURRENCY,
  MAX_REMOTE_REPOSITORY_IDENTITY_QUEUE,
  MAX_REMOTE_REPOSITORY_IDENTITY_SERVERS,
  REMOTE_REPOSITORY_IDENTITY_CACHE_TTL_MS,
  REMOTE_REPOSITORY_IDENTITY_TIMEOUT_MS,
  RemoteRepositoryIdentityCoordinator,
} from "./remoteRepositoryIdentityCoordinator";

const request = (projectId: string, serverId = "linux") => ({
  serverId,
  runnerId: "runner",
  projectId,
});
const settle = async () => {
  for (let round = 0; round < 10; round += 1) await Promise.resolve();
};
const outcomeOf = (lookup: Promise<string | null>) =>
  lookup.then(
    (value) => ({ kind: "resolved" as const, value }),
    () => ({ kind: "rejected" as const }),
  );

describe("remote repository identity coordinator", () => {
  it("never runs more than two lookups per server and still completes every request", async () => {
    const holds = new Map<string, ReturnType<typeof deferred<string | null>>>();
    const recorded = recordingRemoteIdentityGateway((incoming) => {
      const hold = deferred<string | null>();
      holds.set(incoming.projectId, hold);
      return hold.promise;
    });
    const coordinator = new RemoteRepositoryIdentityCoordinator(recorded.gateway);
    const lookups = Array.from({ length: 6 }, (_, index) =>
      coordinator.discover(request(`project${index}`)),
    );
    expect(recorded.requests).toHaveLength(2);
    for (let index = 0; index < 6; index += 1) {
      expect(recorded.active("linux")).toBeLessThanOrEqual(2);
      holds.get(`project${index}`)!.resolve(`github.com/acme/repo${index}`);
      await settle();
    }
    expect(await Promise.all(lookups)).toEqual(
      Array.from({ length: 6 }, (_, index) => `github.com/acme/repo${index}`),
    );
    expect(recorded.maximumPerServer()).toBe(2);
    expect(recorded.requests).toHaveLength(6);
  });

  it("keeps a hung server from consuming another server's permits or queue", async () => {
    const clock = manualIdentityTimers();
    const recorded = recordingRemoteIdentityGateway((incoming) =>
      incoming.serverId === "slow"
        ? new Promise<string | null>(() => undefined)
        : Promise.resolve("github.com/acme/editor"),
    );
    const coordinator = new RemoteRepositoryIdentityCoordinator(recorded.gateway, clock.timers);
    const capacity =
      MAX_REMOTE_REPOSITORY_IDENTITY_CONCURRENCY + MAX_REMOTE_REPOSITORY_IDENTITY_QUEUE;
    for (let index = 0; index < capacity; index += 1)
      void outcomeOf(coordinator.discover(request(`project${index}`, "slow")));
    expect(await outcomeOf(coordinator.discover(request("overflow", "slow")))).toEqual({
      kind: "rejected",
    });
    expect(await coordinator.discover(request("one", "fast"))).toBe("github.com/acme/editor");
    expect(recorded.active("slow")).toBe(2);
    expect(recorded.maximumPerServer()).toBe(2);
    expect(recorded.requests.filter((sent) => sent.serverId === "slow")).toHaveLength(2);
  });

  it("refuses to track more servers than its bound", async () => {
    const clock = manualIdentityTimers();
    const recorded = recordingRemoteIdentityGateway(
      () => new Promise<string | null>(() => undefined),
    );
    const coordinator = new RemoteRepositoryIdentityCoordinator(recorded.gateway, clock.timers);
    for (let index = 0; index < MAX_REMOTE_REPOSITORY_IDENTITY_SERVERS; index += 1)
      void outcomeOf(coordinator.discover(request("project", `server${index}`)));
    expect(await outcomeOf(coordinator.discover(request("project", "one-too-many")))).toEqual({
      kind: "rejected",
    });
    expect(recorded.requests).toHaveLength(MAX_REMOTE_REPOSITORY_IDENTITY_SERVERS);
  });

  it("times out a lookup that never settles and frees its permit", async () => {
    const clock = manualIdentityTimers();
    const recorded = recordingRemoteIdentityGateway((incoming) =>
      incoming.projectId.startsWith("hung")
        ? new Promise<string | null>(() => undefined)
        : Promise.resolve("github.com/acme/ok"),
    );
    const coordinator = new RemoteRepositoryIdentityCoordinator(recorded.gateway, clock.timers);
    const first = outcomeOf(coordinator.discover(request("hung1")));
    const second = outcomeOf(coordinator.discover(request("hung2")));
    const queued = coordinator.discover(request("ok"));
    await settle();
    expect(recorded.requests).toHaveLength(2);
    clock.advance(REMOTE_REPOSITORY_IDENTITY_TIMEOUT_MS - 1);
    await settle();
    expect(recorded.requests).toHaveLength(2);
    clock.advance(1);
    expect(await first).toEqual({ kind: "rejected" });
    expect(await second).toEqual({ kind: "rejected" });
    expect(await queued).toBe("github.com/acme/ok");
    expect(clock.pendingCount()).toBe(0);
    void outcomeOf(coordinator.discover(request("hung1")));
    expect(recorded.requests.filter((sent) => sent.projectId === "hung1")).toHaveLength(2);
  });

  it("keeps a successful answer that arrives after its timeout for the next request", async () => {
    const clock = manualIdentityTimers();
    const slow = deferred<string | null>();
    const recorded = recordingRemoteIdentityGateway(() => slow.promise);
    const coordinator = new RemoteRepositoryIdentityCoordinator(recorded.gateway, clock.timers);
    const waiter = outcomeOf(coordinator.discover(request("slow")));
    clock.advance(REMOTE_REPOSITORY_IDENTITY_TIMEOUT_MS);
    expect(await waiter).toEqual({ kind: "rejected" });
    clock.advance(1_000);
    slow.resolve("github.com/acme/slow");
    await settle();
    expect(await coordinator.discover(request("slow"))).toBe("github.com/acme/slow");
    expect(recorded.requests).toHaveLength(1);
    clock.advance(REMOTE_REPOSITORY_IDENTITY_CACHE_TTL_MS);
    void outcomeOf(coordinator.discover(request("slow")));
    expect(recorded.requests).toHaveLength(2);
  });

  it("never serves a late cached answer to a request for a different runner", async () => {
    const clock = manualIdentityTimers();
    const slow = deferred<string | null>();
    const recorded = recordingRemoteIdentityGateway((incoming) =>
      incoming.runnerId === "runner" ? slow.promise : Promise.resolve("github.com/acme/other"),
    );
    const coordinator = new RemoteRepositoryIdentityCoordinator(recorded.gateway, clock.timers);
    const waiter = outcomeOf(coordinator.discover(request("slow")));
    clock.advance(REMOTE_REPOSITORY_IDENTITY_TIMEOUT_MS);
    expect(await waiter).toEqual({ kind: "rejected" });
    slow.resolve("github.com/acme/slow");
    await settle();
    const replaced = { ...request("slow"), runnerId: "replacement-runner" };
    expect(await coordinator.discover(replaced)).toBe("github.com/acme/other");
    expect(recorded.requests).toEqual([request("slow"), replaced]);
    expect(await coordinator.discover(request("slow"))).toBe("github.com/acme/slow");
    expect(recorded.requests).toHaveLength(2);
  });

  it("does not let a late answer replace a fresher one or cache a late failure", async () => {
    const clock = manualIdentityTimers();
    const slow = deferred<string | null>();
    const failing = deferred<string | null>();
    const recorded = recordingRemoteIdentityGateway((incoming, call) => {
      if (incoming.projectId === "failing") return failing.promise;
      return call === 1 ? slow.promise : Promise.resolve("github.com/acme/fresh");
    });
    const coordinator = new RemoteRepositoryIdentityCoordinator(recorded.gateway, clock.timers);
    const slowWaiter = outcomeOf(coordinator.discover(request("slow")));
    const failingWaiter = outcomeOf(coordinator.discover(request("failing")));
    clock.advance(REMOTE_REPOSITORY_IDENTITY_TIMEOUT_MS);
    expect(await slowWaiter).toEqual({ kind: "rejected" });
    expect(await failingWaiter).toEqual({ kind: "rejected" });
    expect(await coordinator.discover(request("slow"))).toBe("github.com/acme/fresh");
    slow.resolve("github.com/acme/late");
    failing.reject(new Error("offline"));
    await settle();
    expect(await coordinator.discover(request("slow"))).toBe("github.com/acme/fresh");
    const requestsBefore = recorded.requests.length;
    void outcomeOf(coordinator.discover(request("failing")));
    expect(recorded.requests).toHaveLength(requestsBefore + 1);
    expect(recorded.active("linux")).toBe(1);
  });

  it("shares one in-flight request between identical lookups and then shares its result", async () => {
    const hold = deferred<string | null>();
    const recorded = recordingRemoteIdentityGateway(() => hold.promise);
    const coordinator = new RemoteRepositoryIdentityCoordinator(recorded.gateway);
    const first = coordinator.discover(request("editor"));
    const second = coordinator.discover({ ...request("editor") });
    expect(recorded.requests).toHaveLength(1);
    hold.resolve("github.com/acme/editor");
    expect(await Promise.all([first, second])).toEqual([
      "github.com/acme/editor",
      "github.com/acme/editor",
    ]);
    expect(await coordinator.discover(request("editor"))).toBe("github.com/acme/editor");
    expect(recorded.requests).toHaveLength(1);
  });

  it("passes the gateway an exact request without foreign fields", async () => {
    const recorded = recordingRemoteIdentityGateway(() => Promise.resolve(null));
    const coordinator = new RemoteRepositoryIdentityCoordinator(recorded.gateway);
    const widened = { ...request("editor"), token: "secret" };
    expect(await coordinator.discover(widened)).toBeNull();
    expect(recorded.requests).toEqual([request("editor")]);
  });

  it("delivers a rejection to every sharer and never caches it", async () => {
    const recorded = recordingRemoteIdentityGateway((_, call) =>
      call === 1 ? Promise.reject(new Error("busy")) : Promise.resolve("github.com/acme/editor"),
    );
    const coordinator = new RemoteRepositoryIdentityCoordinator(recorded.gateway);
    const outcomes = await Promise.all([
      outcomeOf(coordinator.discover(request("editor"))),
      outcomeOf(coordinator.discover(request("editor"))),
    ]);
    expect(outcomes).toEqual([{ kind: "rejected" }, { kind: "rejected" }]);
    expect(recorded.requests).toHaveLength(1);
    expect(await coordinator.discover(request("editor"))).toBe("github.com/acme/editor");
    expect(recorded.requests).toHaveLength(2);
    expect(recorded.active("linux")).toBe(0);
  });

  it("releases the permit when the real gateway refuses a malformed request", async () => {
    const invoked: unknown[] = [];
    const gateway = new TauriRemoteRepositoryIdentityGateway((async (
      _command: string,
      args: unknown,
    ) => {
      invoked.push(args);
      return { repositoryKey: "github.com/acme/editor" };
    }) as typeof invoke);
    const coordinator = new RemoteRepositoryIdentityCoordinator(gateway);
    expect(await outcomeOf(coordinator.discover(request("not valid")))).toEqual({
      kind: "rejected",
    });
    expect(await outcomeOf(coordinator.discover(request("also not valid")))).toEqual({
      kind: "rejected",
    });
    expect(invoked).toEqual([]);
    expect(await coordinator.discover(request("editor"))).toBe("github.com/acme/editor");
    expect(await coordinator.discover(request("other"))).toBe("github.com/acme/editor");
    expect(invoked).toEqual([{ request: request("editor") }, { request: request("other") }]);
  });

  it("caches a missing origin separately from a failure", async () => {
    const recorded = recordingRemoteIdentityGateway(() => Promise.resolve(null));
    const coordinator = new RemoteRepositoryIdentityCoordinator(recorded.gateway);
    expect(await coordinator.discover(request("editor"))).toBeNull();
    expect(await coordinator.discover(request("editor"))).toBeNull();
    expect(recorded.requests).toHaveLength(1);
  });

  it("re-reads a result once it is older than the freshness window", async () => {
    const clock = manualIdentityTimers();
    const recorded = recordingRemoteIdentityGateway((_, call) =>
      Promise.resolve(`github.com/acme/v${call}`),
    );
    const coordinator = new RemoteRepositoryIdentityCoordinator(recorded.gateway, clock.timers);
    expect(await coordinator.discover(request("editor"))).toBe("github.com/acme/v1");
    clock.advance(REMOTE_REPOSITORY_IDENTITY_CACHE_TTL_MS - 1);
    expect(await coordinator.discover(request("editor"))).toBe("github.com/acme/v1");
    clock.advance(1);
    expect(await coordinator.discover(request("editor"))).toBe("github.com/acme/v2");
    expect(clock.pendingCount()).toBe(0);
  });

  it("does not trust a cached result stamped in the future", async () => {
    let now = 10 * REMOTE_REPOSITORY_IDENTITY_CACHE_TTL_MS;
    const recorded = recordingRemoteIdentityGateway((_, call) =>
      Promise.resolve(`github.com/acme/v${call}`),
    );
    const coordinator = new RemoteRepositoryIdentityCoordinator(recorded.gateway, {
      now: () => now,
      schedule: () => () => undefined,
    });
    expect(await coordinator.discover(request("editor"))).toBe("github.com/acme/v1");
    now -= 5 * REMOTE_REPOSITORY_IDENTITY_CACHE_TTL_MS;
    expect(await coordinator.discover(request("editor"))).toBe("github.com/acme/v2");
  });

  it("evicts the oldest cached results deterministically", async () => {
    const clock = manualIdentityTimers();
    const recorded = recordingRemoteIdentityGateway((incoming) =>
      Promise.resolve(`github.com/acme/${incoming.projectId}`),
    );
    const coordinator = new RemoteRepositoryIdentityCoordinator(recorded.gateway, clock.timers);
    for (let index = 0; index <= MAX_REMOTE_REPOSITORY_IDENTITY_CACHE; index += 1)
      await coordinator.discover(request(`project${index}`));
    const before = recorded.requests.length;
    await coordinator.discover(request(`project${MAX_REMOTE_REPOSITORY_IDENTITY_CACHE}`));
    await coordinator.discover(request("project1"));
    expect(recorded.requests).toHaveLength(before);
    await coordinator.discover(request("project0"));
    expect(recorded.requests).toHaveLength(before + 1);
  });
});
