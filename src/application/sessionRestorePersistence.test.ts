import { describe, expect, it } from "vitest";
import {
  createDebouncedSessionWriter,
  createSessionRestoreFlushRegistry,
  installSessionRestoreFlushTriggers,
  type SessionRestoreFlushTarget,
  type SessionRestoreTimers,
} from "./sessionRestorePersistence";

function manualTimers(): SessionRestoreTimers & { fire(): void; readonly pending: number } {
  const callbacks = new Map<number, () => void>();
  let next = 1;
  return {
    setTimeout: (callback) => {
      const handle = next;
      next += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    clearTimeout: (handle) => {
      callbacks.delete(handle);
    },
    fire: () => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback();
    },
    get pending() {
      return callbacks.size;
    },
  };
}

function eventTarget(): SessionRestoreFlushTarget & {
  emit(type: string): void;
  readonly count: number;
  visibilityState: string;
} {
  const listeners = new Map<string, Set<() => void>>();
  return {
    visibilityState: "visible",
    addEventListener: (type, listener) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener);
    },
    emit(type) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
    get count() {
      return [...listeners.values()].reduce((total, set) => total + set.size, 0);
    },
  };
}

describe("session restore persistence", () => {
  it("coalesces scheduled writes into one debounced write", () => {
    const timers = manualTimers();
    let writes = 0;
    const writer = createDebouncedSessionWriter(() => (writes += 1), 400, timers);

    writer.schedule();
    writer.schedule();
    writer.schedule();
    expect(timers.pending).toBe(1);
    timers.fire();

    expect(writes).toBe(1);
  });

  it("flushes only when a write is pending", () => {
    const timers = manualTimers();
    let writes = 0;
    const writer = createDebouncedSessionWriter(() => (writes += 1), 400, timers);

    writer.flush();
    expect(writes).toBe(0);
    writer.schedule();
    writer.flush();
    writer.flush();

    expect(writes).toBe(1);
    expect(timers.pending).toBe(0);
  });

  it("writes the pending state once on dispose and ignores later schedules", () => {
    const timers = manualTimers();
    let writes = 0;
    const writer = createDebouncedSessionWriter(() => (writes += 1), 400, timers);

    writer.schedule();
    writer.dispose();
    writer.schedule();

    expect(writes).toBe(1);
    expect(timers.pending).toBe(0);
  });

  it("flushes every registered writer and isolates a failing one", () => {
    const errors: unknown[] = [];
    const registry = createSessionRestoreFlushRegistry((error) => errors.push(error));
    const flushed: string[] = [];
    registry.register(() => {
      throw new Error("quota");
    });
    const unregister = registry.register(() => flushed.push("drafts"));

    registry.flushAll();
    unregister();
    registry.flushAll();

    expect(flushed).toEqual(["drafts"]);
    expect(errors).toHaveLength(2);
  });

  it("flushes on page hide, window blur and hidden visibility, then detaches", () => {
    const registry = createSessionRestoreFlushRegistry();
    let flushes = 0;
    registry.register(() => (flushes += 1));
    const window = eventTarget();
    const document = eventTarget();
    const uninstall = installSessionRestoreFlushTriggers(registry, { window, document });

    window.emit("pagehide");
    window.emit("blur");
    document.emit("visibilitychange");
    document.visibilityState = "hidden";
    document.emit("visibilitychange");
    uninstall();
    window.emit("pagehide");

    expect(flushes).toBe(3);
    expect(window.count + document.count).toBe(0);
  });
});
