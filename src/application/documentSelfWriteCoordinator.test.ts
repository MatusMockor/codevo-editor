import { describe, expect, it, vi } from "vitest";
import { DocumentSelfWriteCoordinator } from "./documentSelfWriteCoordinator";

const ownership = {
  canonicalRoot: "/workspace",
  workspaceRelativePath: "new.php",
};

const revision = (value: number) => ({
  contentHash: String(value),
  device: "1",
  inode: "2",
  modifiedNanoseconds: value,
  modifiedSeconds: value,
  size: value,
});

describe("DocumentSelfWriteCoordinator", () => {
  it("waits for an issued write and consumes only its exact snapshot", async () => {
    const coordinator = new DocumentSelfWriteCoordinator();
    const lease = coordinator.begin(ownership, "saved content");
    const pending = coordinator.waitForExpectations(ownership);

    lease?.complete(revision(2));
    const [expectation] = await pending;

    expect(expectation).toBeDefined();
    expect(coordinator.consumeMatchingSnapshot(ownership, expectation, {
      content: "saved content",
      revision: revision(2),
    })).toBe(true);
    expect(await coordinator.waitForExpectations(ownership, { timeoutMs: 0 }))
      .toEqual([]);
  });

  it("does not consume content or trusted revisions from another write", async () => {
    const coordinator = new DocumentSelfWriteCoordinator();
    const lease = coordinator.begin(ownership, "saved content");
    lease?.complete(revision(2));
    const [expectation] = await coordinator.waitForExpectations(ownership);

    expect(coordinator.consumeMatchingSnapshot(ownership, expectation, {
      content: "external content",
      revision: revision(2),
    })).toBe(false);
    expect(coordinator.consumeMatchingSnapshot(ownership, expectation, {
      content: "saved content",
      revision: revision(3),
    })).toBe(false);
  });

  it("releases watcher waits when an issued write fails", async () => {
    const coordinator = new DocumentSelfWriteCoordinator();
    const lease = coordinator.begin(ownership, "saved content");
    const pending = coordinator.waitForExpectations(ownership);

    lease?.abort();

    await expect(pending).resolves.toEqual([]);
  });

  it("does not reuse a completed expectation after its root is disposed", async () => {
    const coordinator = new DocumentSelfWriteCoordinator();
    const lease = coordinator.begin(ownership, "old content");
    lease?.complete(revision(1));

    coordinator.clearRoot("/workspace/");
    const nextLease = coordinator.begin(ownership, "new content");
    nextLease?.complete(revision(2));
    const expectations = await coordinator.waitForExpectations(ownership);

    expect(expectations).toHaveLength(1);
    expect(expectations[0].content).toBe("new content");
  });

  it("never treats a missing write revision as a trusted revision wildcard", async () => {
    const coordinator = new DocumentSelfWriteCoordinator();
    const lease = coordinator.begin(ownership, "same content");
    lease?.complete(null);
    const [expectation] = await coordinator.waitForExpectations(ownership);

    expect(coordinator.consumeMatchingSnapshot(ownership, expectation, {
      content: "same content",
      revision: revision(2),
    })).toBe(false);
  });

  it("matches rapid sequential writes without replacing either expectation", async () => {
    const coordinator = new DocumentSelfWriteCoordinator();
    const first = coordinator.begin(ownership, "first");
    const firstWait = coordinator.waitForExpectations(ownership);
    const second = coordinator.begin(ownership, "second");
    const secondWait = coordinator.waitForExpectations(ownership);

    second?.complete(revision(2));
    first?.complete(revision(1));
    const firstExpectations = await firstWait;
    const secondExpectations = await secondWait;

    expect(firstExpectations.map(({ content }) => content)).toEqual(["first"]);
    expect(secondExpectations.map(({ content }) => content)).toEqual([
      "first",
      "second",
    ]);
    expect(coordinator.consumeMatchingSnapshot(
      ownership,
      secondExpectations[1],
      { content: "second", revision: revision(2) },
    )).toBe(true);
    expect(await coordinator.waitForExpectations(ownership, { timeoutMs: 0 }))
      .toEqual([]);
  });

  it("bounds and cancels watcher waits without consuming the expectation", async () => {
    vi.useFakeTimers();
    try {
      const coordinator = new DocumentSelfWriteCoordinator();
      coordinator.begin(ownership, "saved content");
      const timedWait = coordinator.waitForExpectations(ownership, {
        timeoutMs: 25,
      });
      await vi.advanceTimersByTimeAsync(25);
      await expect(timedWait).resolves.toEqual([]);

      const controller = new AbortController();
      const cancelledWait = coordinator.waitForExpectations(ownership, {
        signal: controller.signal,
        timeoutMs: 1_000,
      });
      controller.abort();
      await expect(cancelledWait).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
