import { describe, expect, it } from "vitest";
import {
  AGENT_INLINE_IMAGE_MEMORY_LIMIT_REASON,
  MAX_AGENT_INLINE_IMAGE_CACHE_BYTES,
  MAX_AGENT_INLINE_IMAGE_ENTRIES,
  MAX_AGENT_INLINE_IMAGE_PINS,
  MAX_AGENT_INLINE_IMAGE_RETAINED_FAILURES,
  agentInlineImageKey,
  agentInlineImageThreadPrefix,
  createAgentInlineImageCache,
  type AgentInlineImageCache,
  type AgentInlineImageLease,
} from "./agentInlineImageCache";

const MIB = 1_024 * 1_024;
const THREAD = { workspaceId: "ws-1", threadId: "agt-1-0a1b" } as const;
const OTHER_THREAD = { workspaceId: "ws-1", threadId: "agt-2-0c2d" } as const;
const TURN = "agt-1-t1";

function key(index: number, owner: { workspaceId: string; threadId: string } = THREAD): string {
  return agentInlineImageKey({ ...owner, scope: TURN, path: `/tmp/${index}.png` });
}

function harness() {
  const revoked: string[] = [];
  const cache = createAgentInlineImageCache((url) => revoked.push(url));
  return { cache, revoked };
}

function admitted(cache: AgentInlineImageCache, imageKey: string): AgentInlineImageLease {
  const admission = cache.begin(imageKey);
  expect(admission.kind).toBe("admitted");
  return admission.kind === "admitted" ? admission.lease : { key: imageKey };
}

function ready(cache: AgentInlineImageCache, imageKey: string, bytes: number, url: string): void {
  cache.resolve(admitted(cache, imageKey), bytes, () => url);
}

function failed(cache: AgentInlineImageCache, imageKey: string): void {
  cache.fail(admitted(cache, imageKey), "The image could not be read.");
}

function fill(cache: AgentInlineImageCache, count = MAX_AGENT_INLINE_IMAGE_ENTRIES): void {
  for (let index = 0; index < count; index += 1) ready(cache, key(index), 1, `blob:${index}`);
}

describe("agentInlineImageKey", () => {
  it("separates workspace, thread, turn and path so prefixes cannot alias", () => {
    const identity = { workspaceId: "ws-1", threadId: "agt-1", scope: "t1", path: "/a.png" };
    expect(agentInlineImageKey(identity)).toBe("ws-1\u0000agt-1\u0000t1\u0000/a.png");
    expect(agentInlineImageKey(identity)).not.toBe(
      agentInlineImageKey({ ...identity, threadId: "agt-11" }),
    );
    expect(agentInlineImageKey(identity)).not.toBe(
      agentInlineImageKey({ ...identity, scope: "t2" }),
    );
    expect(agentInlineImageKey(identity).startsWith(agentInlineImageThreadPrefix(identity))).toBe(
      true,
    );
  });
});

describe("createAgentInlineImageCache", () => {
  it("admits a loading entry once and settles it exactly once", () => {
    const { cache } = harness();
    const lease = admitted(cache, key(1));

    expect(cache.begin(key(1))).toEqual({ kind: "present" });
    expect(cache.stateOf(key(1))).toEqual({ kind: "loading" });
    expect(cache.isCurrent(lease)).toBe(true);

    let created = 0;
    const createUrl = (): string => `blob:${(created += 1)}`;
    cache.resolve(lease, 4, createUrl);
    cache.resolve(lease, 4, createUrl);
    cache.fail(lease, "late failure");

    expect(created).toBe(1);
    expect(cache.isCurrent(lease)).toBe(false);
    expect(cache.stateOf(key(1))).toEqual({ kind: "ready", url: "blob:1" });
  });

  it("reports every change of an entry through its version and nothing else", () => {
    const { cache } = harness();
    const versions: number[] = [cache.version()];
    const lease = admitted(cache, key(0));
    versions.push(cache.version());
    cache.resolve(lease, 1, () => "blob:0");
    versions.push(cache.version());
    cache.touch(key(0));
    cache.pin(key(0));
    cache.unpin(key(0));
    cache.begin(key(0));
    versions.push(cache.version());
    cache.forget(key(0));
    versions.push(cache.version());

    expect(versions).toEqual([0, 1, 2, 2, 3]);
  });

  it("evicts the least recently used ready entry that is off screen, even in a held thread", () => {
    const { cache, revoked } = harness();
    cache.holdThread(THREAD);
    fill(cache);
    expect(cache.touch(key(0))).toBe(true);
    expect(cache.touch(key(999))).toBe(false);

    ready(cache, key(100), 1, "blob:100");
    ready(cache, key(101), 1, "blob:101");

    expect(revoked).toEqual(["blob:1", "blob:2"]);
    expect(cache.stateOf(key(0))).toEqual({ kind: "ready", url: "blob:0" });
    expect(cache.stateOf(key(1))).toBeUndefined();
    expect(cache.stateOf(key(2))).toBeUndefined();
    expect(cache.stateOf(key(3))).toEqual({ kind: "ready", url: "blob:3" });
  });

  it("never evicts a pinned or loading entry and refuses without evicting anything", () => {
    const { cache, revoked } = harness();
    fill(cache, MAX_AGENT_INLINE_IMAGE_ENTRIES - 1);
    for (let index = 0; index < MAX_AGENT_INLINE_IMAGE_ENTRIES - 1; index += 1)
      cache.pin(key(index));
    const loading = admitted(cache, key(1, OTHER_THREAD));

    expect(cache.begin(key(2, OTHER_THREAD))).toEqual({ kind: "refused" });
    expect(revoked).toEqual([]);
    expect(cache.isCurrent(loading)).toBe(true);

    cache.pin(key(5));
    cache.unpin(key(5));
    expect(cache.isPinned(key(5))).toBe(true);
    expect(cache.begin(key(2, OTHER_THREAD))).toEqual({ kind: "refused" });

    cache.unpin(key(5));
    expect(cache.isPinned(key(5))).toBe(false);
    expect(cache.begin(key(2, OTHER_THREAD)).kind).toBe("admitted");
    expect(revoked).toEqual(["blob:5"]);
  });

  it("makes room in order: a failure costs nothing, then the oldest off-screen picture, then it refuses", () => {
    const { cache, revoked } = harness();
    for (let index = 0; index < MAX_AGENT_INLINE_IMAGE_ENTRIES; index += 1) {
      failed(cache, key(1_000 + index));
      cache.pin(key(1_000 + index));
    }
    fill(cache);
    expect(revoked).toEqual([]);
    for (let index = 2; index < MAX_AGENT_INLINE_IMAGE_ENTRIES; index += 1) cache.pin(key(index));

    ready(cache, key(100), 1, "blob:100");
    cache.pin(key(100));
    ready(cache, key(101), 1, "blob:101");
    cache.pin(key(101));

    expect(revoked).toEqual(["blob:0", "blob:1"]);
    expect(cache.begin(key(102))).toEqual({ kind: "refused" });
    expect(revoked).toEqual(["blob:0", "blob:1"]);
    for (let index = 0; index < MAX_AGENT_INLINE_IMAGE_ENTRIES; index += 1) {
      expect(cache.stateOf(key(1_000 + index))?.kind).toBe("unavailable");
    }
  });

  it("frees a preview slot as soon as a read fails", () => {
    const { cache } = harness();
    fill(cache, MAX_AGENT_INLINE_IMAGE_ENTRIES - 1);
    for (let index = 0; index < MAX_AGENT_INLINE_IMAGE_ENTRIES - 1; index += 1)
      cache.pin(key(index));
    const loading = admitted(cache, key(40));
    cache.pin(key(40));
    expect(cache.begin(key(41))).toEqual({ kind: "refused" });

    cache.fail(loading, "The image could not be read.");

    expect(cache.begin(key(41)).kind).toBe("admitted");
    expect(cache.stateOf(key(40))?.kind).toBe("unavailable");
  });

  it("keeps every failure that is on screen and only a bounded number of the others", () => {
    const { cache } = harness();
    const total = MAX_AGENT_INLINE_IMAGE_RETAINED_FAILURES + 8;
    for (let index = 0; index < total; index += 1) {
      cache.pin(key(index));
      failed(cache, key(index));
    }
    const kept = (): ReadonlyArray<number> =>
      Array.from({ length: total }, (_, index) => index).filter(
        (index) => cache.stateOf(key(index)) !== undefined,
      );
    expect(kept()).toHaveLength(total);

    for (let index = 0; index < total; index += 1) cache.unpin(key(index));

    expect(kept()).toEqual(Array.from({ length: total }, (_, index) => index).slice(8));
    failed(cache, key(500));
    expect(cache.stateOf(key(8))).toBeUndefined();
    expect(cache.stateOf(key(500))?.kind).toBe("unavailable");
  });

  it("reclaims bytes from the oldest off-screen pictures, skipping pinned and failed entries", () => {
    const { cache, revoked } = harness();
    ready(cache, key(0), 10 * MIB, "blob:pinned");
    cache.pin(key(0));
    failed(cache, key(1, OTHER_THREAD));
    ready(cache, key(2, OTHER_THREAD), 20 * MIB, "blob:old");
    ready(cache, key(3, OTHER_THREAD), 20 * MIB, "blob:mid");
    ready(cache, key(4, OTHER_THREAD), 10 * MIB, "blob:new");

    ready(cache, key(5), 10 * MIB, "blob:fits-after-one");
    cache.pin(key(5));

    expect(revoked).toEqual(["blob:old"]);
    ready(cache, key(6), 35 * MIB, "blob:fits-after-two");
    expect(revoked).toEqual(["blob:old", "blob:mid", "blob:new"]);
    expect(cache.stateOf(key(0))?.kind).toBe("ready");
    expect(cache.stateOf(key(1, OTHER_THREAD))?.kind).toBe("unavailable");
    expect(cache.stateOf(key(5))?.kind).toBe("ready");
    expect(cache.stateOf(key(6))?.kind).toBe("ready");
  });

  it("refuses bytes that cannot fit without evicting anything or creating a URL", () => {
    const { cache, revoked } = harness();
    ready(cache, key(0), MAX_AGENT_INLINE_IMAGE_CACHE_BYTES - 5 * MIB, "blob:pinned");
    cache.pin(key(0));
    ready(cache, key(1, OTHER_THREAD), 2 * MIB, "blob:off-screen");
    const lease = admitted(cache, key(2));
    let created = 0;

    cache.resolve(lease, 8 * MIB, () => {
      created += 1;
      return "blob:never";
    });

    expect(created).toBe(0);
    expect(revoked).toEqual([]);
    expect(cache.stateOf(key(2))).toEqual({
      kind: "unavailable",
      reason: AGENT_INLINE_IMAGE_MEMORY_LIMIT_REASON,
    });
    expect(cache.stateOf(key(1, OTHER_THREAD))).toEqual({ kind: "ready", url: "blob:off-screen" });
  });

  it("fills the byte budget exactly", () => {
    const { cache, revoked } = harness();
    ready(cache, key(0), MAX_AGENT_INLINE_IMAGE_CACHE_BYTES - 1, "blob:0");
    ready(cache, key(1), 1, "blob:1");
    expect(revoked).toEqual([]);
    ready(cache, key(2), 1, "blob:2");
    expect(revoked).toEqual(["blob:0"]);
  });

  it("drops every entry of a thread, including pinned and pending ones, on its final release", () => {
    const { cache, revoked } = harness();
    cache.holdThread(THREAD);
    cache.holdThread(THREAD);
    ready(cache, key(0), 1, "blob:0");
    cache.pin(key(0));
    const pending = admitted(cache, key(1));
    ready(cache, key(0, OTHER_THREAD), 1, "blob:other");

    expect(cache.releaseThread(THREAD)).toBe("held");
    expect(cache.stateOf(key(0))?.kind).toBe("ready");
    expect(cache.releaseThread(THREAD)).toBe("released");

    expect(revoked).toEqual(["blob:0"]);
    expect(cache.stateOf(key(0))).toBeUndefined();
    expect(cache.stateOf(key(0, OTHER_THREAD))?.kind).toBe("ready");
    expect(cache.isCurrent(pending)).toBe(false);
    let created = 0;
    cache.resolve(pending, 1, () => {
      created += 1;
      return "blob:late";
    });
    expect(created).toBe(0);
    expect(cache.stateOf(key(1))).toBeUndefined();
  });

  it("does not let a stale lease settle a replacement entry of the same key", () => {
    const { cache } = harness();
    cache.holdThread(THREAD);
    const stale = admitted(cache, key(0));
    expect(cache.releaseThread(THREAD)).toBe("released");
    const fresh = admitted(cache, key(0));

    cache.resolve(stale, 1, () => "blob:stale");
    cache.fail(stale, "stale failure");
    expect(cache.stateOf(key(0))).toEqual({ kind: "loading" });

    cache.resolve(fresh, 1, () => "blob:fresh");
    expect(cache.stateOf(key(0))).toEqual({ kind: "ready", url: "blob:fresh" });
  });

  it("forgets a settled entry so it can load again and never a loading one", () => {
    const { cache, revoked } = harness();
    const failing = admitted(cache, key(0));

    expect(cache.forget(key(0))).toBe(false);
    expect(cache.forget(key(9))).toBe(false);
    expect(cache.isCurrent(failing)).toBe(true);

    cache.fail(failing, "The image could not be read.");
    expect(cache.forget(key(0))).toBe(true);
    expect(cache.stateOf(key(0))).toBeUndefined();
    expect(cache.begin(key(0)).kind).toBe("admitted");

    ready(cache, key(1), 1, "blob:decoded-badly");
    expect(cache.forget(key(1))).toBe(true);
    expect(revoked).toEqual(["blob:decoded-badly"]);
    expect(cache.stateOf(key(1))).toBeUndefined();
  });

  it("refuses a pin beyond the pin bound and leaves that entry unprotected", () => {
    const { cache, revoked } = harness();
    for (let index = 0; index < MAX_AGENT_INLINE_IMAGE_PINS - 1; index += 1) {
      expect(cache.pin(key(1_000 + index))).toBe("pinned");
    }
    expect(cache.pin(key(1_000))).toBe("pinned");
    ready(cache, key(0), 1, "blob:unprotected");

    expect(cache.pin(key(0))).toBe("refused");
    expect(cache.pin(key(1_001))).toBe("refused");
    expect(cache.isPinned(key(0))).toBe(false);
    cache.unpin(key(0));
    expect(cache.isPinned(key(1_000))).toBe(true);

    for (let index = 1; index < MAX_AGENT_INLINE_IMAGE_ENTRIES; index += 1) {
      ready(cache, key(1_000 + index), 1, `blob:${index}`);
    }
    ready(cache, key(1_000), 1, "blob:pinned");
    expect(revoked).toEqual(["blob:unprotected"]);

    cache.unpin(key(1_000));
    expect(cache.pin(key(0))).toBe("pinned");
  });

  it("records a refusal as a failure only where nothing is recorded yet", () => {
    const { cache } = harness();
    ready(cache, key(0), 1, "blob:0");
    const version = cache.version();

    cache.refuse(key(0), "Too many images are waiting for a preview.");
    expect(cache.stateOf(key(0))).toEqual({ kind: "ready", url: "blob:0" });
    expect(cache.version()).toBe(version);

    cache.refuse(key(1), "Too many images are waiting for a preview.");
    expect(cache.stateOf(key(1))).toEqual({
      kind: "unavailable",
      reason: "Too many images are waiting for a preview.",
    });
    expect(cache.version()).toBe(version + 1);
    expect(cache.forget(key(1))).toBe(true);
  });

  it("revokes every picture when cleared", () => {
    const { cache, revoked } = harness();
    ready(cache, key(0), 1, "blob:a");
    ready(cache, key(0, OTHER_THREAD), 1, "blob:b");
    failed(cache, key(1));

    cache.clear();

    expect(revoked).toEqual(["blob:a", "blob:b"]);
    expect(cache.stateOf(key(1))).toBeUndefined();
  });
});
