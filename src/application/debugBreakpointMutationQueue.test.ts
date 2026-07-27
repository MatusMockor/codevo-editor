import { describe, expect, it, vi } from "vitest";
import {
  BREAKPOINT_MUTATION_QUEUE_FULL_ERROR,
  DebugBreakpointMutationQueue,
  debugBreakpointMutationQueueKey,
} from "./debugBreakpointMutationQueue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("DebugBreakpointMutationQueue", () => {
  it("serializes one exact file and continues after rejection", async () => {
    const queue = new DebugBreakpointMutationQueue();
    const firstReply = deferred<void>();
    const first = queue.run("owner-file", () => firstReply.promise);
    const secondOperation = vi.fn(async () => "second");
    const second = queue.run("owner-file", secondOperation);

    expect(secondOperation).not.toHaveBeenCalled();
    firstReply.reject(new Error("first rejected"));
    await expect(first).rejects.toThrow("first rejected");
    await expect(second).resolves.toBe("second");
    expect(secondOperation).toHaveBeenCalledOnce();
  });

  it("does not serialize different exact owner/file keys", async () => {
    const queue = new DebugBreakpointMutationQueue();
    const blocked = deferred<void>();
    const first = queue.run("first", () => blocked.promise);
    const second = queue.run("second", async () => "ready");

    await expect(second).resolves.toBe("ready");
    blocked.resolve();
    await expect(first).resolves.toBeUndefined();
  });

  it("bounds a hostile queue without invoking excess operations", async () => {
    const queue = new DebugBreakpointMutationQueue();
    const blocked = deferred<void>();
    const operations = Array.from({ length: 32 }, (_, index) =>
      queue.run("same", index === 0 ? () => blocked.promise : async () => undefined),
    );
    const excess = vi.fn(async () => undefined);

    await expect(queue.run("same", excess)).rejects.toThrow(BREAKPOINT_MUTATION_QUEUE_FULL_ERROR);
    expect(excess).not.toHaveBeenCalled();
    blocked.resolve();
    await Promise.all(operations);
  });
});

describe("debugBreakpointMutationQueueKey", () => {
  it("separates same-root A to B to A generations and source files", () => {
    const root = "/workspace";
    expect(debugBreakpointMutationQueueKey(root, "a", 1, "/workspace/a.ts")).not.toBe(
      debugBreakpointMutationQueueKey(root, "a", 3, "/workspace/a.ts"),
    );
    expect(debugBreakpointMutationQueueKey(root, "a", 1, "/workspace/a.ts")).not.toBe(
      debugBreakpointMutationQueueKey(root, "b", 2, "/workspace/a.ts"),
    );
    expect(debugBreakpointMutationQueueKey(root, "a", 1, "/workspace/a.ts")).not.toBe(
      debugBreakpointMutationQueueKey(root, "a", 1, "/workspace/b.ts"),
    );
  });
});
