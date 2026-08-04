import { describe, expect, it, vi } from "vitest";
import {
  CoalescedCommitScheduler,
  DEFAULT_COALESCED_COMMIT_WINDOW,
} from "./coalescedCommitScheduler";

interface FakeClock {
  readonly timers: Map<number, { readonly dueAt: number; readonly callback: () => void }>;
  readonly scheduler: CoalescedCommitScheduler;
  readonly commits: number[];
  advance(ms: number): void;
  fireDue(): void;
}

function fakeClock(window = DEFAULT_COALESCED_COMMIT_WINDOW): FakeClock {
  const timers = new Map<number, { readonly dueAt: number; readonly callback: () => void }>();
  const commits: number[] = [];
  let now = 0;
  let nextHandle = 1;
  const scheduler = new CoalescedCommitScheduler(
    () => {
      commits.push(now);
    },
    window,
    {
      clearTimeout: (handle) => {
        timers.delete(handle);
      },
      now: () => now,
      setTimeout: (callback, delayMs) => {
        const handle = nextHandle;
        nextHandle += 1;
        timers.set(handle, { callback, dueAt: now + delayMs });
        return handle;
      },
    },
  );

  return {
    advance: (ms) => {
      now += ms;
    },
    commits,
    fireDue: () => {
      for (const [handle, timer] of [...timers]) {
        if (timer.dueAt > now) {
          continue;
        }
        timers.delete(handle);
        timer.callback();
      }
    },
    scheduler,
    timers,
  };
}

describe("CoalescedCommitScheduler", () => {
  it("commits the first coalescable change immediately", () => {
    const clock = fakeClock();

    clock.scheduler.commitCoalesced();

    expect(clock.commits).toEqual([0]);
  });

  it("defers every further change inside the debounce window", () => {
    const clock = fakeClock();
    clock.scheduler.commitCoalesced();

    for (let keystroke = 0; keystroke < 20; keystroke += 1) {
      clock.advance(16);
      clock.scheduler.commitCoalesced();
    }

    expect(clock.commits).toEqual([0]);
  });

  it("commits once the debounce window elapses without further changes", () => {
    const clock = fakeClock();
    clock.scheduler.commitCoalesced();
    clock.advance(16);
    clock.scheduler.commitCoalesced();

    clock.advance(DEFAULT_COALESCED_COMMIT_WINDOW.debounceMs);
    clock.fireDue();

    expect(clock.commits).toHaveLength(2);
  });

  it("bounds staleness by committing at the max wait during a continuous burst", () => {
    const clock = fakeClock({ debounceMs: 120, maxWaitMs: 1000 });
    clock.scheduler.commitCoalesced();

    for (let keystroke = 0; keystroke < 200; keystroke += 1) {
      clock.advance(16);
      clock.scheduler.commitCoalesced();
      clock.fireDue();
    }

    expect(clock.commits.length).toBeGreaterThanOrEqual(3);
    expect(clock.commits.length).toBeLessThanOrEqual(6);
  });

  it("keeps deferring when the commit itself outlasts the debounce window", () => {
    const timers = new Map<number, { readonly dueAt: number; readonly callback: () => void }>();
    const commits: number[] = [];
    let now = 0;
    let nextHandle = 1;
    const scheduler = new CoalescedCommitScheduler(
      () => {
        commits.push(now);
        now += 250;
      },
      { debounceMs: 120, maxWaitMs: 1000 },
      {
        clearTimeout: (handle) => {
          timers.delete(handle);
        },
        now: () => now,
        setTimeout: (callback, delayMs) => {
          const handle = nextHandle;
          nextHandle += 1;
          timers.set(handle, { callback, dueAt: now + delayMs });
          return handle;
        },
      },
    );

    for (let keystroke = 0; keystroke < 40; keystroke += 1) {
      scheduler.commitCoalesced();
      for (const [handle, timer] of [...timers]) {
        if (timer.dueAt > now) {
          continue;
        }
        timers.delete(handle);
        timer.callback();
      }
      now += 16;
    }

    expect(commits.length).toBeLessThanOrEqual(3);
  });

  it("commits immediately and drops the pending timer on a non-coalescable change", () => {
    const clock = fakeClock();
    clock.scheduler.commitCoalesced();
    clock.advance(16);
    clock.scheduler.commitCoalesced();

    clock.scheduler.commitNow();

    expect(clock.commits).toHaveLength(2);
    expect(clock.timers.size).toBe(0);
  });

  it("drops pending work on dispose without committing", () => {
    const clock = fakeClock();
    clock.scheduler.commitCoalesced();
    clock.advance(16);
    clock.scheduler.commitCoalesced();

    clock.scheduler.dispose();
    clock.fireDue();

    expect(clock.commits).toHaveLength(1);
    expect(clock.timers.size).toBe(0);
  });

  it("never commits after dispose", () => {
    const clock = fakeClock();
    clock.scheduler.dispose();

    clock.scheduler.commitCoalesced();
    clock.scheduler.commitNow();

    expect(clock.commits).toEqual([]);
  });

  it("commits again after a dispose/arm replay", () => {
    const clock = fakeClock();
    clock.scheduler.dispose();

    clock.scheduler.arm();
    clock.advance(DEFAULT_COALESCED_COMMIT_WINDOW.debounceMs);
    clock.scheduler.commitCoalesced();
    clock.scheduler.commitNow();

    expect(clock.commits).toHaveLength(2);
  });

  it("replays a commit that dispose dropped when the scheduler is armed again", () => {
    const clock = fakeClock();
    clock.scheduler.commitCoalesced();
    clock.advance(16);
    clock.scheduler.commitCoalesced();

    clock.scheduler.dispose();
    expect(clock.commits).toHaveLength(1);

    clock.scheduler.arm();

    expect(clock.commits).toHaveLength(2);
  });

  it("replays an update that landed while the scheduler was disposed", () => {
    const clock = fakeClock();
    clock.scheduler.dispose();
    clock.scheduler.commitNow();
    clock.scheduler.commitCoalesced();

    expect(clock.commits).toEqual([]);

    clock.scheduler.arm();

    expect(clock.commits).toHaveLength(1);
  });

  it("keeps arming idempotent while the scheduler is live", () => {
    const clock = fakeClock();
    clock.scheduler.arm();
    clock.scheduler.arm();

    expect(clock.commits).toEqual([]);
  });

  it("preserves the debounce window across a dispose/arm replay", () => {
    const clock = fakeClock();
    clock.scheduler.commitCoalesced();
    clock.scheduler.dispose();
    clock.scheduler.arm();

    clock.advance(16);
    clock.scheduler.commitCoalesced();

    expect(clock.commits).toEqual([0]);

    clock.advance(DEFAULT_COALESCED_COMMIT_WINDOW.debounceMs);
    clock.fireDue();

    expect(clock.commits).toHaveLength(2);
  });

  it("never lets a throwing commit strand the scheduler", () => {
    const failing = vi.fn(() => {
      throw new Error("commit failed");
    });
    const scheduler = new CoalescedCommitScheduler(failing, DEFAULT_COALESCED_COMMIT_WINDOW);

    expect(() => scheduler.commitCoalesced()).toThrow("commit failed");
    expect(() => scheduler.commitNow()).toThrow("commit failed");
    expect(failing).toHaveBeenCalledTimes(2);

    scheduler.dispose();
  });
});
