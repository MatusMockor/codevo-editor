import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BackgroundTokenizer,
  type BackgroundTokenizableModel,
  type IdleScheduler,
} from "./backgroundTokenizer";

/**
 * Deterministic idle scheduler: captures queued callbacks instead of waiting on
 * `requestIdleCallback`, so a test can fire idle slices one at a time and assert
 * exactly which lines were tokenized between yields. Mirrors the
 * `DiagnosticsFlushScheduler` injection used by `DiagnosticsCoalescer`.
 */
function manualScheduler(): IdleScheduler & {
  pending: number;
  runNext: () => void;
  runAll: () => void;
} {
  const queue = new Map<number, () => void>();
  let nextHandle = 1;

  return {
    get pending() {
      return queue.size;
    },
    schedule(slice: () => void): number {
      const handle = nextHandle++;
      queue.set(handle, slice);
      return handle;
    },
    cancel(handle: number): void {
      queue.delete(handle);
    },
    runNext(): void {
      const [handle, slice] = queue.entries().next().value ?? [];
      if (handle === undefined || !slice) {
        return;
      }
      queue.delete(handle);
      slice();
    },
    runAll(): void {
      // Slices re-arm by scheduling the next one, so drain until the queue is
      // empty (a finished/cancelled tokenizer stops re-arming).
      let guard = 0;
      while (queue.size > 0) {
        this.runNext();
        guard += 1;
        if (guard > 100000) {
          throw new Error("runAll did not converge (scheduler never drained)");
        }
      }
    },
  };
}

interface FakeModel extends BackgroundTokenizableModel {
  forceTokenization: ReturnType<typeof vi.fn>;
  forcedLines: number[];
  disposed: boolean;
}

function fakeModel(lineCount: number): FakeModel {
  const forcedLines: number[] = [];
  const model: FakeModel = {
    forcedLines,
    disposed: false,
    getLineCount: () => lineCount,
    isDisposed: () => model.disposed,
    tokenization: {
      forceTokenization: vi.fn((lineNumber: number) => {
        forcedLines.push(lineNumber);
      }),
    },
    // Convenience alias so assertions read clearly.
    get forceTokenization() {
      return model.tokenization.forceTokenization as ReturnType<typeof vi.fn>;
    },
  };
  return model;
}

describe("BackgroundTokenizer", () => {
  let scheduler: ReturnType<typeof manualScheduler>;

  beforeEach(() => {
    scheduler = manualScheduler();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not tokenize synchronously on start (only schedules the first slice)", () => {
    const model = fakeModel(1000);
    const tokenizer = new BackgroundTokenizer(scheduler, { chunkSize: 200 });

    tokenizer.start(model);

    expect(model.forceTokenization).not.toHaveBeenCalled();
    expect(scheduler.pending).toBe(1);
  });

  it("warms the whole model progressively in chunked idle slices", () => {
    const model = fakeModel(1000);
    const tokenizer = new BackgroundTokenizer(scheduler, { chunkSize: 200 });

    tokenizer.start(model);

    scheduler.runNext();
    expect(model.forceTokenization).toHaveBeenLastCalledWith(200);
    expect(scheduler.pending).toBe(1);

    scheduler.runNext();
    expect(model.forceTokenization).toHaveBeenLastCalledWith(400);

    scheduler.runAll();

    // Final slice clamps to the last line and then stops re-arming.
    expect(model.forceTokenization).toHaveBeenLastCalledWith(1000);
    expect(scheduler.pending).toBe(0);
    expect(model.forcedLines).toEqual([200, 400, 600, 800, 1000]);
  });

  it("finishes a single-chunk model in one slice and stops", () => {
    const model = fakeModel(120);
    const tokenizer = new BackgroundTokenizer(scheduler, { chunkSize: 500 });

    tokenizer.start(model);
    scheduler.runAll();

    expect(model.forcedLines).toEqual([120]);
    expect(scheduler.pending).toBe(0);
  });

  it("never tokenizes again after the model is disposed mid-flight", () => {
    const model = fakeModel(1000);
    const tokenizer = new BackgroundTokenizer(scheduler, { chunkSize: 200 });

    tokenizer.start(model);
    scheduler.runNext();
    scheduler.runNext();
    const callsBeforeDispose = model.forceTokenization.mock.calls.length;

    model.disposed = true;
    scheduler.runAll();

    expect(model.forceTokenization.mock.calls.length).toBe(callsBeforeDispose);
  });

  it("re-checks isDisposed BEFORE the chunk call inside a slice", () => {
    const model = fakeModel(1000);
    // Dispose the model the moment it is read inside the slice, so a guard that
    // only checks at the top of the slice still protects the chunk call.
    model.isDisposed = vi.fn(() => model.disposed);
    const tokenizer = new BackgroundTokenizer(scheduler, { chunkSize: 200 });

    tokenizer.start(model);
    model.disposed = true;
    scheduler.runNext();

    expect(model.forceTokenization).not.toHaveBeenCalled();
    expect(scheduler.pending).toBe(0);
  });

  it("cancels pending idle slices and tokenizes only the new model on switch", () => {
    const first = fakeModel(1000);
    const second = fakeModel(1000);
    const tokenizer = new BackgroundTokenizer(scheduler, { chunkSize: 200 });

    tokenizer.start(first);
    scheduler.runNext();
    expect(first.forcedLines).toEqual([200]);

    // Switching to a new model must cancel the first model's pending slice so it
    // can never resume tokenizing the previous tab's model.
    tokenizer.start(second);
    expect(scheduler.pending).toBe(1);

    scheduler.runAll();

    expect(first.forcedLines).toEqual([200]);
    expect(second.forcedLines).toEqual([200, 400, 600, 800, 1000]);
  });

  it("stop() cancels pending slices and prevents further tokenization", () => {
    const model = fakeModel(1000);
    const tokenizer = new BackgroundTokenizer(scheduler, { chunkSize: 200 });

    tokenizer.start(model);
    scheduler.runNext();
    tokenizer.stop();

    expect(scheduler.pending).toBe(0);
    scheduler.runAll();
    expect(model.forcedLines).toEqual([200]);
  });

  it("dispose() cancels pending work and start() is a no-op afterwards", () => {
    const model = fakeModel(1000);
    const tokenizer = new BackgroundTokenizer(scheduler, { chunkSize: 200 });

    tokenizer.start(model);
    tokenizer.dispose();
    expect(scheduler.pending).toBe(0);

    tokenizer.start(model);
    expect(scheduler.pending).toBe(0);
    scheduler.runAll();
    expect(model.forceTokenization).not.toHaveBeenCalled();
  });

  it("caps tokenization for extremely large models at maxLines", () => {
    const model = fakeModel(100000);
    const tokenizer = new BackgroundTokenizer(scheduler, {
      chunkSize: 5000,
      maxLines: 20000,
    });

    tokenizer.start(model);
    scheduler.runAll();

    expect(model.forceTokenization).toHaveBeenLastCalledWith(20000);
    expect(scheduler.pending).toBe(0);
    // Never tokenizes past the cap even though the model has far more lines.
    expect(Math.max(...model.forcedLines)).toBe(20000);
  });

  it("does nothing for an empty/zero-line model", () => {
    const model = fakeModel(0);
    const tokenizer = new BackgroundTokenizer(scheduler, { chunkSize: 200 });

    tokenizer.start(model);
    scheduler.runAll();

    expect(model.forceTokenization).not.toHaveBeenCalled();
    expect(scheduler.pending).toBe(0);
  });
});
