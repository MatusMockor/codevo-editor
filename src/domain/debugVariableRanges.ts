export const DEBUG_VARIABLE_RANGE_SIZE = 100;
export const MAX_DEBUG_VARIABLE_RANGE_ITEMS = 10_000;

export type DebugVariableFilter = "indexed" | "named";

export type DebugVariableProjectionLimitReason =
  | "descriptors"
  | "descriptorBytes"
  | "references"
  | "referenceBytes"
  | "acquisitions"
  | "wireBytes";

export interface DebugVariableCategorySummary {
  /** Exact number of value descriptors observed for this category. */
  readonly total: number;
  /** Number of descriptors retained in the exact-owner backend snapshot. */
  readonly retained: number;
  readonly truncated: boolean;
  readonly limitReason: DebugVariableProjectionLimitReason | null;
}

export interface DebugVariableRange {
  readonly filter: DebugVariableFilter;
  readonly start: number;
  readonly count: number;
  readonly end: number;
  readonly label: string;
}

interface DebugIndexedPageProjection {
  readonly start: number;
  readonly returned?: number;
  readonly variables: readonly unknown[];
  readonly total?: number | null;
  readonly nextStart: number | null;
  readonly truncated?: boolean;
}

export function debugIndexedRangeExtent(
  pages: readonly DebugIndexedPageProjection[],
): number | null {
  const exactTotal = pages.find(
    (page) => page.total !== null && page.total !== undefined && page.truncated !== true,
  )?.total;
  if (exactTotal !== undefined && exactTotal !== null) {
    return Math.min(exactTotal, MAX_DEBUG_VARIABLE_RANGE_ITEMS);
  }
  if (pages.length === 0) return null;
  const retained = pages.reduce(
    (largest, page) =>
      Math.max(largest, page.start + (page.returned ?? page.variables.length), page.nextStart ?? 0),
    0,
  );
  return Math.min(
    retained + (pages.some((page) => page.nextStart !== null) ? DEBUG_VARIABLE_RANGE_SIZE : 0),
    MAX_DEBUG_VARIABLE_RANGE_ITEMS,
  );
}

export function buildDebugVariableRanges(
  filter: DebugVariableFilter,
  summary: DebugVariableCategorySummary,
): readonly DebugVariableRange[] {
  if (!isDebugVariableCategorySummary(summary)) return [];
  const ranges: DebugVariableRange[] = [];
  const retained = Math.min(summary.retained, MAX_DEBUG_VARIABLE_RANGE_ITEMS);
  for (let start = 0; start < retained; start += DEBUG_VARIABLE_RANGE_SIZE) {
    const count = Math.min(DEBUG_VARIABLE_RANGE_SIZE, retained - start);
    const end = start + count - 1;
    ranges.push({
      filter,
      start,
      count,
      end,
      label: `[${start}\u2026${end}]`,
    });
  }
  return ranges;
}

export function isDebugVariableFilter(value: unknown): value is DebugVariableFilter {
  return value === "indexed" || value === "named";
}

export function isDebugVariableCategorySummary(
  value: unknown,
): value is DebugVariableCategorySummary {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, ["total", "retained", "truncated", "limitReason"])) return false;
  if (!isNonNegativeSafeInteger(value.total) || !isNonNegativeSafeInteger(value.retained)) {
    return false;
  }
  if (value.retained > value.total || typeof value.truncated !== "boolean") return false;
  if (
    value.limitReason !== null &&
    value.limitReason !== "descriptors" &&
    value.limitReason !== "descriptorBytes" &&
    value.limitReason !== "references" &&
    value.limitReason !== "referenceBytes" &&
    value.limitReason !== "acquisitions" &&
    value.limitReason !== "wireBytes"
  ) {
    return false;
  }
  return (
    value.truncated === value.retained < value.total &&
    (value.truncated ? value.limitReason !== null : value.limitReason === null)
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}
