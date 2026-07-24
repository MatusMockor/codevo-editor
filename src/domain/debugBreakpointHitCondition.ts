export type BreakpointHitCondition =
  | { readonly kind: "equals"; readonly count: number }
  | { readonly kind: "greaterOrEqual"; readonly count: number }
  | { readonly kind: "multiple"; readonly count: number };

const HIT_CONDITION_PATTERN = /^(>=|%)?([0-9]+)$/;

export function isBreakpointHitCondition(value: unknown): value is BreakpointHitCondition {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "kind" && key !== "count")) return false;
  return (
    (record.kind === "equals" || record.kind === "greaterOrEqual" || record.kind === "multiple") &&
    Number.isSafeInteger(record.count) &&
    (record.count as number) >= 1
  );
}

/** Parses editor input. Blank input intentionally means no hit condition. */
export function parseBreakpointHitCondition(input: string): BreakpointHitCondition | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  const match = HIT_CONDITION_PATTERN.exec(trimmed);
  if (!match) return null;

  const count = Number(match[2]);
  if (!Number.isSafeInteger(count) || count < 1) return null;

  if (match[1] === ">=") return { kind: "greaterOrEqual", count };
  if (match[1] === "%") return { kind: "multiple", count };
  return { kind: "equals", count };
}

export function formatBreakpointHitCondition(
  value: BreakpointHitCondition | null | undefined,
): string {
  if (value == null) return "";
  const prefix = value.kind === "greaterOrEqual" ? ">=" : value.kind === "multiple" ? "%" : "";
  return `${prefix}${value.count}`;
}

/** Returns a screen-reader-friendly validation message, or null for valid/blank input. */
export function breakpointHitConditionError(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "" || parseBreakpointHitCondition(trimmed)) return null;

  if (/^(>=|%)?[0-9]+$/.test(trimmed)) {
    return `Hit count must be a whole number from 1 to ${Number.MAX_SAFE_INTEGER}.`;
  }

  return "Use N, >=N, or %N, where N is a positive whole number.";
}
