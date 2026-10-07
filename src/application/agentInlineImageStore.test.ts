import { describe, expect, it, vi } from "vitest";
import {
  MAX_AGENT_INLINE_IMAGE_ENTRIES,
  MAX_AGENT_INLINE_IMAGE_PINS,
  type AgentInlineImageIdentity,
} from "./agentInlineImageCache";
import type { AgentInlineImageGateway } from "./agentInlineImagePorts";
import {
  AGENT_INLINE_IMAGE_QUEUE_LIMIT_REASON,
  MAX_AGENT_INLINE_IMAGE_WAITING,
  createAgentInlineImageStore,
  type AgentInlineImageStore,
} from "./agentInlineImageStore";

type ReadInlineImage = AgentInlineImageGateway["readAgentInlineImage"];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function png(): ArrayBuffer {
  return new Uint8Array(PNG_SIGNATURE).buffer;
}

function image(index: number): AgentInlineImageIdentity {
  return { workspaceId: "ws-1", threadId: "agt-1", scope: "agt-1-t1", path: `/tmp/${index}.png` };
}

function harness() {
  const revoked: string[] = [];
  const read = vi.fn<ReadInlineImage>(async () => png());
  let created = 0;
  const store: AgentInlineImageStore = createAgentInlineImageStore({
    gateway: () => ({ readAgentInlineImage: read }),
    createObjectUrl: () => `blob:${created++}`,
    revokeObjectUrl: (url) => {
      revoked.push(url);
    },
  });
  const show = (index: number): (() => void) => {
    const unpin = store.pin(image(index));
    store.ensure(image(index));
    return unpin;
  };
  return { store, read, revoked, show };
}

async function settled(assertion: () => void): Promise<void> {
  await vi.waitFor(assertion);
}

describe("createAgentInlineImageStore bounds", () => {
  it("queues at most a bounded number of on-screen images and hands the oldest a manual retry", async () => {
    const { store, read, show } = harness();
    const unpins: Array<() => void> = [];
    for (let index = 0; index < MAX_AGENT_INLINE_IMAGE_ENTRIES; index += 1)
      unpins.push(show(index));
    await settled(() => expect(read).toHaveBeenCalledTimes(MAX_AGENT_INLINE_IMAGE_ENTRIES));
    const firstWaiting = MAX_AGENT_INLINE_IMAGE_ENTRIES;
    const overflow = firstWaiting + MAX_AGENT_INLINE_IMAGE_WAITING;

    for (let index = firstWaiting; index <= overflow; index += 1) show(index);

    expect(store.stateOf(image(firstWaiting))).toEqual({
      kind: "unavailable",
      reason: AGENT_INLINE_IMAGE_QUEUE_LIMIT_REASON,
    });
    for (let index = firstWaiting + 1; index <= overflow; index += 1) {
      expect(store.stateOf(image(index))).toEqual({ kind: "waiting" });
    }
    expect(read).toHaveBeenCalledTimes(MAX_AGENT_INLINE_IMAGE_ENTRIES);

    store.ensure(image(firstWaiting));
    expect(store.stateOf(image(firstWaiting))?.kind).toBe("unavailable");

    store.retry(image(firstWaiting));
    expect(store.stateOf(image(firstWaiting))).toEqual({ kind: "waiting" });
    expect(store.stateOf(image(firstWaiting + 1))).toEqual({
      kind: "unavailable",
      reason: AGENT_INLINE_IMAGE_QUEUE_LIMIT_REASON,
    });
    expect(read).toHaveBeenCalledTimes(MAX_AGENT_INLINE_IMAGE_ENTRIES);

    unpins[0]?.();
    await settled(() => expect(store.stateOf(image(firstWaiting + 2))?.kind).toBe("ready"));
    expect(store.stateOf(image(firstWaiting + 1))?.kind).toBe("unavailable");
    expect(store.stateOf(image(firstWaiting))).toEqual({ kind: "waiting" });
    expect(read).toHaveBeenCalledTimes(MAX_AGENT_INLINE_IMAGE_ENTRIES + 1);

    store.retry(image(firstWaiting + 1));
    unpins[1]?.();
    await settled(() => expect(read).toHaveBeenCalledTimes(MAX_AGENT_INLINE_IMAGE_ENTRIES + 2));
    await settled(() => expect(store.stateOf(image(firstWaiting + 3))?.kind).toBe("ready"));
    store.dispose();
  });

  it("refuses a pin beyond the pin bound, so that image loads but is the first to be released", async () => {
    const { store, read, revoked, show } = harness();
    const holders: Array<() => void> = [];
    for (let index = 0; index < MAX_AGENT_INLINE_IMAGE_PINS; index += 1) {
      holders.push(store.pin(image(1_000 + index)));
    }

    const unprotected = show(0);
    await settled(() => expect(store.stateOf(image(0))?.kind).toBe("ready"));
    for (let index = 1; index < MAX_AGENT_INLINE_IMAGE_ENTRIES; index += 1) {
      store.ensure(image(1_000 + index));
    }
    await settled(() => expect(read).toHaveBeenCalledTimes(MAX_AGENT_INLINE_IMAGE_ENTRIES));
    expect(revoked).toEqual([]);

    store.ensure(image(1_000));
    await settled(() => expect(store.stateOf(image(1_000))?.kind).toBe("ready"));

    expect(revoked).toEqual(["blob:0"]);
    expect(store.stateOf(image(0))).toBeUndefined();
    unprotected();
    unprotected();
    store.ensure(image(2_000));
    expect(store.stateOf(image(2_000))).toEqual({
      kind: "unavailable",
      reason: AGENT_INLINE_IMAGE_QUEUE_LIMIT_REASON,
    });

    holders[1]?.();
    const protectedNow = show(0);
    await settled(() => expect(store.stateOf(image(0))?.kind).toBe("ready"));
    expect(store.stateOf(image(1_001))).toBeUndefined();
    protectedNow();
    store.dispose();
  });
});
