import { describe, expect, it, vi } from "vitest";
import {
  JS_TEST_CONTINUOUS_RUN_DEBOUNCE_MS,
  createJsTestContinuousRunCoordinator,
  type JsTestContinuousRunLease,
  type JsTestContinuousRunOwner,
  type JsTestContinuousRunScheduler,
} from "./jsTestContinuousRunCoordinator";

const ownerA: JsTestContinuousRunOwner = {
  epoch: 1,
  rootKey: "/workspace",
  workspaceId: "workspace-A",
};

describe("createJsTestContinuousRunCoordinator", () => {
  it("starts immediately and keeps an immutable exact lease", async () => {
    const clock = createClock();
    const run = vi.fn<(lease: JsTestContinuousRunLease) => Promise<boolean>>(async () => true);
    const mutableOwner = {
      epoch: 1,
      rootKey: "/workspace",
      workspaceId: "workspace-A",
    };
    const coordinator = createJsTestContinuousRunCoordinator({
      cancel: vi.fn(async () => true),
      run,
      scheduler: clock.scheduler,
    });

    expect(coordinator.enable(mutableOwner, 4)).toBe(true);
    mutableOwner.epoch = 99;
    expect(coordinator.snapshot()).toMatchObject({
      enabled: true,
      owner: { epoch: 1, rootKey: "/workspace", workspaceId: "workspace-A" },
      pending: true,
    });
    clock.advance(0);
    expect(run).toHaveBeenCalledOnce();
    expect(Object.isFrozen(run.mock.calls[0]![0])).toBe(true);
    expect(Object.isFrozen(run.mock.calls[0]![0].owner)).toBe(true);
    await flush();
    expect(coordinator.snapshot()).toMatchObject({ enabled: true, running: false });
  });

  it("debounces changes for 250ms and coalesces a burst", async () => {
    const clock = createClock();
    const run = vi.fn<(lease: JsTestContinuousRunLease) => Promise<boolean>>(async () => true);
    const coordinator = createJsTestContinuousRunCoordinator({
      cancel: vi.fn(async () => true),
      run,
      scheduler: clock.scheduler,
    });
    coordinator.enable(ownerA, 0);
    clock.advance(0);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);

    expect(coordinator.observeChange(ownerA, 1)).toBe(true);
    clock.advance(200);
    expect(coordinator.observeChange(ownerA, 2)).toBe(true);
    clock.advance(JS_TEST_CONTINUOUS_RUN_DEBOUNCE_MS - 1);
    expect(run).toHaveBeenCalledTimes(1);
    clock.advance(1);
    expect(run).toHaveBeenCalledTimes(2);
    await flush();
    expect(coordinator.snapshot().changeVersion).toBe(2);
  });

  it("coalesces dirty changes during a run into one quiet follow-up", async () => {
    const clock = createClock();
    const first = deferred<boolean>();
    const run = vi
      .fn<(lease: JsTestContinuousRunLease) => Promise<boolean>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(true);
    const coordinator = createJsTestContinuousRunCoordinator({
      cancel: vi.fn(async () => true),
      run,
      scheduler: clock.scheduler,
    });
    coordinator.enable(ownerA, 0);
    clock.advance(0);
    expect(coordinator.snapshot().running).toBe(true);

    coordinator.observeChange(ownerA, 1);
    clock.advance(200);
    coordinator.observeChange(ownerA, 2);
    clock.advance(100);
    first.resolve(true);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    clock.advance(149);
    expect(run).toHaveBeenCalledTimes(1);
    clock.advance(1);
    expect(run).toHaveBeenCalledTimes(2);
    await flush();
    expect(coordinator.snapshot()).toMatchObject({
      changeVersion: 2,
      enabled: true,
      pending: false,
      running: false,
    });
  });

  it("disables a pending timer without running and rejects a stale owner", async () => {
    const clock = createClock();
    const run = vi.fn<(lease: JsTestContinuousRunLease) => Promise<boolean>>(async () => true);
    const coordinator = createJsTestContinuousRunCoordinator({
      cancel: vi.fn(async () => true),
      run,
      scheduler: clock.scheduler,
    });
    coordinator.enable(ownerA, 0);
    expect(await coordinator.disable({ ...ownerA, epoch: ownerA.epoch + 1 })).toBe(false);
    expect(await coordinator.disable(ownerA)).toBe(true);
    clock.advance(1_000);
    expect(run).not.toHaveBeenCalled();
    expect(coordinator.snapshot().enabled).toBe(false);
  });

  it("cancels one exact active lease on disable and never a replacement", async () => {
    const clock = createClock();
    const running = deferred<boolean>();
    const cancel = vi.fn<(lease: JsTestContinuousRunLease) => Promise<boolean>>(async () => true);
    const coordinator = createJsTestContinuousRunCoordinator({
      cancel,
      run: vi.fn<(lease: JsTestContinuousRunLease) => Promise<boolean>>(() => running.promise),
      scheduler: clock.scheduler,
    });
    coordinator.enable(ownerA, 0);
    clock.advance(0);
    const stopping = coordinator.disable(ownerA);
    await expect(stopping).resolves.toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel.mock.calls[0]![0]).toMatchObject({
      owner: ownerA,
      sequence: 1,
    });
    expect(coordinator.snapshot()).toMatchObject({ enabled: false, stopping: true });
    expect(coordinator.enable({ ...ownerA, epoch: 2 }, 0)).toBe(false);

    running.resolve(true);
    await flush();
    expect(coordinator.snapshot().stopping).toBe(false);
    expect(await coordinator.disable(ownerA)).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("fails closed across owner A-B-A and late settlement", async () => {
    const clock = createClock();
    const oldRun = deferred<boolean>();
    const run = vi
      .fn<(lease: JsTestContinuousRunLease) => Promise<boolean>>()
      .mockReturnValueOnce(oldRun.promise)
      .mockResolvedValue(true);
    const coordinator = createJsTestContinuousRunCoordinator({
      cancel: vi.fn(async () => true),
      run,
      scheduler: clock.scheduler,
    });
    coordinator.enable(ownerA, 0);
    clock.advance(0);
    await coordinator.invalidate();
    expect(coordinator.enable(ownerA, 0)).toBe(false);
    oldRun.resolve(true);
    await flush();

    const ownerB = { ...ownerA, epoch: 2, workspaceId: "workspace-B" };
    expect(coordinator.enable(ownerB, 0)).toBe(true);
    expect(await coordinator.disable(ownerB)).toBe(true);
    const ownerAAgain = { ...ownerA, epoch: 3 };
    expect(coordinator.enable(ownerAAgain, 0)).toBe(true);
    expect(coordinator.observeChange(ownerA, 1)).toBe(false);
    expect(await coordinator.disable(ownerA)).toBe(false);
    clock.advance(0);
    await flush();
    expect(run.mock.calls[1]?.[0].owner).toEqual(ownerAAgain);
  });

  it("keeps a failed cancel fail-closed until the exact run settles", async () => {
    const clock = createClock();
    const running = deferred<boolean>();
    const coordinator = createJsTestContinuousRunCoordinator({
      cancel: vi.fn(async () => {
        throw new Error("stop failed");
      }),
      run: vi
        .fn<(lease: JsTestContinuousRunLease) => Promise<boolean>>()
        .mockRejectedValueOnce(new Error("run failed"))
        .mockReturnValueOnce(running.promise),
      scheduler: clock.scheduler,
    });
    coordinator.enable(ownerA, 0);
    clock.advance(0);
    await flush();
    expect(coordinator.snapshot().enabled).toBe(true);
    coordinator.observeChange(ownerA, 1);
    clock.advance(250);
    await expect(coordinator.disable(ownerA)).resolves.toBe(false);
    expect(coordinator.snapshot()).toMatchObject({ enabled: false, stopping: true });
    expect(coordinator.enable(ownerA, 1)).toBe(false);
    running.resolve(true);
    await flush();
    expect(coordinator.enable(ownerA, 1)).toBe(false);
    const replacementOwner = { ...ownerA, epoch: 2 };
    expect(coordinator.enable(replacementOwner, 1)).toBe(true);
    expect(await coordinator.disable(replacementOwner)).toBe(true);
    expect(coordinator.snapshot()).toEqual({
      changeVersion: null,
      enabled: false,
      owner: null,
      pending: false,
      running: false,
      stopping: false,
    });
  });

  it("rejects malformed owners, versions, duplicates, and stale changes", () => {
    const clock = createClock();
    const coordinator = createJsTestContinuousRunCoordinator({
      cancel: vi.fn(async () => true),
      run: vi.fn<(lease: JsTestContinuousRunLease) => Promise<boolean>>(async () => true),
      scheduler: clock.scheduler,
    });
    expect(coordinator.enable({ ...ownerA, workspaceId: "" }, 0)).toBe(false);
    expect(coordinator.enable(ownerA, -1)).toBe(false);
    expect(coordinator.enable(ownerA, 3)).toBe(true);
    expect(coordinator.enable(ownerA, 3)).toBe(false);
    expect(coordinator.observeChange(ownerA, 3)).toBe(false);
    expect(coordinator.observeChange(ownerA, 2)).toBe(false);
    expect(coordinator.observeChange({ ...ownerA, epoch: 2 }, 4)).toBe(false);
  });

  it("fences an uncleared timer with an exact generation token", async () => {
    const clock = createClock({ clearThrows: true });
    const run = vi.fn<(lease: JsTestContinuousRunLease) => Promise<boolean>>(async () => true);
    const coordinator = createJsTestContinuousRunCoordinator({
      cancel: vi.fn(async () => true),
      run,
      scheduler: clock.scheduler,
    });
    coordinator.enable(ownerA, 0);
    coordinator.observeChange(ownerA, 1);

    clock.advance(0);
    expect(run).not.toHaveBeenCalled();
    clock.advance(249);
    expect(run).not.toHaveBeenCalled();
    clock.advance(1);
    expect(run).toHaveBeenCalledOnce();
    await flush();
  });

  it("rolls back cleanly when scheduling throws", () => {
    const clock = createClock();
    clock.failNextSchedule();
    const coordinator = createJsTestContinuousRunCoordinator({
      cancel: vi.fn(async () => true),
      run: vi.fn(async () => true),
      scheduler: clock.scheduler,
    });

    expect(coordinator.enable(ownerA, 0)).toBe(false);
    expect(coordinator.snapshot()).toEqual({
      changeVersion: null,
      enabled: false,
      owner: null,
      pending: false,
      running: false,
      stopping: false,
    });
  });

  it("does not consume an observed version when scheduling throws", async () => {
    const clock = createClock();
    const run = vi.fn<(lease: JsTestContinuousRunLease) => Promise<boolean>>(async () => true);
    const coordinator = createJsTestContinuousRunCoordinator({
      cancel: vi.fn(async () => true),
      run,
      scheduler: clock.scheduler,
    });
    coordinator.enable(ownerA, 0);
    clock.advance(0);
    await flush();

    clock.failNextSchedule();
    expect(coordinator.observeChange(ownerA, 1)).toBe(false);
    expect(coordinator.snapshot()).toMatchObject({ changeVersion: 0, pending: false });
    expect(coordinator.observeChange(ownerA, 1)).toBe(true);
    clock.advance(250);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each(["throws", "returns NaN"] as const)(
    "settles a debounce once when the scheduler clock %s",
    async (clockFailure) => {
      const clock = createClock();
      const run = vi.fn<(lease: JsTestContinuousRunLease) => Promise<boolean>>(async () => true);
      const coordinator = createJsTestContinuousRunCoordinator({
        cancel: vi.fn(async () => true),
        run,
        scheduler: {
          ...clock.scheduler,
          now: () => {
            if (clockFailure === "throws") throw new Error("clock failed");
            return Number.NaN;
          },
        },
      });
      coordinator.enable(ownerA, 0);
      clock.advance(0);
      await flush();
      coordinator.observeChange(ownerA, 1);
      clock.advance(250);
      await flush();
      clock.advance(10_000);
      expect(run).toHaveBeenCalledTimes(2);
    },
  );

  it("does not spin after a busy admission and retries only on a newer change", async () => {
    const clock = createClock();
    const run = vi
      .fn<(lease: JsTestContinuousRunLease) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const coordinator = createJsTestContinuousRunCoordinator({
      cancel: vi.fn(async () => true),
      run,
      scheduler: clock.scheduler,
    });
    coordinator.enable(ownerA, 0);
    clock.advance(0);
    await flush();
    clock.advance(10_000);
    expect(run).toHaveBeenCalledOnce();
    expect(coordinator.snapshot()).toMatchObject({ enabled: true, pending: false });

    coordinator.observeChange(ownerA, 1);
    clock.advance(250);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("fails closed and retires the owner at the lease sequence boundary", () => {
    const clock = createClock();
    const run = vi.fn<(lease: JsTestContinuousRunLease) => Promise<boolean>>(async () => true);
    const coordinator = createJsTestContinuousRunCoordinator({
      cancel: vi.fn(async () => true),
      initialSequence: Number.MAX_SAFE_INTEGER,
      run,
      scheduler: clock.scheduler,
    });
    coordinator.enable(ownerA, 0);
    clock.advance(0);
    expect(run).not.toHaveBeenCalled();
    expect(coordinator.snapshot().enabled).toBe(false);
    expect(coordinator.enable(ownerA, 1)).toBe(false);
    expect(coordinator.enable({ ...ownerA, epoch: 2 }, 1)).toBe(true);
  });
});

function createClock({ clearThrows = false }: { clearThrows?: boolean } = {}) {
  let now = 0;
  let nextId = 0;
  let scheduleThrows = false;
  const tasks = new Map<number, { at: number; callback: () => void }>();
  const scheduler: JsTestContinuousRunScheduler = {
    clear(handle) {
      if (clearThrows) throw new Error("clear failed");
      tasks.delete(handle as number);
    },
    now: () => now,
    schedule(callback, delayMs) {
      if (scheduleThrows) {
        scheduleThrows = false;
        throw new Error("schedule failed");
      }
      nextId += 1;
      tasks.set(nextId, { at: now + delayMs, callback });
      return nextId;
    },
  };
  return {
    advance(milliseconds: number) {
      const target = now + milliseconds;
      while (true) {
        const due = [...tasks.entries()]
          .filter(([, task]) => task.at <= target)
          .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
        if (!due) break;
        tasks.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = target;
    },
    failNextSchedule() {
      scheduleThrows = true;
    },
    scheduler,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
