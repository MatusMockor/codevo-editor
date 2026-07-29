import { describe, expect, it, vi } from "vitest";
import { LatestValueDrainMailbox } from "./latestValueDrainMailbox";

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const directQueue = (_key: string, operation: () => Promise<void>) => operation();

describe("LatestValueDrainMailbox", () => {
  it("retains only the in-flight value and the latest replacement", async () => {
    const mailbox = new LatestValueDrainMailbox<number>();
    const first = deferred();
    const drained: number[] = [];
    const drain = vi.fn(async (value: number) => {
      drained.push(value);
      if (value === 1) {
        await first.promise;
      }
    });

    const running = mailbox.offer("owner", 1, directQueue, drain);
    expect(running.started).toBe(true);
    for (let value = 2; value <= 1_000; value += 1) {
      const replacement = mailbox.offer("owner", value, directQueue, drain);
      expect(replacement.started).toBe(false);
      expect(replacement.settlement).toBe(running.settlement);
    }

    expect(drained).toEqual([1]);
    first.resolve();
    await running.settlement;

    expect(drained).toEqual([1, 1_000]);
  });

  it("reserves replacement payload bytes while an earlier value is in flight", async () => {
    const mailbox = new LatestValueDrainMailbox<string>();
    const first = deferred();
    const payloads: string[][] = [];
    const enqueue = Object.assign((_key: string, operation: () => Promise<void>) => operation(), {
      reservePayload: (_key: string, retainedPayloads: readonly string[]) => {
        payloads.push([...retainedPayloads]);
        return {
          release: () => undefined,
          replace: (replacement: readonly string[]) => {
            payloads.push([...replacement]);
            return true;
          },
        };
      },
    });
    const running = mailbox.offer(
      "owner",
      "small",
      enqueue,
      async (value) => {
        if (value === "small") await first.promise;
      },
      ["small"],
    );
    mailbox.offer("owner", "much larger", enqueue, async () => undefined, ["much larger"]);

    expect(payloads).toEqual([["small"], ["much larger"]]);
    first.resolve();
    await running.settlement;
  });

  it("releases ownership when initial or replacement payload admission fails", async () => {
    const mailbox = new LatestValueDrainMailbox<number>();
    const capacity = new Error("capacity");
    const rejectedQueue = () => Promise.reject(capacity);
    await expect(
      mailbox.offer("owner", 1, rejectedQueue, async () => undefined).settlement,
    ).rejects.toBe(capacity);

    const first = deferred();
    let reservationCalls = 0;
    const replacementRejectingQueue = Object.assign(
      (_key: string, operation: () => Promise<void>) => operation(),
      {
        reservePayload: () => {
          reservationCalls += 1;
          return reservationCalls === 1
            ? {
                release: () => undefined,
                replace: () => true,
              }
            : null;
        },
      },
    );
    const running = mailbox.offer(
      "owner",
      2,
      replacementRejectingQueue,
      async () => {
        await first.promise;
      },
      ["two"],
    );
    mailbox.offer("owner", 3, replacementRejectingQueue, async () => undefined, ["three"]);
    first.resolve();
    await expect(running.settlement).rejects.toThrow("capacity");

    const freshDrain = vi.fn(async () => undefined);
    await mailbox.offer("owner", 4, directQueue, freshDrain).settlement;
    expect(freshDrain).toHaveBeenCalledOnce();
  });

  it("keeps owners independent", async () => {
    const mailbox = new LatestValueDrainMailbox<string>();
    const first = deferred();
    const drained: string[] = [];
    const drain = async (value: string) => {
      drained.push(value);
      if (value === "a1") {
        await first.promise;
      }
    };

    const ownerA = mailbox.offer("a", "a1", directQueue, drain);
    await mailbox.offer("b", "b1", directQueue, drain).settlement;
    mailbox.offer("a", "a2", directQueue, drain);

    expect(drained).toEqual(["a1", "b1"]);
    first.resolve();
    await ownerA.settlement;
    expect(drained).toEqual(["a1", "b1", "a2"]);
  });

  it("drops a queued replacement without cancelling an irreversible in-flight drain", async () => {
    const mailbox = new LatestValueDrainMailbox<number>();
    const first = deferred();
    const drained: number[] = [];
    const running = mailbox.offer("owner", 1, directQueue, async (value) => {
      drained.push(value);
      await first.promise;
    });
    mailbox.offer("owner", 2, directQueue, async (value) => {
      drained.push(value);
    });

    mailbox.drop("owner");
    first.resolve();
    await running.settlement;

    expect(drained).toEqual([1]);
  });

  it("releases failed ownership so a later offer can start a fresh drain", async () => {
    const mailbox = new LatestValueDrainMailbox<number>();
    const failure = new Error("offline");

    await expect(
      mailbox.offer("owner", 1, directQueue, async () => {
        throw failure;
      }).settlement,
    ).rejects.toBe(failure);

    const drain = vi.fn(async () => undefined);
    await mailbox.offer("owner", 2, directQueue, drain).settlement;
    expect(drain).toHaveBeenCalledExactlyOnceWith(
      2,
      expect.objectContaining({ isCurrent: expect.any(Function) }),
    );
  });

  it("reports an in-flight failure after still draining the latest replacement", async () => {
    const mailbox = new LatestValueDrainMailbox<number>();
    const first = deferred();
    const failure = new Error("offline");
    const drained: number[] = [];
    const running = mailbox.offer("owner", 1, directQueue, async (value) => {
      drained.push(value);
      await first.promise;
      throw failure;
    });
    mailbox.offer("owner", 2, directQueue, async (value) => {
      drained.push(value);
    });

    first.resolve();
    await expect(running.settlement).rejects.toBe(failure);
    expect(drained).toEqual([1, 2]);
  });

  it("clear retires every queued owner generation", async () => {
    const mailbox = new LatestValueDrainMailbox<number>();
    const first = deferred();
    const drained: number[] = [];
    const published: number[] = [];
    const running = mailbox.offer("a", 1, directQueue, async (value, lease) => {
      drained.push(value);
      await first.promise;
      if (lease.isCurrent()) {
        published.push(value);
      }
    });
    mailbox.offer("a", 2, directQueue, async (value) => {
      drained.push(value);
    });

    mailbox.clear();
    first.resolve();
    await running.settlement;

    await mailbox.offer("a", 3, directQueue, async (value) => {
      drained.push(value);
    }).settlement;
    expect(drained).toEqual([1, 3]);
    expect(published).toEqual([]);
  });
});
