import type { LanguageServerDiagnosticEvent } from "./languageServerDiagnostics";
import { normalizedWorkspaceRootKey } from "./workspaceRootKey";

/**
 * Sink that applies a single coalesced diagnostics event. Production wires this
 * to the existing `applyLanguageServerDiagnostics` /
 * `applyJavaScriptTypeScriptLanguageServerDiagnostics` callbacks, which already
 * enforce per-workspace isolation, session, version and notice-cap rules. The
 * coalescer never relaxes those guards; it only collapses bursts of events into
 * a single batched replay so React renders once per frame instead of once per
 * event.
 */
export type DiagnosticsSink = (event: LanguageServerDiagnosticEvent) => void;

/**
 * Strategy for deferring a flush to the next frame. Production uses
 * `requestAnimationFrame` (falling back to `setTimeout(0)` where rAF is
 * unavailable); tests inject a deterministic scheduler so the flush can be fired
 * explicitly. `schedule` returns an opaque handle that `cancel` understands.
 */
export interface DiagnosticsFlushScheduler {
  cancel: (handle: number) => void;
  schedule: (flush: () => void) => number;
}

/**
 * Default scheduler: one flush per animation frame, with a `setTimeout(0)`
 * fallback for environments without `requestAnimationFrame`. Keeping the bridge
 * here means the React layer never has to branch on host capabilities.
 */
export function animationFrameDiagnosticsFlushScheduler(): DiagnosticsFlushScheduler {
  const hasRaf =
    typeof requestAnimationFrame === "function" &&
    typeof cancelAnimationFrame === "function";

  if (hasRaf) {
    return {
      cancel: (handle) => cancelAnimationFrame(handle),
      schedule: (flush) => requestAnimationFrame(() => flush()),
    };
  }

  return {
    cancel: (handle) => clearTimeout(handle),
    schedule: (flush) => setTimeout(flush, 0) as unknown as number,
  };
}

/**
 * Coalesces `publishDiagnostics` events that arrive as separate Tauri listener
 * callbacks (each its own macrotask, so React 19 cannot batch them). During an
 * indexing burst on a large project the server can emit hundreds of per-file
 * publications back to back; replaying each one individually triggers N
 * un-batched renders, each O(total notices/paths). This buffers events keyed by
 * `owner -> uri` (retaining the latest version per key) and replays them
 * through the sink once per scheduled frame, collapsing the burst into a
 * single batch. Callers that manage root aliases can provide a stable owner key
 * independently of the event's currently selected root.
 *
 * Isolation is preserved end to end: distinct owners have separate buffers,
 * `dropOwner` discards a closed owner before it can flush, and the sink itself
 * re-checks the active root/session/version after every `await`. The legacy
 * root API derives a normalized owner from the event root.
 */
export class DiagnosticsCoalescer {
  private readonly buffersByOwner = new Map<
    string,
    Map<string, LanguageServerDiagnosticEvent>
  >();
  private handle: number | null = null;
  private disposed = false;

  constructor(
    private readonly sink: DiagnosticsSink,
    private readonly scheduler: DiagnosticsFlushScheduler,
  ) {}

  enqueue(
    event: LanguageServerDiagnosticEvent,
    explicitOwnerKey?: string | null,
  ): void {
    if (explicitOwnerKey !== undefined) {
      this.enqueueForOwner(explicitOwnerKey, event);
      return;
    }

    const ownerKey = normalizedWorkspaceRootKey(event.rootPath);

    if (!ownerKey) {
      return;
    }

    this.enqueueForOwner(ownerKey, event);
  }

  enqueueForOwner(
    ownerKey: string | null | undefined,
    event: LanguageServerDiagnosticEvent,
  ): void {
    if (this.disposed) {
      return;
    }

    if (!ownerKey) {
      return;
    }

    const ownerBuffer = this.buffersByOwner.get(ownerKey) ?? new Map();
    const buffered = ownerBuffer.get(event.uri);

    if (buffered && !isNewerOrEqual(event, buffered)) {
      return;
    }

    ownerBuffer.set(event.uri, event);
    this.buffersByOwner.set(ownerKey, ownerBuffer);
    this.arm();
  }

  dropRoot(rootPath: string | null | undefined): void {
    const rootKey = normalizedWorkspaceRootKey(rootPath);

    if (!rootKey) {
      return;
    }

    this.dropOwner(rootKey);
  }

  dropOwner(ownerKey: string | null | undefined): void {
    if (!ownerKey) {
      return;
    }

    this.buffersByOwner.delete(ownerKey);

    if (this.buffersByOwner.size === 0) {
      this.disarm();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.buffersByOwner.clear();
    this.disarm();
  }

  private arm(): void {
    if (this.handle !== null) {
      return;
    }

    this.handle = this.scheduler.schedule(() => {
      this.handle = null;
      this.flush();
    });
  }

  private disarm(): void {
    if (this.handle === null) {
      return;
    }

    this.scheduler.cancel(this.handle);
    this.handle = null;
  }

  private flush(): void {
    if (this.disposed) {
      return;
    }

    if (this.buffersByOwner.size === 0) {
      return;
    }

    const batch = Array.from(this.buffersByOwner.values()).flatMap((buffer) =>
      Array.from(buffer.values()),
    );
    this.buffersByOwner.clear();

    batch.forEach((event) => {
      this.sink(event);
    });
  }
}

/**
 * Decides whether an incoming event should replace the one already buffered for
 * the same key.
 *
 * A null version (typical of clears / unversioned servers) means "this is the
 * latest publication for this uri". So:
 * - A buffered null is only replaced by another null publication (the next
 *   latest); a stale numeric event arriving afterwards must NOT resurrect
 *   markers by overwriting a buffered clear.
 * - A null candidate always supersedes a numeric buffered entry.
 * - Two numeric versions follow monotonic `>=` ordering.
 *
 * The sink still performs the authoritative `shouldApplyLanguageServerDiagnostics`
 * check; this guard only avoids letting a genuinely stale duplicate overwrite a
 * fresher one already in the buffer.
 */
function isNewerOrEqual(
  candidate: LanguageServerDiagnosticEvent,
  buffered: LanguageServerDiagnosticEvent,
): boolean {
  if (typeof buffered.version !== "number") {
    return typeof candidate.version !== "number";
  }

  if (typeof candidate.version !== "number") {
    return true;
  }

  return candidate.version >= buffered.version;
}
