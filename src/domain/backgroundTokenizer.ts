/**
 * Eager, off-critical-path TextMate warming for a freshly opened Monaco model.
 *
 * Why this exists: the editor installs a custom *encoded* Shiki tokens provider
 * (`setTokensProvider`) instead of a Monarch/async provider. Monaco only
 * tokenizes the visible viewport synchronously when a model is shown, so the
 * first far jump (Cmd+B, a click on a distant line, a fling scroll) forces
 * Monaco to tokenize every line from the last cached grammar state up to the
 * target *synchronously, on the main thread, in one burst* (~0.2ms/line ->
 * ~128ms for a 645-line file). That burst is the cold-start lag; PhpStorm warms
 * tokens off-thread so it never happens.
 *
 * Monaco does ship a `DefaultBackgroundTokenizer`, but it is conservative: it
 * starts only on a genuine `requestIdleCallback` (which is starved right after
 * open by LSP indexing, diagnostics and React renders) and yields after ~1ms of
 * work per idle period. That leaves a wide window where a far jump still hits
 * the synchronous burst.
 *
 * This warmer is more aggressive on purpose: it walks the whole model in larger
 * line chunks per idle slice, calling `model.tokenization.forceTokenization()`
 * which tokenizes from the last cached state up to the requested line and
 * caches the result. Because each call resumes from the cached state, repeated
 * calls with growing line numbers warm the model incrementally without redoing
 * already-cached lines. Once warmed, every reveal/jump/scroll reads cached
 * tokens, so the cold-start burst disappears. Tokens are identical to the
 * synchronous path (same encoded provider); only the *timing* changes.
 *
 * Isolation is the hard requirement (one open project tab must never tokenize
 * another's model): exactly one model is warmed at a time, `start()` cancels any
 * in-flight warming for the previous model before adopting the new one, every
 * slice re-checks `model.isDisposed()` before touching it, and `stop()` /
 * `dispose()` cancel the pending idle slice. A disposed/superseded model can
 * never receive a further `forceTokenization` call.
 */

/** The slice of Monaco's `ITextModel` this warmer drives. Kept structural so the
 * unit test can pass a lightweight stub instead of a real Monaco model. */
export interface BackgroundTokenizableModel {
  getLineCount(): number;
  isDisposed(): boolean;
  tokenization: {
    /**
     * Synchronously tokenizes from the last cached grammar state up to
     * `lineNumber` (inclusive) and caches the result. Runtime API on Monaco
     * 0.53's `model.tokenization` (not in the published `monaco.d.ts`).
     */
    forceTokenization(lineNumber: number): void;
  };
}

/**
 * Strategy for deferring a warming slice to browser idle time. Production uses
 * `requestIdleCallback` (falling back to `setTimeout(0)`); tests inject a
 * deterministic scheduler so slices can be fired explicitly. Mirrors
 * `DiagnosticsFlushScheduler` so both schedulers stay consistent. `schedule`
 * returns an opaque handle that `cancel` understands.
 */
export interface IdleScheduler {
  cancel: (handle: number) => void;
  schedule: (slice: () => void) => number;
}

export interface BackgroundTokenizerOptions {
  /**
   * Lines warmed per idle slice. Larger = fewer yields (the whole file warms
   * sooner) but each slice is a synchronous main-thread block. `forceTokenization`
   * costs ~0.2ms/line, so 200 lines is ~40ms worst case: well under a janky
   * block yet far more aggressive than Monaco's default tokenizer (which yields
   * after ~1ms), so the file warms in a handful of idle periods. Kept
   * configurable for tests/tuning.
   */
  chunkSize?: number;
  /**
   * Hard cap on how far a single model is warmed. For an extremely large file
   * (tens of thousands of lines) warming the entire model would queue many
   * slices; the viewport plus a generous lead is enough to kill the cold-start
   * burst for the region a user realistically navigates to. Beyond the cap,
   * Monaco's own on-demand + default background tokenizer take over.
   */
  maxLines?: number;
}

const DEFAULT_CHUNK_SIZE = 200;
const DEFAULT_MAX_LINES = 20000;

/** True when `model` exposes the full surface this warmer drives at runtime. */
function isTokenizable(model: BackgroundTokenizableModel): boolean {
  return (
    typeof model.isDisposed === "function" &&
    typeof model.getLineCount === "function" &&
    typeof model.tokenization?.forceTokenization === "function"
  );
}

/**
 * Default scheduler: one slice per `requestIdleCallback`, with a `setTimeout(0)`
 * fallback for environments without it (and for jsdom in tests that don't inject
 * a manual scheduler). Keeping the host-capability branch here means the React
 * layer never has to branch on it.
 */
export function idleCallbackScheduler(): IdleScheduler {
  const hasIdleCallback =
    typeof requestIdleCallback === "function" &&
    typeof cancelIdleCallback === "function";

  if (hasIdleCallback) {
    return {
      cancel: (handle) => cancelIdleCallback(handle),
      schedule: (slice) => requestIdleCallback(() => slice(), { timeout: 1000 }),
    };
  }

  return {
    cancel: (handle) => clearTimeout(handle),
    schedule: (slice) => setTimeout(slice, 0) as unknown as number,
  };
}

/**
 * Warms one model at a time in chunked idle slices. Reusable across model
 * switches: `start()` adopts a new model and cancels the previous one's pending
 * work, so a single long-lived instance per editor surface is enough.
 */
export class BackgroundTokenizer {
  private readonly chunkSize: number;
  private readonly maxLines: number;
  private model: BackgroundTokenizableModel | null = null;
  private nextLine = 0;
  private handle: number | null = null;
  private disposed = false;

  constructor(
    private readonly scheduler: IdleScheduler,
    options: BackgroundTokenizerOptions = {},
  ) {
    this.chunkSize = Math.max(1, options.chunkSize ?? DEFAULT_CHUNK_SIZE);
    this.maxLines = Math.max(1, options.maxLines ?? DEFAULT_MAX_LINES);
  }

  /**
   * Begins (or restarts) background warming for `model`. Cancels any in-flight
   * warming for a previously adopted model first, so only the model passed here
   * is ever tokenized — no cross-tab/model leak.
   */
  start(model: BackgroundTokenizableModel): void {
    if (this.disposed) {
      return;
    }

    this.cancelPending();
    this.model = model;
    this.nextLine = 0;
    this.arm();
  }

  /** Cancels any pending slice and forgets the current model (no further work). */
  stop(): void {
    this.cancelPending();
    this.model = null;
    this.nextLine = 0;
  }

  /** Permanent teardown: cancels pending work; `start()` is a no-op afterwards. */
  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  private arm(): void {
    if (this.handle !== null) {
      return;
    }

    this.handle = this.scheduler.schedule(() => {
      this.handle = null;
      this.runSlice();
    });
  }

  private cancelPending(): void {
    if (this.handle === null) {
      return;
    }

    this.scheduler.cancel(this.handle);
    this.handle = null;
  }

  private runSlice(): void {
    const model = this.model;

    if (this.disposed || !model) {
      return;
    }

    // Defensive: the tokenization API is a runtime-only Monaco surface reached
    // through a cast, so verify the methods exist before driving them. A model
    // that cannot be tokenized (or a non-Monaco stub) is dropped instead of
    // throwing inside a deferred idle/timeout callback the caller can no longer
    // catch. Run first so the disposal re-check below can call isDisposed safely.
    if (!isTokenizable(model)) {
      this.stop();
      return;
    }

    // Re-check liveness AFTER the async idle gap: the model may have been
    // disposed (tab/file/workspace switch) while this slice sat in the queue.
    // This is the isolation-critical guard — a disposed/switched-away model must
    // never receive a forceTokenization call.
    if (model.isDisposed()) {
      this.stop();
      return;
    }

    const target = Math.min(model.getLineCount(), this.maxLines);

    if (target <= 0) {
      this.stop();
      return;
    }

    const nextTarget = Math.min(this.nextLine + this.chunkSize, target);
    model.tokenization.forceTokenization(nextTarget);
    this.nextLine = nextTarget;

    if (this.nextLine >= target) {
      this.stop();
      return;
    }

    this.arm();
  }
}
