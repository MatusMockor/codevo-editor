import { describe, expect, it, vi } from "vitest";
import {
  LanguageServerInteractiveRequestScheduler,
  MAX_CANCELLATION_REQUESTS_IN_FLIGHT,
  MAX_DECORATIVE_REQUEST_DEFERRAL_MS,
  MAX_DECORATIVE_REQUESTS_IN_FLIGHT,
  MAX_DEFERRED_DECORATIVE_REQUESTS,
  MAX_IMMEDIATE_REQUESTS_IN_FLIGHT,
  MAX_RETAINED_DISPATCHED_HANDLES,
} from "./languageServerRequestPriority";

interface DeferredTimer {
  readonly callback: () => void;
  cleared: boolean;
  readonly delayMs: number;
}

function createSchedulerHarness(initialRequestId = 100) {
  const timers: DeferredTimer[] = [];
  let nextRequestId = initialRequestId;
  const scheduler = new LanguageServerInteractiveRequestScheduler({
    allocateRequestId: () => {
      nextRequestId += 1;
      return nextRequestId;
    },
    clearTimer: (handle) => {
      const timer = timers[handle as unknown as number];
      if (timer) {
        timer.cleared = true;
      }
    },
    setTimer: (callback, delayMs) => {
      timers.push({ callback, cleared: false, delayMs });
      return (timers.length - 1) as unknown as ReturnType<typeof setTimeout>;
    },
  });
  return { scheduler, timers };
}

function deferredRequest<T>(value: T) {
  let settle: (result: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle: () => settle(value) };
}

describe("LanguageServerInteractiveRequestScheduler", () => {
  it("dispatches decorative requests immediately when no interactive request is in flight", async () => {
    const { scheduler } = createSchedulerHarness();
    const dispatch = vi.fn(async () => "highlights");

    await expect(
      scheduler.schedule("/project", "decorative", 7, "fallback", dispatch),
    ).resolves.toBe("highlights");
    expect(dispatch).toHaveBeenCalledWith(7);
  });

  it("defers a decorative request while an interactive request is in flight", async () => {
    const { scheduler } = createSchedulerHarness();
    const interactive = deferredRequest("definition");
    const decorativeDispatch = vi.fn(async () => "highlights");

    const interactivePromise = scheduler.schedule(
      "/project",
      "interactive",
      1,
      null,
      async () => interactive.promise,
    );
    const decorativePromise = scheduler.schedule(
      "/project",
      "decorative",
      2,
      "fallback",
      decorativeDispatch,
    );

    await Promise.resolve();
    expect(decorativeDispatch).not.toHaveBeenCalled();

    interactive.settle();
    await expect(interactivePromise).resolves.toBe("definition");
    await expect(decorativePromise).resolves.toBe("highlights");
    expect(decorativeDispatch).toHaveBeenCalledTimes(1);
  });

  it("re-stamps a released decorative request with a newer wire request identifier", async () => {
    const { scheduler } = createSchedulerHarness(900);
    const interactive = deferredRequest("definition");
    const decorativeDispatch = vi.fn(async () => "highlights");

    const interactivePromise = scheduler.schedule(
      "/project",
      "interactive",
      501,
      null,
      async () => interactive.promise,
    );
    const decorativePromise = scheduler.schedule(
      "/project",
      "decorative",
      502,
      "fallback",
      decorativeDispatch,
    );
    interactive.settle();
    await interactivePromise;
    await decorativePromise;

    const [wireRequestId] = decorativeDispatch.mock.calls[0] as unknown as [number];
    expect(wireRequestId).toBeGreaterThan(502);
  });

  it("settles an expired decorative request with its fallback while interactive work remains", async () => {
    const { scheduler, timers } = createSchedulerHarness();
    const interactive = deferredRequest("definition");
    const decorativeDispatch = vi.fn(async () => "highlights");

    const interactivePromise = scheduler.schedule(
      "/project",
      "interactive",
      1,
      null,
      async () => interactive.promise,
    );
    const decorativePromise = scheduler.schedule(
      "/project",
      "decorative",
      2,
      "fallback",
      decorativeDispatch,
    );

    expect(timers).toHaveLength(1);
    expect(timers[0]?.delayMs).toBe(MAX_DECORATIVE_REQUEST_DEFERRAL_MS);
    timers[0]?.callback();

    await expect(decorativePromise).resolves.toBe("fallback");
    expect(decorativeDispatch).not.toHaveBeenCalled();

    interactive.settle();
    await interactivePromise;
    expect(decorativeDispatch).not.toHaveBeenCalled();
  });

  it("never defers more decorative requests than the queue capacity", async () => {
    const { scheduler } = createSchedulerHarness();
    const interactive = deferredRequest("definition");
    const dispatch = vi.fn(async () => "highlights");

    const interactivePromise = scheduler.schedule(
      "/project",
      "interactive",
      1,
      null,
      async () => interactive.promise,
    );
    const decorative = Array.from({ length: MAX_DEFERRED_DECORATIVE_REQUESTS + 4 }, (_, index) =>
      scheduler.schedule("/project", "decorative", 100 + index, "fallback", dispatch),
    );

    await Promise.resolve();
    expect(dispatch).not.toHaveBeenCalled();

    await expect(Promise.all(decorative.slice(0, 4))).resolves.toEqual(
      Array.from({ length: 4 }, () => "fallback"),
    );

    interactive.settle();
    await interactivePromise;
    await Promise.all(decorative);
    expect(dispatch).toHaveBeenCalledTimes(MAX_DEFERRED_DECORATIVE_REQUESTS);
  });

  it("drops overflow with fallbacks instead of flooding the backend during a decorative storm", async () => {
    const { scheduler } = createSchedulerHarness();
    const interactive = deferredRequest("definition");
    const firstDecorative = deferredRequest("highlights");
    const dispatch = vi
      .fn<(wireRequestId: number) => Promise<string>>()
      .mockImplementationOnce(async () => firstDecorative.promise)
      .mockImplementation(async () => "highlights");

    const interactivePromise = scheduler.schedule(
      "/project",
      "interactive",
      1,
      null,
      async () => interactive.promise,
    );
    const requestCount = MAX_DEFERRED_DECORATIVE_REQUESTS * 4;
    const decorative = Array.from({ length: requestCount }, (_, index) =>
      scheduler.schedule("/project", "decorative", 100 + index, "fallback", dispatch),
    );

    await Promise.resolve();
    expect(dispatch).not.toHaveBeenCalled();
    await expect(
      Promise.all(decorative.slice(0, requestCount - MAX_DEFERRED_DECORATIVE_REQUESTS)),
    ).resolves.toEqual(
      Array.from({ length: requestCount - MAX_DEFERRED_DECORATIVE_REQUESTS }, () => "fallback"),
    );

    interactive.settle();
    await interactivePromise;
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledTimes(1);

    firstDecorative.settle();
    await Promise.all(decorative);
    expect(dispatch).toHaveBeenCalledTimes(MAX_DEFERRED_DECORATIVE_REQUESTS);
  });

  it("bounds a decorative storm even when it starts while the workspace is idle", async () => {
    const { scheduler } = createSchedulerHarness();
    const firstDecorative = deferredRequest("first highlights");
    const dispatch = vi
      .fn<(wireRequestId: number) => Promise<string>>()
      .mockImplementationOnce(async () => firstDecorative.promise)
      .mockImplementation(async () => "later highlights");
    const requestCount = MAX_DEFERRED_DECORATIVE_REQUESTS * 4;

    const decorative = Array.from({ length: requestCount }, (_, index) =>
      scheduler.schedule("/project", "decorative", 100 + index, "fallback", dispatch),
    );

    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledTimes(1);
    await expect(
      Promise.all(decorative.slice(1, requestCount - MAX_DEFERRED_DECORATIVE_REQUESTS)),
    ).resolves.toEqual(
      Array.from({ length: requestCount - MAX_DEFERRED_DECORATIVE_REQUESTS - 1 }, () => "fallback"),
    );

    firstDecorative.settle();
    await Promise.all(decorative);
    expect(dispatch).toHaveBeenCalledTimes(MAX_DEFERRED_DECORATIVE_REQUESTS + 1);
  });

  it("stops draining deferred decoration when later interactive work is admitted", async () => {
    const { scheduler } = createSchedulerHarness();
    const firstInteractive = deferredRequest("definition");
    const laterInteractive = deferredRequest("references");
    const firstDecorative = deferredRequest("first highlights");
    const dispatch = vi
      .fn<(wireRequestId: number) => Promise<string>>()
      .mockImplementationOnce(async () => firstDecorative.promise)
      .mockImplementation(async () => "later highlights");

    const firstInteractivePromise = scheduler.schedule(
      "/project",
      "interactive",
      1,
      null,
      async () => firstInteractive.promise,
    );
    const firstDecorativePromise = scheduler.schedule(
      "/project",
      "decorative",
      2,
      "fallback",
      dispatch,
    );
    const secondDecorativePromise = scheduler.schedule(
      "/project",
      "decorative",
      3,
      "fallback",
      dispatch,
    );

    firstInteractive.settle();
    await firstInteractivePromise;
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledTimes(1);

    const laterInteractivePromise = scheduler.schedule(
      "/project",
      "interactive",
      4,
      null,
      async () => laterInteractive.promise,
    );
    firstDecorative.settle();
    await firstDecorativePromise;
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledTimes(1);

    laterInteractive.settle();
    await laterInteractivePromise;
    await expect(secondDecorativePromise).resolves.toBe("later highlights");
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("isolates the interactive gate per workspace root", async () => {
    const { scheduler } = createSchedulerHarness();
    const interactive = deferredRequest("definition");
    const dispatch = vi.fn(async () => "highlights");

    const interactivePromise = scheduler.schedule(
      "/project-a",
      "interactive",
      1,
      null,
      async () => interactive.promise,
    );
    await expect(
      scheduler.schedule("/project-b", "decorative", 2, "fallback", dispatch),
    ).resolves.toBe("highlights");

    interactive.settle();
    await interactivePromise;
  });

  it("drops a deferred decorative request when its cancellation arrives", async () => {
    const { scheduler, timers } = createSchedulerHarness();
    const interactive = deferredRequest("definition");
    const dispatch = vi.fn(async () => "highlights");

    const interactivePromise = scheduler.schedule(
      "/project",
      "interactive",
      1,
      null,
      async () => interactive.promise,
    );
    const decorativePromise = scheduler.schedule("/project", "decorative", 2, "fallback", dispatch);

    expect(scheduler.resolveCancellation("/project", 2)).toEqual({ kind: "dropped" });
    await expect(decorativePromise).resolves.toBe("fallback");
    expect(dispatch).not.toHaveBeenCalled();
    expect(timers[0]?.cleared).toBe(true);

    interactive.settle();
    await interactivePromise;
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects foreign-scope cancellation without dropping a deferred owner", async () => {
    const { scheduler } = createSchedulerHarness();
    const interactive = deferredRequest("definition");
    const interactivePromise = scheduler.schedule(
      "scope-a",
      "interactive",
      1,
      null,
      async () => interactive.promise,
    );
    const decorativePromise = scheduler.schedule(
      "scope-a",
      "decorative",
      2,
      "fallback",
      async () => "highlights",
    );

    expect(scheduler.resolveCancellation("scope-b", 2)).toEqual({ kind: "foreign" });
    interactive.settle();
    await interactivePromise;
    await expect(decorativePromise).resolves.toBe("highlights");
  });

  it("maps a released decorative handle to its dispatched wire request identifier", async () => {
    const { scheduler } = createSchedulerHarness(900);
    const interactive = deferredRequest("definition");
    const decorative = deferredRequest("highlights");

    const interactivePromise = scheduler.schedule(
      "/project",
      "interactive",
      701,
      null,
      async () => interactive.promise,
    );
    const decorativePromise = scheduler.schedule(
      "/project",
      "decorative",
      702,
      "fallback",
      async () => decorative.promise,
    );
    interactive.settle();
    await interactivePromise;
    await Promise.resolve();

    const target = scheduler.resolveCancellation("/project", 702);
    expect(target.kind).toBe("dispatched");
    expect(target.kind === "dispatched" && target.wireRequestId).toBeGreaterThan(702);

    decorative.settle();
    await decorativePromise;
    expect(scheduler.resolveCancellation("/project", 702)).toEqual({ kind: "unknown" });
  });

  it("retains cancellation authority at the global decorative admission boundary", async () => {
    const { scheduler } = createSchedulerHarness(10_000);
    const backend = deferredRequest("highlights");
    const dispatch = vi.fn(async () => backend.promise);
    const interactiveRequests = Array.from(
      { length: MAX_DECORATIVE_REQUESTS_IN_FLIGHT + 1 },
      (_, index) => deferredRequest(`definition ${index}`),
    );
    const interactivePromises = interactiveRequests.map((request, index) =>
      scheduler.schedule(`/project-${index}`, "interactive", index + 1, null, async () =>
        request.promise.then(() => null),
      ),
    );
    const decorative = interactiveRequests.map((_, index) =>
      scheduler.schedule(`/project-${index}`, "decorative", 1_000 + index, "fallback", dispatch),
    );

    for (const request of interactiveRequests) {
      request.settle();
    }
    await Promise.all(interactivePromises);
    await Promise.resolve();

    expect(dispatch).toHaveBeenCalledTimes(MAX_DEFERRED_DECORATIVE_REQUESTS);
    await expect(
      Promise.all(decorative.slice(0, decorative.length - MAX_DEFERRED_DECORATIVE_REQUESTS)),
    ).resolves.toEqual(
      Array.from(
        { length: decorative.length - MAX_DEFERRED_DECORATIVE_REQUESTS },
        () => "fallback",
      ),
    );
    const firstRetainedIndex = decorative.length - MAX_DEFERRED_DECORATIVE_REQUESTS;
    expect(
      scheduler.resolveCancellation(`/project-${firstRetainedIndex}`, 1_000 + firstRetainedIndex)
        .kind,
    ).toBe("dispatched");

    backend.settle();
    await Promise.all(decorative);
  });

  it("does not resolve a dispatched cancellation mapping from another scope", async () => {
    const { scheduler } = createSchedulerHarness(900);
    const interactive = deferredRequest("definition");
    const decorative = deferredRequest("highlights");
    const interactivePromise = scheduler.schedule(
      "/project-a",
      "interactive",
      701,
      null,
      async () => interactive.promise,
    );
    const decorativePromise = scheduler.schedule(
      "/project-a",
      "decorative",
      702,
      "fallback",
      async () => decorative.promise,
    );

    interactive.settle();
    await interactivePromise;
    await Promise.resolve();
    expect(scheduler.resolveCancellation("/project-b", 702)).toEqual({ kind: "foreign" });
    expect(scheduler.resolveCancellation("/project-a", 702).kind).toBe("dispatched");

    decorative.settle();
    await decorativePromise;
  });

  it("retains exact scope authority when the initial wire and handle identifiers match", async () => {
    const { scheduler } = createSchedulerHarness();
    const decorative = deferredRequest("highlights");
    const decorativePromise = scheduler.schedule(
      "scope-a",
      "decorative",
      702,
      "fallback",
      async () => decorative.promise,
    );

    expect(scheduler.resolveCancellation("scope-b", 702)).toEqual({ kind: "foreign" });
    expect(scheduler.resolveCancellation("scope-a", 702)).toEqual({
      kind: "dispatched",
      wireRequestId: 702,
    });
    decorative.settle();
    await decorativePromise;
  });

  it("cleans up after synchronous dispatch and restamp allocation failures", async () => {
    let allocationShouldFail = true;
    let nextRequestId = 100;
    const scheduler = new LanguageServerInteractiveRequestScheduler({
      allocateRequestId: () => {
        if (allocationShouldFail) {
          allocationShouldFail = false;
          throw new Error("allocation failed");
        }
        nextRequestId += 1;
        return nextRequestId;
      },
    });
    const interactive = deferredRequest("definition");
    const interactivePromise = scheduler.schedule(
      "/project",
      "interactive",
      1,
      null,
      async () => interactive.promise,
    );
    const allocationFailure = scheduler.schedule(
      "/project",
      "decorative",
      2,
      "fallback",
      async () => "unreachable",
    );

    interactive.settle();
    await interactivePromise;
    await expect(allocationFailure).rejects.toThrow("allocation failed");

    await expect(
      scheduler.schedule("/project", "decorative", 3, "fallback", () => {
        throw new Error("dispatch failed");
      }),
    ).rejects.toThrow("dispatch failed");
    await expect(
      scheduler.schedule("/project", "decorative", 4, "fallback", async () => "healthy"),
    ).resolves.toBe("healthy");

    await expect(
      scheduler.schedule("/project", "interactive", 5, null, () => {
        throw new Error("interactive failed");
      }),
    ).rejects.toThrow("interactive failed");
    await expect(
      scheduler.schedule("/project", "decorative", 6, "fallback", async () => "reopened"),
    ).resolves.toBe("reopened");
  });

  it("reports an unknown cancellation target for requests that were never deferred", () => {
    const { scheduler } = createSchedulerHarness();

    expect(scheduler.resolveCancellation("/project", 42)).toEqual({ kind: "unknown" });
  });

  it("keeps the gate closed until every interactive request settles and reopens after failures", async () => {
    const { scheduler } = createSchedulerHarness();
    const first = deferredRequest("definition");
    const second = deferredRequest("references");
    const dispatch = vi.fn(async () => "highlights");

    const firstPromise = scheduler.schedule(
      "/project",
      "interactive",
      1,
      null,
      async () => first.promise,
    );
    const secondPromise = scheduler.schedule("/project", "interactive", 2, null, async () => {
      await second.promise;
      throw new Error("references failed");
    });
    const decorativePromise = scheduler.schedule("/project", "decorative", 3, "fallback", dispatch);

    first.settle();
    await firstPromise;
    await Promise.resolve();
    expect(dispatch).not.toHaveBeenCalled();

    second.settle();
    await expect(secondPromise).rejects.toThrow("references failed");
    await expect(decorativePromise).resolves.toBe("highlights");
  });

  it("bounds the deferred queue globally across many authority scopes", async () => {
    const { scheduler } = createSchedulerHarness(20_000);
    const scopeCount = MAX_DEFERRED_DECORATIVE_REQUESTS + 8;
    const interactiveOwners = Array.from({ length: scopeCount }, (_, index) =>
      deferredRequest(`definition-${index}`),
    );
    const interactive = interactiveOwners.map((owner, index) =>
      scheduler.schedule(
        `scope-${index}`,
        "interactive",
        index + 1,
        null,
        async () => owner.promise,
      ),
    );
    const decorativeDispatch = vi.fn(async () => "highlights");
    const decorative = interactiveOwners.map((_, index) =>
      scheduler.schedule(
        `scope-${index}`,
        "decorative",
        1_000 + index,
        "fallback",
        decorativeDispatch,
      ),
    );

    await expect(Promise.all(decorative.slice(0, 8))).resolves.toEqual(
      Array.from({ length: 8 }, () => "fallback"),
    );
    for (const owner of interactiveOwners) owner.settle();
    await Promise.all(interactive);
    await expect(Promise.all(decorative)).resolves.toEqual([
      ...Array.from({ length: 8 }, () => "fallback"),
      ...Array.from({ length: MAX_DEFERRED_DECORATIVE_REQUESTS }, () => "highlights"),
    ]);
    expect(decorativeDispatch).toHaveBeenCalledTimes(MAX_DEFERRED_DECORATIVE_REQUESTS);
  });

  it("reserves globally bounded dispatch capacity for interactive requests during a decorative storm", async () => {
    const { scheduler } = createSchedulerHarness(30_000);
    const decorativeOwner = deferredRequest("decorative");
    const decorativeDispatch = vi.fn(async () => decorativeOwner.promise);
    const decorative = Array.from({ length: MAX_DECORATIVE_REQUESTS_IN_FLIGHT }, (_, index) =>
      scheduler.schedule(
        `decorative-${index}`,
        "decorative",
        1_000 + index,
        "fallback",
        decorativeDispatch,
      ),
    );
    await Promise.resolve();
    expect(decorativeDispatch).toHaveBeenCalledTimes(MAX_DECORATIVE_REQUESTS_IN_FLIGHT);
    await expect(
      scheduler.schedule(
        "decorative-overflow",
        "decorative",
        9_000,
        "fallback",
        decorativeDispatch,
      ),
    ).resolves.toBe("fallback");

    const interactiveOwner = deferredRequest("interactive");
    const interactiveDispatch = vi.fn(async () => interactiveOwner.promise);
    const interactiveCapacity = MAX_RETAINED_DISPATCHED_HANDLES - MAX_DECORATIVE_REQUESTS_IN_FLIGHT;
    const interactive = Array.from({ length: interactiveCapacity }, (_, index) =>
      scheduler.schedule(
        `interactive-${index}`,
        "interactive",
        10_000 + index,
        null,
        interactiveDispatch,
      ),
    );
    await Promise.resolve();
    expect(interactiveDispatch).toHaveBeenCalledTimes(interactiveCapacity);
    await expect(
      scheduler.schedule("interactive-overflow", "interactive", 19_000, null, interactiveDispatch),
    ).resolves.toBeNull();

    decorativeOwner.settle();
    interactiveOwner.settle();
    await Promise.all([...decorative, ...interactive]);
  });

  it("bounds immediate work separately while preserving a reserved cancellation lane", async () => {
    const { scheduler } = createSchedulerHarness(40_000);
    const immediateOwner = deferredRequest("immediate");
    const immediateDispatch = vi.fn(async () => immediateOwner.promise);
    const immediate = Array.from({ length: MAX_IMMEDIATE_REQUESTS_IN_FLIGHT }, (_, index) =>
      scheduler.schedule(
        `immediate-${index}`,
        "immediate",
        undefined,
        "fallback",
        immediateDispatch,
      ),
    );
    await expect(
      scheduler.schedule(
        "immediate-overflow",
        "immediate",
        undefined,
        "fallback",
        immediateDispatch,
      ),
    ).resolves.toBe("fallback");

    const prioritizedOwner = deferredRequest("interactive");
    const prioritized = Array.from({ length: MAX_RETAINED_DISPATCHED_HANDLES }, (_, index) =>
      scheduler.schedule(
        `interactive-live-${index}`,
        "interactive",
        50_000 + index,
        null,
        async () => prioritizedOwner.promise,
      ),
    );

    const cancellationOwner = deferredRequest("cancelled");
    const cancellationDispatch = vi.fn(async () => cancellationOwner.promise);
    const cancellations = Array.from({ length: MAX_CANCELLATION_REQUESTS_IN_FLIGHT }, (_, index) =>
      scheduler.schedule(
        `cancel-${index}`,
        "cancellation",
        undefined,
        "fallback",
        cancellationDispatch,
      ),
    );
    expect(cancellationDispatch).toHaveBeenCalledTimes(MAX_CANCELLATION_REQUESTS_IN_FLIGHT);
    await expect(
      scheduler.schedule(
        "cancel-overflow",
        "cancellation",
        undefined,
        "fallback",
        cancellationDispatch,
      ),
    ).rejects.toThrow("cancellation capacity");

    immediateOwner.settle();
    prioritizedOwner.settle();
    cancellationOwner.settle();
    await Promise.all([...immediate, ...prioritized, ...cancellations]);
  });
});
