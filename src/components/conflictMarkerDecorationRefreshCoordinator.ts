export const CONFLICT_MARKER_DECORATION_DEBOUNCE_MS = 120;
export const MAX_CONFLICT_MARKER_DECORATION_SOURCE_CHARACTERS = 512 * 1024;

export interface ConflictMarkerDecorationRefreshAuthority {
  readonly model: object;
  readonly modelUri: string;
  readonly ownerKey: string;
  readonly path: string;
  readonly version: number;
}

export type ConflictMarkerDecorationRefreshResult<T> =
  | {
      readonly kind: "ready";
      readonly projection: T;
      readonly scannedCharacters: number;
    }
  | {
      readonly characterLimit: number;
      readonly kind: "degraded";
      readonly reason: "source-too-large";
      readonly sourceCharacters: number;
    };

export interface ConflictMarkerDecorationRefreshRequest<T> {
  readonly authority: ConflictMarkerDecorationRefreshAuthority;
  readonly currentAuthority: () => ConflictMarkerDecorationRefreshAuthority | null;
  readonly isCurrent: () => boolean;
  readonly project: (source: string) => T;
  readonly publish: (result: ConflictMarkerDecorationRefreshResult<T>) => void;
  readonly readSource: () => string;
  readonly sourceCharacters: number;
}

export interface ConflictMarkerDecorationRefreshMetrics {
  readonly cancelledRequests: number;
  readonly degradedRequests: number;
  readonly publishedRequests: number;
  readonly scannedCharacters: number;
  readonly scans: number;
  readonly scheduledRequests: number;
  readonly staleRequests: number;
}

interface ConflictMarkerDecorationRefreshScheduler {
  clear(handle: unknown): void;
  schedule(callback: () => void, delayMs: number): unknown;
}

const browserScheduler: ConflictMarkerDecorationRefreshScheduler = {
  clear: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
};

/**
 * Coalesces edit-driven conflict-marker projection behind an exact owner/version
 * lease. Content is read only after typing settles, and never at all once the
 * independent hard source limit is exceeded.
 */
export class ConflictMarkerDecorationRefreshCoordinator<T> {
  private disposed = false;
  private generation = 0;
  private pending: unknown = null;
  private mutableMetrics: ConflictMarkerDecorationRefreshMetrics = {
    cancelledRequests: 0,
    degradedRequests: 0,
    publishedRequests: 0,
    scannedCharacters: 0,
    scans: 0,
    scheduledRequests: 0,
    staleRequests: 0,
  };

  constructor(
    private readonly scheduler: ConflictMarkerDecorationRefreshScheduler = browserScheduler,
    private readonly debounceMs = CONFLICT_MARKER_DECORATION_DEBOUNCE_MS,
    private readonly characterLimit = MAX_CONFLICT_MARKER_DECORATION_SOURCE_CHARACTERS,
  ) {}

  request(request: ConflictMarkerDecorationRefreshRequest<T>): void {
    if (this.disposed) return;

    const generation = ++this.generation;
    this.mutableMetrics = incrementMetric(this.mutableMetrics, "scheduledRequests");
    this.clearPending(true);

    if (
      !Number.isSafeInteger(request.sourceCharacters) ||
      request.sourceCharacters < 0 ||
      request.sourceCharacters > this.characterLimit
    ) {
      this.pending = this.scheduler.schedule(() => {
        this.pending = null;
        if (!this.isCurrent(generation, request)) {
          this.mutableMetrics = incrementMetric(this.mutableMetrics, "staleRequests");
          return;
        }
        this.mutableMetrics = incrementMetric(this.mutableMetrics, "degradedRequests");
        this.mutableMetrics = incrementMetric(this.mutableMetrics, "publishedRequests");
        request.publish({
          characterLimit: this.characterLimit,
          kind: "degraded",
          reason: "source-too-large",
          sourceCharacters: request.sourceCharacters,
        });
      }, 0);
      return;
    }

    this.pending = this.scheduler.schedule(() => {
      this.pending = null;
      if (!this.isCurrent(generation, request)) {
        this.mutableMetrics = incrementMetric(this.mutableMetrics, "staleRequests");
        return;
      }

      const source = request.readSource();
      if (
        source.length !== request.sourceCharacters ||
        source.length > this.characterLimit ||
        !this.isCurrent(generation, request)
      ) {
        this.mutableMetrics = incrementMetric(this.mutableMetrics, "staleRequests");
        return;
      }

      const projection = request.project(source);
      this.mutableMetrics = {
        ...this.mutableMetrics,
        scannedCharacters: this.mutableMetrics.scannedCharacters + source.length,
        scans: this.mutableMetrics.scans + 1,
      };
      if (!this.isCurrent(generation, request)) {
        this.mutableMetrics = incrementMetric(this.mutableMetrics, "staleRequests");
        return;
      }

      this.mutableMetrics = incrementMetric(this.mutableMetrics, "publishedRequests");
      request.publish({
        kind: "ready",
        projection,
        scannedCharacters: source.length,
      });
    }, this.debounceMs);
  }

  cancel(): void {
    if (this.disposed) return;
    this.generation += 1;
    this.clearPending(true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
  }

  metrics(): ConflictMarkerDecorationRefreshMetrics {
    return { ...this.mutableMetrics };
  }

  private clearPending(countCancellation: boolean): void {
    if (this.pending === null) return;
    this.scheduler.clear(this.pending);
    this.pending = null;
    if (countCancellation) {
      this.mutableMetrics = incrementMetric(this.mutableMetrics, "cancelledRequests");
    }
  }

  private isCurrent(
    generation: number,
    request: ConflictMarkerDecorationRefreshRequest<T>,
  ): boolean {
    return (
      !this.disposed &&
      this.generation === generation &&
      authoritiesEqual(request.authority, request.currentAuthority()) &&
      request.isCurrent()
    );
  }
}

function authoritiesEqual(
  expected: ConflictMarkerDecorationRefreshAuthority,
  current: ConflictMarkerDecorationRefreshAuthority | null,
): boolean {
  return (
    current !== null &&
    expected.model === current.model &&
    expected.modelUri === current.modelUri &&
    expected.ownerKey === current.ownerKey &&
    expected.path === current.path &&
    expected.version === current.version
  );
}

function incrementMetric(
  metrics: ConflictMarkerDecorationRefreshMetrics,
  key: keyof ConflictMarkerDecorationRefreshMetrics,
): ConflictMarkerDecorationRefreshMetrics {
  return { ...metrics, [key]: metrics[key] + 1 };
}
