// Pure view-model helpers that turn a LatencyTracker snapshot into display rows
// for the runtime latency panel: human label, formatted median/p95/last, sample
// count, and a tone (ok / warn / error) derived from per-operation budgets.
//
// Budgets match the performance-pass thresholds: navigation should resolve under
// ~100ms, quick-open/search filter under ~50ms, folder expand under ~200ms.
// Completion is interactive-typing latency, judged on the same nav-style budget.

import {
  latencyOperationLabel,
  type LatencyOperationKind,
  type LatencySnapshotEntry,
} from "./latencyTracker";

export type LatencyMetricTone = "ok" | "warn" | "error";

interface LatencyBudget {
  warn: number;
  error: number;
}

const LATENCY_BUDGETS: Record<LatencyOperationKind, LatencyBudget> = {
  quickOpen: { warn: 50, error: 100 },
  searchEverywhere: { warn: 50, error: 100 },
  definition: { warn: 100, error: 200 },
  completion: { warn: 100, error: 200 },
  folderExpand: { warn: 200, error: 400 },
};

export interface LatencyMetricRow {
  kind: LatencyOperationKind;
  label: string;
  count: number;
  medianText: string;
  p95Text: string;
  lastText: string;
  tone: LatencyMetricTone;
}

export function formatLatencyMs(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }

  if (value < 1) {
    return `${value.toFixed(2)} ms`;
  }

  if (value < 100) {
    return `${value.toFixed(1)} ms`;
  }

  return `${Math.round(value)} ms`;
}

export function latencyMetricTone(
  kind: LatencyOperationKind,
  medianMs: number,
): LatencyMetricTone {
  const budget = LATENCY_BUDGETS[kind];

  if (medianMs >= budget.error) {
    return "error";
  }

  if (medianMs >= budget.warn) {
    return "warn";
  }

  return "ok";
}

export function latencyMetricRows(
  snapshot: readonly LatencySnapshotEntry[],
): LatencyMetricRow[] {
  return snapshot.map((entry) => ({
    kind: entry.kind,
    label: latencyOperationLabel(entry.kind),
    count: entry.stats.count,
    medianText: formatLatencyMs(entry.stats.median),
    p95Text: formatLatencyMs(entry.stats.p95),
    lastText: formatLatencyMs(entry.stats.last),
    tone: latencyMetricTone(entry.kind, entry.stats.median),
  }));
}
