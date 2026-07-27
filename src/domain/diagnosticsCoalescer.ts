import {
  isBoundedLanguageServerDiagnosticEvent,
  MAX_LANGUAGE_SERVER_DIAGNOSTICS_UTF8_BYTES,
  type LanguageServerDiagnosticEvent,
} from "./languageServerDiagnostics";
import { normalizedWorkspaceRootKey } from "./workspaceRootKey";

/**
 * Sink that applies one complete coalesced frame. A batch boundary is explicit:
 * application state can reduce the whole frame and publish React state once,
 * instead of repeating an object spread and render for every event.
 */
export type DiagnosticsBatchSink = (events: readonly LanguageServerDiagnosticEvent[]) => void;

export const DIAGNOSTICS_COALESCER_MAX_EVENTS_PER_FLUSH = 256;
export const DIAGNOSTICS_COALESCER_MAX_UTF8_BYTES_PER_FLUSH = 8 * 1024 * 1024;

interface DiagnosticsOwnerBuffer {
  readonly eventsByUri: Map<string, BufferedDiagnosticsEvent>;
  utf8Bytes: number;
}

interface BufferedDiagnosticsEvent {
  readonly event: LanguageServerDiagnosticEvent;
  readonly utf8Bytes: number;
}

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
    typeof requestAnimationFrame === "function" && typeof cancelAnimationFrame === "function";

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
  private readonly buffersByOwner = new Map<string, DiagnosticsOwnerBuffer>();
  private bufferedEventCount = 0;
  private bufferedEventUtf8Bytes = 0;
  private handle: number | null = null;
  private disposed = false;

  constructor(
    private readonly sink: DiagnosticsBatchSink,
    private readonly scheduler: DiagnosticsFlushScheduler,
  ) {}

  enqueue(event: LanguageServerDiagnosticEvent, explicitOwnerKey?: string | null): void {
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

  enqueueForOwner(ownerKey: string | null | undefined, event: LanguageServerDiagnosticEvent): void {
    if (this.disposed) {
      return;
    }

    if (!ownerKey) {
      return;
    }

    let ownerBuffer = this.buffersByOwner.get(ownerKey) ?? {
      eventsByUri: new Map(),
      utf8Bytes: 0,
    };
    const buffered = ownerBuffer.eventsByUri.get(event.uri);

    if (buffered && !isNewerOrEqual(event, buffered.event)) {
      return;
    }

    const eventBytes = diagnosticsEventUtf8Bytes(event);
    if (diagnosticsBatchUtf8Bytes(eventBytes, 1) > DIAGNOSTICS_COALESCER_MAX_UTF8_BYTES_PER_FLUSH) {
      this.disarm();
      this.flush();
      return;
    }

    let bufferedBytes = buffered?.utf8Bytes ?? 0;
    const nextEventCount = this.bufferedEventCount + (buffered ? 0 : 1);
    const nextEventUtf8Bytes = this.bufferedEventUtf8Bytes - bufferedBytes + eventBytes;
    if (
      (!buffered && this.bufferedEventCount >= DIAGNOSTICS_COALESCER_MAX_EVENTS_PER_FLUSH) ||
      diagnosticsBatchUtf8Bytes(nextEventUtf8Bytes, nextEventCount) >
        DIAGNOSTICS_COALESCER_MAX_UTF8_BYTES_PER_FLUSH
    ) {
      this.disarm();
      this.flush();
      ownerBuffer = { eventsByUri: new Map(), utf8Bytes: 0 };
      bufferedBytes = 0;
    }

    if (!bufferedBytes) {
      this.bufferedEventCount += 1;
    }
    this.bufferedEventUtf8Bytes += eventBytes - bufferedBytes;
    ownerBuffer.eventsByUri.set(event.uri, { event, utf8Bytes: eventBytes });
    ownerBuffer.utf8Bytes = ownerBuffer.utf8Bytes - bufferedBytes + eventBytes;
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

    const removed = this.buffersByOwner.get(ownerKey);
    if (removed) {
      this.bufferedEventCount -= removed.eventsByUri.size;
      this.bufferedEventUtf8Bytes -= removed.utf8Bytes;
      this.buffersByOwner.delete(ownerKey);
    }

    if (this.buffersByOwner.size === 0) {
      this.disarm();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.buffersByOwner.clear();
    this.bufferedEventCount = 0;
    this.bufferedEventUtf8Bytes = 0;
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
      Array.from(buffer.eventsByUri.values(), ({ event }) => event),
    );
    this.buffersByOwner.clear();
    this.bufferedEventCount = 0;
    this.bufferedEventUtf8Bytes = 0;

    this.sink(batch);
  }
}

function diagnosticsBatchUtf8Bytes(eventUtf8Bytes: number, eventCount: number): number {
  return 2 + eventUtf8Bytes + Math.max(0, eventCount - 1);
}

function diagnosticsEventUtf8Bytes(event: LanguageServerDiagnosticEvent): number {
  try {
    if (isBoundedLanguageServerDiagnosticEvent(event)) {
      const decodedDiagnosticsUtf8Bytes = event.projection.decodedUtf8Bytes;
      if (
        decodedDiagnosticsUtf8Bytes < 2 ||
        decodedDiagnosticsUtf8Bytes > MAX_LANGUAGE_SERVER_DIAGNOSTICS_UTF8_BYTES
      ) {
        return DIAGNOSTICS_COALESCER_MAX_UTF8_BYTES_PER_FLUSH + 1;
      }
      const envelopeUtf8Bytes = new TextEncoder().encode(
        JSON.stringify({ ...event, diagnostics: [] }),
      ).byteLength;
      return envelopeUtf8Bytes - 2 + decodedDiagnosticsUtf8Bytes;
    }
    return new TextEncoder().encode(JSON.stringify(event)).byteLength;
  } catch {
    return DIAGNOSTICS_COALESCER_MAX_UTF8_BYTES_PER_FLUSH + 1;
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
