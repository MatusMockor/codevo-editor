// Lightweight, allocation-frugal latency instrumentation for the key
// interactive operations of the workbench. It records recent per-operation
// latencies (a bounded ring of samples) and exposes summary stats for a
// runtime/debug panel so real latencies are observable instead of guessed.
//
// Design constraints:
//   - Zero hot-path overhead beyond two timestamps + one array push: no logging,
//     no async, no serialization on `record`.
//   - Pure domain: no React, no globals, no `performance` import. The clock is
//     injected by callers (`performance.now`) and defaulted for tests.
//   - Per-operation isolation: each kind keeps its own bounded sample window.

export const LATENCY_OPERATION_KINDS = [
  "quickOpen",
  "searchEverywhere",
  "definition",
  "completion",
  "folderExpand",
] as const;

export type LatencyOperationKind = (typeof LATENCY_OPERATION_KINDS)[number];

export interface LatencyStats {
  count: number;
  last: number;
  min: number;
  max: number;
  median: number;
  p95: number;
}

export interface LatencySnapshotEntry {
  kind: LatencyOperationKind;
  stats: LatencyStats;
}

export interface LatencyTracker {
  record(kind: LatencyOperationKind, durationMs: number): void;
  statsFor(kind: LatencyOperationKind): LatencyStats | null;
  snapshot(): LatencySnapshotEntry[];
  clear(): void;
}

export interface LatencyTrackerOptions {
  /** Maximum number of recent samples retained per operation kind. */
  capacity?: number;
}

const DEFAULT_CAPACITY = 50;

const KIND_ORDER = new Map<LatencyOperationKind, number>(
  LATENCY_OPERATION_KINDS.map((kind, index) => [kind, index]),
);

export type LatencyClock = () => number;

const OPERATION_LABELS: Record<LatencyOperationKind, string> = {
  quickOpen: "Quick Open",
  searchEverywhere: "Search Everywhere",
  definition: "Go to Definition",
  completion: "Completion",
  folderExpand: "Folder Expand",
};

export function latencyOperationLabel(kind: LatencyOperationKind): string {
  return OPERATION_LABELS[kind];
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  if (sorted.length === 1) {
    return sorted[0];
  }

  const rank = Math.ceil(fraction * sorted.length) - 1;
  const index = Math.min(Math.max(rank, 0), sorted.length - 1);
  return sorted[index];
}

function median(sorted: number[]): number {
  if (sorted.length === 0) {
    return 0;
  }

  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }

  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function statsFromSamples(samples: number[]): LatencyStats {
  const sorted = [...samples].sort((a, b) => a - b);

  return {
    count: samples.length,
    last: samples[samples.length - 1],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: median(sorted),
    p95: percentile(sorted, 0.95),
  };
}

export function createLatencyTracker(
  options: LatencyTrackerOptions = {},
): LatencyTracker {
  const capacity = Math.max(1, options.capacity ?? DEFAULT_CAPACITY);
  const windows = new Map<LatencyOperationKind, number[]>();

  return {
    record(kind, durationMs) {
      if (!Number.isFinite(durationMs) || durationMs < 0) {
        return;
      }

      const existing = windows.get(kind);

      if (!existing) {
        windows.set(kind, [durationMs]);
        return;
      }

      existing.push(durationMs);

      if (existing.length > capacity) {
        existing.shift();
      }
    },
    statsFor(kind) {
      const samples = windows.get(kind);

      if (!samples || samples.length === 0) {
        return null;
      }

      return statsFromSamples(samples);
    },
    snapshot() {
      const entries: LatencySnapshotEntry[] = [];

      windows.forEach((samples, kind) => {
        if (samples.length === 0) {
          return;
        }

        entries.push({ kind, stats: statsFromSamples(samples) });
      });

      entries.sort(
        (left, right) =>
          (KIND_ORDER.get(left.kind) ?? 0) - (KIND_ORDER.get(right.kind) ?? 0),
      );

      return entries;
    },
    clear() {
      windows.clear();
    },
  };
}

/**
 * Wraps an async operation, recording its wall-clock latency against `kind`
 * whether it resolves or rejects, and returns/rethrows the original result. The
 * only hot-path cost is two clock reads. `clock` is injectable for tests.
 */
export async function measureLatency<T>(
  tracker: LatencyTracker,
  kind: LatencyOperationKind,
  operation: () => Promise<T>,
  clock: LatencyClock = defaultClock,
): Promise<T> {
  const start = clock();

  try {
    return await operation();
  } finally {
    tracker.record(kind, clock() - start);
  }
}

function defaultClock(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }

  return Date.now();
}
