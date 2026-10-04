import { describe, expect, it, vi } from "vitest";
import { MAX_AGENT_PROJECT_ROOTS } from "../domain/agentProject";
import { deferred, manualIdentityTimers } from "../test/repositoryIdentityTestSupport";
import {
  LOCAL_REPOSITORY_IDENTITY_LOOKUP_TIMEOUT_MS,
  MAX_ACTIVE_AND_DROPPED_REPOSITORY_IDENTITY_LOOKUPS,
  ProjectRepositoryIdentityDiscovery,
  REMOTE_REPOSITORY_IDENTITY_LOOKUP_TIMEOUT_MS,
  repositoryIdentityTargetId,
  type RepositoryIdentityOutcomes,
  type RepositoryIdentityTarget,
} from "./projectRepositoryIdentityDiscovery";
import type { RepositoryIdentityTimers } from "./repositoryIdentityRetry";
import { REPOSITORY_IDENTITY_RETRY_DELAYS_MS } from "./repositoryIdentityRetry";

const target = (key: string, authority = "owner"): RepositoryIdentityTarget => ({
  key,
  root: key,
  authority,
});
const idOf = (key: string, authority = "owner") =>
  repositoryIdentityTargetId(target(key, authority));
const settle = async () => {
  for (let round = 0; round < 20; round += 1) await Promise.resolve();
};
const RETRYING = { kind: "failed", retrying: true };
const EXHAUSTED = { kind: "failed", retrying: false };
const FIRST_DELAY = REPOSITORY_IDENTITY_RETRY_DELAYS_MS[0]!;

function uncancellableIdentityTimers() {
  const runs: (() => void)[] = [];
  const timers: RepositoryIdentityTimers = {
    now: () => 0,
    schedule(_delayMs, run) {
      runs.push(run);
      return () => undefined;
    },
  };
  return { timers, fireAll: () => runs.splice(0).forEach((run) => run()) };
}

function session(timers: RepositoryIdentityTimers) {
  const discovery = new ProjectRepositoryIdentityDiscovery(timers);
  const published: RepositoryIdentityOutcomes[] = [];
  const publish = (outcomes: RepositoryIdentityOutcomes) => {
    published.push(outcomes);
  };
  return {
    discovery,
    published,
    publish,
    latest: () => Object.fromEntries(published[published.length - 1] ?? []),
  };
}

describe("project repository identity discovery", () => {
  it("replaces the published snapshot when a settled target is pruned", async () => {
    const clock = manualIdentityTimers();
    const pending = deferred<string | null>();
    const local = {
      discover: vi.fn((root: string) =>
        root === "/a" ? Promise.resolve("github.com/acme/a") : pending.promise,
      ),
    };
    const s = session(clock.timers);
    s.discovery.start([target("/a")], local, null, s.publish);
    await settle();
    expect(s.latest()).toEqual({
      [idOf("/a")]: { kind: "identity", identity: "github.com/acme/a" },
    });
    s.discovery.start([target("/b")], local, null, s.publish);
    expect(s.latest()).toEqual({});
    s.discovery.start([target("/a")], local, null, s.publish);
    expect(s.latest()).toEqual({});
    expect(local.discover.mock.calls.map(([root]) => root)).toEqual(["/a", "/b", "/a"]);
  });

  it("publishes an empty snapshot when the gateways are replaced", async () => {
    const clock = manualIdentityTimers();
    const before = { discover: vi.fn().mockResolvedValue("github.com/acme/before") };
    const after = { discover: vi.fn(() => new Promise<string | null>(() => undefined)) };
    const s = session(clock.timers);
    s.discovery.start([target("/a")], before, null, s.publish);
    await settle();
    expect(s.published).toHaveLength(1);
    s.discovery.start([target("/a")], after, null, s.publish);
    expect(s.latest()).toEqual({});
    expect(after.discover).toHaveBeenCalledTimes(1);
  });

  it("publishes only when an outcome changed", async () => {
    const clock = manualIdentityTimers();
    const local = { discover: vi.fn().mockRejectedValue(new Error("busy")) };
    const s = session(clock.timers);
    s.discovery.start([target("/a")], local, null, s.publish);
    await settle();
    for (let round = 0; round < REPOSITORY_IDENTITY_RETRY_DELAYS_MS.length; round += 1) {
      clock.advance(10_000);
      await settle();
    }
    expect(local.discover).toHaveBeenCalledTimes(REPOSITORY_IDENTITY_RETRY_DELAYS_MS.length + 1);
    expect(s.published.map((outcomes) => outcomes.get(idOf("/a")))).toEqual([RETRYING, EXHAUSTED]);
    s.discovery.start([target("/a")], local, null, s.publish);
    expect(s.published).toHaveLength(2);
  });

  it("keeps the remaining backoff when unrelated targets change", async () => {
    const clock = manualIdentityTimers();
    const local = {
      discover: vi.fn((root: string) =>
        root === "/failing" ? Promise.reject(new Error("busy")) : Promise.resolve(null),
      ),
    };
    const s = session(clock.timers);
    s.discovery.start([target("/failing")], local, null, s.publish);
    await settle();
    expect(clock.pendingDelays()).toEqual([FIRST_DELAY]);
    clock.advance(400);
    for (let round = 0; round < 25; round += 1) {
      s.discovery.start([target("/failing"), target(`/other${round}`)], local, null, s.publish);
      await settle();
    }
    expect(local.discover.mock.calls.filter(([root]) => root === "/failing")).toHaveLength(1);
    expect(clock.pendingDelays()).toEqual([FIRST_DELAY - 400]);
    clock.advance(FIRST_DELAY - 400);
    await settle();
    expect(local.discover.mock.calls.filter(([root]) => root === "/failing")).toHaveLength(2);
    expect(clock.pendingDelays()).toEqual([REPOSITORY_IDENTITY_RETRY_DELAYS_MS[1]]);
  });

  it("does not re-arm an exhausted target until it is removed and returns", async () => {
    const clock = manualIdentityTimers();
    const local = {
      discover: vi.fn((root: string) =>
        root === "/failing" ? Promise.reject(new Error("busy")) : Promise.resolve(null),
      ),
    };
    const failing = () => local.discover.mock.calls.filter(([root]) => root === "/failing").length;
    const s = session(clock.timers);
    s.discovery.start([target("/failing")], local, null, s.publish);
    await settle();
    for (let round = 0; round < REPOSITORY_IDENTITY_RETRY_DELAYS_MS.length; round += 1) {
      clock.advance(10_000);
      await settle();
    }
    const attempts = failing();
    expect(s.latest()[idOf("/failing")]).toEqual(EXHAUSTED);
    s.discovery.start([target("/failing"), target("/other")], local, null, s.publish);
    await settle();
    clock.advance(60_000);
    await settle();
    expect(failing()).toBe(attempts);
    expect(s.latest()[idOf("/failing")]).toEqual(EXHAUSTED);
    s.discovery.start([target("/other")], local, null, s.publish);
    s.discovery.start([target("/failing"), target("/other")], local, null, s.publish);
    expect(s.latest()[idOf("/failing")]).toBeUndefined();
    await settle();
    expect(failing()).toBe(attempts + 1);
    expect(s.latest()[idOf("/failing")]).toEqual(RETRYING);
  });

  it("schedules nothing for a rejection that lands after stop and backs off on restart", async () => {
    const clock = manualIdentityTimers();
    const pending = deferred<string | null>();
    const local = {
      discover: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue("github.com/acme/a"),
    };
    const s = session(clock.timers);
    const stop = s.discovery.start([target("/a")], local, null, s.publish);
    stop();
    expect(clock.pendingCount()).toBe(0);
    pending.reject(new Error("busy"));
    await settle();
    expect(clock.pendingCount()).toBe(0);
    expect(s.published).toHaveLength(0);
    clock.advance(400);
    s.discovery.start([target("/a")], local, null, s.publish);
    expect(s.latest()[idOf("/a")]).toEqual(RETRYING);
    expect(local.discover).toHaveBeenCalledTimes(1);
    expect(clock.pendingDelays()).toEqual([FIRST_DELAY - 400]);
    clock.advance(FIRST_DELAY - 400);
    await settle();
    expect(local.discover).toHaveBeenCalledTimes(2);
    expect(s.latest()[idOf("/a")]).toEqual({ kind: "identity", identity: "github.com/acme/a" });
  });

  it("ignores the stop function of a pass that was already replaced", async () => {
    const clock = manualIdentityTimers();
    const pending = deferred<string | null>();
    const local = { discover: vi.fn(() => pending.promise) };
    const s = session(clock.timers);
    const stopFirst = s.discovery.start([target("/a")], local, null, s.publish);
    s.discovery.start([target("/b")], local, null, s.publish);
    stopFirst();
    expect(clock.pendingDelays()).toEqual([LOCAL_REPOSITORY_IDENTITY_LOOKUP_TIMEOUT_MS]);
    pending.resolve("github.com/acme/b");
    await settle();
    expect(s.latest()).toEqual({
      [idOf("/b")]: { kind: "identity", identity: "github.com/acme/b" },
    });
  });

  it("ignores timers that fire for pruned targets, landed lookups and halted passes", async () => {
    const leaky = uncancellableIdentityTimers();
    const local = { discover: vi.fn().mockRejectedValue(new Error("busy")) };
    const s = session(leaky.timers);
    const stop = s.discovery.start([target("/a"), target("/b")], local, null, s.publish);
    await settle();
    expect(local.discover).toHaveBeenCalledTimes(2);
    s.discovery.start([target("/b")], local, null, s.publish);
    stop();
    const stopSecond = s.discovery.start([target("/b")], local, null, s.publish);
    stopSecond();
    leaky.fireAll();
    await settle();
    expect(local.discover).toHaveBeenCalledTimes(2);
    expect(s.published.map((outcomes) => [...outcomes.keys()])).toEqual([
      [idOf("/a")],
      [idOf("/a"), idOf("/b")],
      [idOf("/b")],
    ]);
  });

  it("runs a retry once even when a cancelled retry timer still fires", async () => {
    const leaky = uncancellableIdentityTimers();
    const retried = deferred<string | null>();
    const local = {
      discover: vi.fn().mockRejectedValueOnce(new Error("busy")).mockReturnValue(retried.promise),
    };
    const s = session(leaky.timers);
    s.discovery.start([target("/a")], local, null, s.publish);
    await settle();
    s.discovery.start([target("/a")], local, null, s.publish);
    expect(local.discover).toHaveBeenCalledTimes(1);
    leaky.fireAll();
    await settle();
    expect(local.discover).toHaveBeenCalledTimes(2);
    retried.resolve("github.com/acme/a");
    await settle();
    expect(s.latest()).toEqual({
      [idOf("/a")]: { kind: "identity", identity: "github.com/acme/a" },
    });
  });

  it("releases the permit of a lookup that never settles and ignores its late result", async () => {
    const clock = manualIdentityTimers();
    const hung = deferred<string | null>();
    const local = {
      discover: vi.fn((root: string) =>
        root.startsWith("/hung") ? hung.promise : Promise.resolve("github.com/acme/ok"),
      ),
    };
    const s = session(clock.timers);
    s.discovery.start([target("/hung1"), target("/hung2"), target("/ok")], local, null, s.publish);
    await settle();
    expect(local.discover).toHaveBeenCalledTimes(2);
    expect(s.published).toHaveLength(0);
    clock.advance(LOCAL_REPOSITORY_IDENTITY_LOOKUP_TIMEOUT_MS);
    await settle();
    expect(s.latest()).toEqual({
      [idOf("/hung1")]: RETRYING,
      [idOf("/hung2")]: RETRYING,
      [idOf("/ok")]: { kind: "identity", identity: "github.com/acme/ok" },
    });
    const publishedBefore = s.published.length;
    hung.resolve("github.com/acme/late");
    await settle();
    expect(s.published).toHaveLength(publishedBefore);
    expect(s.latest()[idOf("/hung1")]).toEqual(RETRYING);
  });

  it("frees the permit of a dropped target at once and discards its late result", async () => {
    const clock = manualIdentityTimers();
    const dropped = deferred<string | null>();
    const local = {
      discover: vi.fn((root: string) =>
        root.startsWith("/dropped") ? dropped.promise : Promise.resolve("github.com/acme/kept"),
      ),
    };
    const s = session(clock.timers);
    s.discovery.start([target("/dropped1"), target("/dropped2")], local, null, s.publish);
    expect(local.discover).toHaveBeenCalledTimes(2);
    s.discovery.start([target("/kept1"), target("/kept2")], local, null, s.publish);
    expect(local.discover).toHaveBeenCalledTimes(4);
    await settle();
    expect(clock.pendingCount()).toBe(0);
    dropped.resolve("github.com/acme/late");
    await settle();
    expect(Object.keys(s.latest())).toEqual([idOf("/kept1"), idOf("/kept2")]);
    expect(s.published.every((outcomes) => !outcomes.has(idOf("/dropped1")))).toBe(true);
  });

  it("never has more than four active and dropped lookups in flight", async () => {
    const clock = manualIdentityTimers();
    const reads: ReturnType<typeof deferred<string | null>>[] = [];
    let unsettled = 0;
    let peak = 0;
    const read = async (_root: string): Promise<string | null> => {
      const hold = deferred<string | null>();
      reads.push(hold);
      unsettled += 1;
      peak = Math.max(peak, unsettled);
      try {
        return await hold.promise;
      } finally {
        unsettled -= 1;
      }
    };
    const local = { discover: vi.fn(read) };
    const s = session(clock.timers);
    const pair = (name: string) => [target(`/${name}1`), target(`/${name}2`)];
    s.discovery.start(pair("first"), local, null, s.publish);
    expect(unsettled).toBe(2);
    s.discovery.start(pair("second"), local, null, s.publish);
    expect(unsettled).toBe(MAX_ACTIVE_AND_DROPPED_REPOSITORY_IDENTITY_LOOKUPS);
    for (let round = 0; round < 20; round += 1)
      s.discovery.start(pair(`blocked${round}`), local, null, s.publish);
    expect(local.discover).toHaveBeenCalledTimes(
      MAX_ACTIVE_AND_DROPPED_REPOSITORY_IDENTITY_LOOKUPS,
    );
    expect(unsettled).toBe(MAX_ACTIVE_AND_DROPPED_REPOSITORY_IDENTITY_LOOKUPS);

    reads.splice(0, 2).forEach((hold) => hold.resolve(null));
    await settle();
    expect(unsettled).toBe(2);
    s.discovery.start(pair("third"), local, null, s.publish);
    expect(unsettled).toBe(MAX_ACTIVE_AND_DROPPED_REPOSITORY_IDENTITY_LOOKUPS);
    expect(local.discover.mock.calls.slice(-2).map(([root]) => root)).toEqual([
      "/third1",
      "/third2",
    ]);
    for (let round = 0; round < 20; round += 1)
      s.discovery.start(pair(`later${round}`), local, null, s.publish);
    expect(unsettled).toBe(MAX_ACTIVE_AND_DROPPED_REPOSITORY_IDENTITY_LOOKUPS);

    reads.splice(0).forEach((hold) => hold.resolve(null));
    await settle();
    expect(unsettled).toBe(2);
    expect(local.discover.mock.calls.slice(-2).map(([root]) => root)).toEqual([
      "/later191",
      "/later192",
    ]);
    reads.splice(0).forEach((hold) => hold.resolve("github.com/acme/later"));
    await settle();
    expect(unsettled).toBe(0);
    expect(Object.keys(s.latest())).toEqual([idOf("/later191"), idOf("/later192")]);
    expect(peak).toBe(MAX_ACTIVE_AND_DROPPED_REPOSITORY_IDENTITY_LOOKUPS);
    expect(s.published.every((outcomes) => !outcomes.has(idOf("/first1")))).toBe(true);
    expect(clock.pendingCount()).toBe(0);
  });

  it("gives remote lookups a longer bounded timeout than local ones", async () => {
    const clock = manualIdentityTimers();
    const never = () => new Promise<string | null>(() => undefined);
    const s = session(clock.timers);
    const remoteKey = "remote:linux:runner:project";
    s.discovery.start(
      [target("/local"), target(remoteKey)],
      { discover: never },
      { discover: never },
      s.publish,
    );
    expect(clock.pendingDelays()).toEqual([
      LOCAL_REPOSITORY_IDENTITY_LOOKUP_TIMEOUT_MS,
      REMOTE_REPOSITORY_IDENTITY_LOOKUP_TIMEOUT_MS,
    ]);
    clock.advance(REMOTE_REPOSITORY_IDENTITY_LOOKUP_TIMEOUT_MS - 1);
    await settle();
    expect(s.latest()[idOf(remoteKey)]).toBeUndefined();
    clock.advance(1);
    await settle();
    expect(s.latest()[idOf(remoteKey)]).toEqual(RETRYING);
  });

  it("cancels lookup timeouts on stop and resumes them with the remaining time", async () => {
    const clock = manualIdentityTimers();
    const local = { discover: vi.fn(() => new Promise<string | null>(() => undefined)) };
    const s = session(clock.timers);
    const stop = s.discovery.start([target("/a")], local, null, s.publish);
    expect(clock.pendingDelays()).toEqual([LOCAL_REPOSITORY_IDENTITY_LOOKUP_TIMEOUT_MS]);
    clock.advance(4_000);
    stop();
    expect(clock.pendingCount()).toBe(0);
    s.discovery.start([target("/a")], local, null, s.publish);
    expect(local.discover).toHaveBeenCalledTimes(1);
    expect(clock.pendingDelays()).toEqual([LOCAL_REPOSITORY_IDENTITY_LOOKUP_TIMEOUT_MS - 4_000]);
  });

  it("never tracks more targets than the project root bound", async () => {
    const clock = manualIdentityTimers();
    const local = { discover: vi.fn().mockResolvedValue(null) };
    const s = session(clock.timers);
    const targets = Array.from({ length: MAX_AGENT_PROJECT_ROOTS + 36 }, (_, i) => target(`/${i}`));
    s.discovery.start(targets, local, null, s.publish);
    for (let round = 0; round < MAX_AGENT_PROJECT_ROOTS; round += 1) await settle();
    expect(local.discover).toHaveBeenCalledTimes(MAX_AGENT_PROJECT_ROOTS);
    expect(Object.keys(s.latest())).toHaveLength(MAX_AGENT_PROJECT_ROOTS);
    expect(clock.pendingCount()).toBe(0);
  });
});
