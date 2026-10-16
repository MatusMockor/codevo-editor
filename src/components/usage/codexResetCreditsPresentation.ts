import type { AgentAccountUsageLoadState } from "../../domain/agentAccountUsage";
import {
  calendarDateTime,
  type CalendarClock,
  type CalendarDateTime,
} from "../../domain/calendarDateTime";
import type {
  CodexRateLimitResetCredit,
  CodexRateLimitResetDisplaySnapshot,
  CodexRateLimitResetHistoryEntry,
} from "../../domain/codexRateLimitResets";
import {
  formatInteger,
  formatPercent,
  usageLimitBarModel,
  usageReadingAsOf,
} from "./usagePresentation";

export type CodexResetClock = CalendarClock;

export interface CodexResetExpiry {
  readonly label: string;
  readonly iso: string | null;
  readonly title: string | null;
  readonly soon: boolean;
  readonly expired: boolean;
}

export interface CodexResetCreditRow {
  readonly id: string;
  readonly title: string;
  readonly tooltip: string | null;
  readonly expiry: CodexResetExpiry;
}

export type CodexResetAvailableModel =
  | { readonly kind: "unreported" }
  | { readonly kind: "empty" }
  | { readonly kind: "countOnly"; readonly label: string }
  | {
      readonly kind: "credits";
      readonly rows: ReadonlyArray<CodexResetCreditRow>;
      readonly moreLabel: string | null;
    };

export interface CodexResetHistoryRow {
  readonly key: string;
  readonly title: string;
  readonly usedLabel: string;
  readonly iso: string | null;
  readonly fullTitle: string | null;
}

export const CODEX_RESET_DEFAULT_TITLE = "Limit reset";
export const CODEX_RESET_SOON_MS = 48 * 60 * 60 * 1_000;
const DAY_MS = 86_400_000;

export function codexResetAvailableModel(
  snapshot: CodexRateLimitResetDisplaySnapshot,
  clock: CodexResetClock,
): CodexResetAvailableModel {
  const count = snapshot.availableCount;
  if (count === null) return { kind: "unreported" };
  if (count < 1) return { kind: "empty" };
  const credits = snapshot.credits;
  if (credits === null || credits.length === 0)
    return { kind: "countOnly", label: codexResetCountLabel(count) };
  const rows = sortCodexResetCredits(credits).map((credit) => codexResetCreditRow(credit, clock));
  return { kind: "credits", rows, moreLabel: codexResetMoreLabel(count - credits.length) };
}

export function sortCodexResetCredits(
  credits: ReadonlyArray<CodexRateLimitResetCredit>,
): ReadonlyArray<CodexRateLimitResetCredit> {
  return [...credits].sort(
    (left, right) =>
      expiryRank(left.expiresAtEpochMs) - expiryRank(right.expiresAtEpochMs) ||
      left.grantedAtEpochMs - right.grantedAtEpochMs ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
}

export function codexResetCreditRow(
  credit: CodexRateLimitResetCredit,
  clock: CodexResetClock,
): CodexResetCreditRow {
  return {
    id: credit.id,
    title: codexResetTitle(credit.title),
    tooltip: credit.description,
    expiry: codexResetExpiry(credit.expiresAtEpochMs, clock),
  };
}

export function codexResetTitle(title: string | null): string {
  return title ?? CODEX_RESET_DEFAULT_TITLE;
}

export function codexResetExpiry(
  expiresAtEpochMs: number | null,
  clock: CodexResetClock,
): CodexResetExpiry {
  if (expiresAtEpochMs === null)
    return { label: "Doesn't expire", iso: null, title: null, soon: false, expired: false };
  const remainingMs = expiresAtEpochMs - clock.nowEpochMs;
  const at = calendarDateTime(expiresAtEpochMs, clock);
  if (at === null)
    return {
      label: "Expiry date unavailable",
      iso: null,
      title: null,
      soon: false,
      expired: false,
    };
  if (remainingMs <= 0)
    return { label: "Expired", iso: at.iso, title: at.title, soon: true, expired: true };
  const days = calendarDayDelta(expiresAtEpochMs, clock);
  const relative = days !== null && days > 1 ? ` · in ${days} days` : "";
  return {
    label: `Expires ${dayTime(at, expiresAtEpochMs, clock)}${relative}`,
    iso: at.iso,
    title: at.title,
    soon: remainingMs < CODEX_RESET_SOON_MS,
    expired: false,
  };
}

export function codexResetHistoryRows(
  history: ReadonlyArray<CodexRateLimitResetHistoryEntry>,
  clock: CodexResetClock,
): ReadonlyArray<CodexResetHistoryRow> {
  return [...history]
    .sort(
      (left, right) =>
        right.usedAtEpochMs - left.usedAtEpochMs ||
        (left.operationId < right.operationId ? -1 : left.operationId > right.operationId ? 1 : 0),
    )
    .map((entry) => {
      const at = calendarDateTime(entry.usedAtEpochMs, clock);
      return {
        key: entry.operationId,
        title: codexResetTitle(entry.creditTitle),
        usedLabel: at === null ? "Used" : `Used ${dayTime(at, entry.usedAtEpochMs, clock)}`,
        iso: at?.iso ?? null,
        fullTitle: at?.title ?? null,
      };
    });
}

export function codexResetCountLabel(count: number): string {
  return count === 1 ? "1 reset available" : `${formatInteger(count)} resets available`;
}

export function codexResetMoreLabel(hidden: number): string | null {
  if (hidden < 1) return null;
  if (hidden === 1) return "1 more reset available - Codex didn't send its details.";
  return `${formatInteger(hidden)} more resets available - Codex didn't send their details.`;
}

export function codexResetSegmentLabel(count: number | null): string {
  return count === null ? "Available" : `Available ${formatInteger(count)}`;
}

export interface CodexResetConfirmCopy {
  readonly question: string;
  readonly detail: string;
  readonly action: string;
}

export function codexResetConfirmCopy(
  row: CodexResetCreditRow | null,
  retrying: boolean,
  usageNote: string | null,
): CodexResetConfirmCopy {
  if (retrying)
    return {
      question: "Check the result of the last reset?",
      detail:
        "Codevo retries the same reset. No additional credit is used if it already went through.",
      action: "Retry reset",
    };
  const note = usageNote === null ? "" : ` ${usageNote}`;
  return {
    question: row === null ? "Use a limit reset now?" : `Use this ${row.title} now?`,
    detail: `Eligible Codex limits reset immediately.${note} This can't be undone.`,
    action: "Use reset",
  };
}

export function codexResetUsageNote(
  state: AgentAccountUsageLoadState | undefined,
  nowEpochMs: number,
): string | null {
  if (state?.kind !== "ready") return null;
  if (usageReadingAsOf(state.snapshot.fetchedAtEpochMs, nowEpochMs) !== null) return null;
  const current = state.snapshot.windows
    .map((window) => usageLimitBarModel(window, nowEpochMs))
    .filter((model) => model.reading === "current");
  const highest = current.reduce<(typeof current)[number] | null>(
    (best, model) => (best === null || model.usedPercent > best.usedPercent ? model : best),
    null,
  );
  if (highest === null) return null;
  return `You're at ${formatPercent(highest.usedPercent)} of your ${lowerLeadingWord(highest.label)}.`;
}

function dayTime(at: CalendarDateTime, epochMs: number, clock: CodexResetClock): string {
  switch (at.relation) {
    case "yesterday":
    case "today":
    case "tomorrow":
      return `${at.day}, ${at.time}`;
    case "sameYear":
      return `${shortDate(epochMs, clock, false)}, ${at.time}`;
    case "otherYear":
      return `${shortDate(epochMs, clock, true)}, ${at.time}`;
    default:
      return at.relation satisfies never;
  }
}

function shortDate(epochMs: number, clock: CodexResetClock, withYear: boolean): string {
  return new Intl.DateTimeFormat(clock.locale, {
    timeZone: clock.timeZone,
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(epochMs);
}

function calendarDayDelta(epochMs: number, clock: CodexResetClock): number | null {
  const at = civilDayMs(epochMs, clock.timeZone);
  const now = civilDayMs(clock.nowEpochMs, clock.timeZone);
  if (at === null || now === null) return null;
  return Math.round((at - now) / DAY_MS);
}

function civilDayMs(epochMs: number, timeZone: string | undefined): number | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(epochMs);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((entry) => entry.type === type)?.value);
  const value = Date.UTC(part("year"), part("month") - 1, part("day"));
  return Number.isFinite(value) ? value : null;
}

function expiryRank(expiresAtEpochMs: number | null): number {
  return expiresAtEpochMs ?? Number.MAX_SAFE_INTEGER;
}

function lowerLeadingWord(label: string): string {
  return /^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}
