import { describe, expect, it } from "vitest";
import {
  MAX_DEFERRED_FOLLOW_UPS_PER_THREAD,
  MAX_DEFERRED_FOLLOW_UP_THREADS,
  clearDeferred,
  deferredFollowUpsForThread,
  emptyDeferredFollowUps,
  enqueueDeferred,
  removeDeferred,
  takeDeferredHead,
  type DeferredFollowUp,
  type DeferredFollowUps,
} from "./agentDeferredFollowUps";

const LAUNCH = {
  provider: "claudeCode",
  model: "sonnet",
  mode: "default",
  effort: "default",
} as const;

function entry(id: string, threadId = "agt-t1-0001"): DeferredFollowUp {
  return {
    id,
    request: { threadId, prompt: `prompt ${id}`, launch: LAUNCH },
    queuedAtEpochMs: 1_000,
  };
}

function filled(count: number, threadId = "agt-t1-0001"): DeferredFollowUps {
  let map = emptyDeferredFollowUps();
  for (let index = 0; index < count; index += 1) {
    map = enqueueDeferred(map, threadId, entry(`d${index}`, threadId)).map;
  }
  return map;
}

describe("agentDeferredFollowUps", () => {
  it("keeps a per-thread FIFO queue without touching other threads", () => {
    const map = enqueueDeferred(filled(2), "agt-t2-0002", entry("other", "agt-t2-0002")).map;

    expect(deferredFollowUpsForThread(map, "agt-t1-0001").map((item) => item.id)).toEqual([
      "d0",
      "d1",
    ]);
    expect(deferredFollowUpsForThread(map, "agt-t2-0002").map((item) => item.id)).toEqual([
      "other",
    ]);

    const taken = takeDeferredHead(map, "agt-t1-0001");
    expect(taken.head?.id).toBe("d0");
    expect(deferredFollowUpsForThread(taken.map, "agt-t1-0001").map((item) => item.id)).toEqual([
      "d1",
    ]);
    expect(deferredFollowUpsForThread(taken.map, "agt-t2-0002")).toHaveLength(1);
  });

  it("refuses an entry past the per-thread bound and keeps the queue intact", () => {
    const map = filled(MAX_DEFERRED_FOLLOW_UPS_PER_THREAD);
    const overflow = enqueueDeferred(map, "agt-t1-0001", entry("extra"));

    expect(overflow.accepted).toBe(false);
    expect(overflow.map).toBe(map);
    expect(deferredFollowUpsForThread(overflow.map, "agt-t1-0001")).toHaveLength(
      MAX_DEFERRED_FOLLOW_UPS_PER_THREAD,
    );
    expect(MAX_DEFERRED_FOLLOW_UPS_PER_THREAD).toBe(8);
  });

  it("removes one entry by id and leaves an unknown id alone", () => {
    const map = filled(3);

    expect(
      deferredFollowUpsForThread(removeDeferred(map, "agt-t1-0001", "d1"), "agt-t1-0001").map(
        (item) => item.id,
      ),
    ).toEqual(["d0", "d2"]);
    expect(removeDeferred(map, "agt-t1-0001", "missing")).toBe(map);
    expect(removeDeferred(map, "agt-t9-0009", "d1")).toBe(map);
  });

  it("refuses overflow at the global bound without discarding another thread", () => {
    let map = emptyDeferredFollowUps();
    for (let index = 0; index < MAX_DEFERRED_FOLLOW_UP_THREADS; index += 1) {
      map = enqueueDeferred(map, `agt-t${index}-0001`, entry("d0", `agt-t${index}-0001`)).map;
    }
    const overflow = enqueueDeferred(map, "extra", entry("extra", "extra"));
    expect(overflow).toEqual({ map, accepted: false });
    expect(overflow.map).toBe(map);
    expect(map.has("agt-t0-0001")).toBe(true);
    expect(enqueueDeferred(map, "agt-t0-0001", entry("d1")).accepted).toBe(true);
    expect(map.size).toBe(64);
  });

  it("clears one thread's slot and reports an empty queue", () => {
    const map = clearDeferred(filled(3), "agt-t1-0001");

    expect(deferredFollowUpsForThread(map, "agt-t1-0001")).toHaveLength(0);
    expect(map.has("agt-t1-0001")).toBe(false);
    expect(clearDeferred(map, "agt-t1-0001")).toBe(map);
    expect(takeDeferredHead(map, "agt-t1-0001")).toEqual({ map, head: null });
  });
});
