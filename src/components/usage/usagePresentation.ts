import type {
  AgentAccountUsageLoadState,
  AgentAccountUsageWindow,
} from "../../domain/agentAccountUsage";
import type { AgentUsageProvider } from "../../domain/agentUsage";
import {
  calendarDateTime,
  type CalendarClock,
  type CalendarDateTime,
} from "../../domain/calendarDateTime";
import {
  agentAccountUsageResetEpochMs,
  USAGE_READING_STALE_AFTER_MS,
} from "../../domain/agentAccountUsageFreshness";

export type UsageProviderKind = AgentUsageProvider["provider"];

export type UsageAccountStates = Readonly<Record<UsageProviderKind, AgentAccountUsageLoadState>>;

export interface UsageLimitBarModel {
  readonly id: string;
  readonly label: string;
  readonly reading: UsageReading;
  readonly usedPercent: number;
  readonly usedLabel: string;
  readonly elapsedPercent: number | null;
  readonly resetsLabel: string;
  readonly resetsTitle: string | null;
  readonly hot: boolean;
  readonly aheadOfPace: boolean;
  readonly ariaLabel: string;
}

export type UsageReading = "current" | "asOf" | "notMeasured";

export interface UsageReadingAsOf {
  readonly label: string;
  readonly title: string;
  readonly when: string;
}

export interface VisibleUsageWindows {
  readonly windows: ReadonlyArray<AgentAccountUsageWindow>;
  readonly hiddenCount: number;
}

export const USAGE_HOT_PERCENT = 90;
const PACE_TOLERANCE_PERCENT = 5;
const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_DATE_EPOCH_MS = 8.64e15;

export type UsageResetClock = Omit<CalendarClock, "nowEpochMs">;

export function usageLimitBarModel(
  window: AgentAccountUsageWindow,
  nowEpochMs: number,
  clock: UsageResetClock = {},
  asOf: UsageReadingAsOf | null = null,
): UsageLimitBarModel {
  const reset = resetText(window, { ...clock, nowEpochMs });
  if (reset.passed) return unmeasuredBarModel(window, reset.label);
  const usedPercent = clampPercent(window.usedPercent);
  const elapsedPercent = elapsedShare(window, nowEpochMs);
  const usedLabel = `${formatPercent(usedPercent)} used`;
  const resetsLabel = reset.label;
  const elapsedText =
    elapsedPercent === null ? "" : `, ${Math.round(elapsedPercent)}% of the window elapsed`;
  const asOfText = asOf === null ? "" : `, last measured ${asOf.when}`;
  return {
    id: window.id,
    label: window.label,
    reading: asOf === null ? "current" : "asOf",
    usedPercent,
    usedLabel,
    elapsedPercent,
    resetsLabel,
    resetsTitle: reset.title,
    hot: usedPercent >= USAGE_HOT_PERCENT,
    aheadOfPace: elapsedPercent !== null && usedPercent > elapsedPercent + PACE_TOLERANCE_PERCENT,
    ariaLabel: `${window.label}: ${usedLabel}${elapsedText}, ${lowerFirst(resetsLabel)}${asOfText}`,
  };
}

export function usageReadingAsOf(
  observedAtEpochMs: number,
  nowEpochMs: number,
  clock: UsageResetClock = {},
): UsageReadingAsOf | null {
  if (nowEpochMs - observedAtEpochMs < USAGE_READING_STALE_AFTER_MS) return null;
  const at = calendarDateTime(observedAtEpochMs, { ...clock, nowEpochMs });
  if (at === null) return null;
  const when = dayTime(at);
  return { label: `As of ${when}`, title: `Last measured ${at.title}`, when };
}

function unmeasuredBarModel(
  window: AgentAccountUsageWindow,
  resetsLabel: string,
): UsageLimitBarModel {
  return {
    id: window.id,
    label: window.label,
    reading: "notMeasured",
    usedPercent: 0,
    usedLabel: "Not measured",
    elapsedPercent: null,
    resetsLabel,
    resetsTitle: null,
    hot: false,
    aheadOfPace: false,
    ariaLabel: `${window.label}: not measured since the window reset`,
  };
}

export function visibleUsageWindows(
  windows: ReadonlyArray<AgentAccountUsageWindow>,
  maxVisible: number,
): VisibleUsageWindows {
  const limit = Number.isFinite(maxVisible) ? Math.max(0, Math.floor(maxVisible)) : windows.length;
  const visible = windows.slice(0, limit);
  return { windows: visible, hiddenCount: windows.length - visible.length };
}

export function usageProviderLimitsNotice(state: AgentAccountUsageLoadState): string | null {
  switch (state.kind) {
    case "idle":
      return "Available after the next provider turn.";
    case "loading":
      return "Updating…";
    case "unavailable":
      return "No limits reported by the latest turn.";
    case "ready":
      return state.snapshot.windows.length === 0 ? "The provider reported no limit windows." : null;
    default:
      return state satisfies never;
  }
}

export function latestUsageFetch(accountUsage: UsageAccountStates): number | null {
  let latest: number | null = null;
  for (const state of Object.values(accountUsage)) {
    if (state.kind !== "ready") continue;
    const fetchedAt = state.snapshot.fetchedAtEpochMs;
    latest = latest === null ? fetchedAt : Math.max(latest, fetchedAt);
  }
  return latest;
}

export function usageProviderLabel(provider: UsageProviderKind): string {
  return provider === "claudeCode" ? "Claude Code" : "Codex";
}

export function updatedLabel(observedAtEpochMs: number, nowEpochMs: number): string {
  const elapsedMs = Math.max(0, nowEpochMs - observedAtEpochMs);
  if (elapsedMs < 60_000) return "Updated just now";
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  return `Updated ${Math.floor(hours / 24)}d ago`;
}

export function formatInteger(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function formatPercent(value: number): string {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}%`;
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 0.01 ? 4 : 2,
    maximumFractionDigits: value < 0.01 ? 4 : 2,
  }).format(value);
}

function elapsedShare(window: AgentAccountUsageWindow, nowEpochMs: number): number | null {
  if (window.windowDurationMinutes === null || window.windowDurationMinutes <= 0) return null;
  const resetsAtEpochMs = representableResetEpochMs(window.resetsAtEpochMs);
  if (resetsAtEpochMs === null) return null;
  const durationMs = window.windowDurationMinutes * 60_000;
  const remainingMs = resetsAtEpochMs - nowEpochMs;
  return clampPercent(Math.round((1 - remainingMs / durationMs) * 1_000) / 10);
}

export function representableResetEpochMs(epochMs: number | null): number | null {
  if (epochMs === null || !Number.isFinite(epochMs)) return null;
  if (Math.abs(epochMs) > MAX_DATE_EPOCH_MS) return null;
  return epochMs;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

interface ResetText {
  readonly label: string;
  readonly title: string | null;
  readonly passed: boolean;
}

function resetText(window: AgentAccountUsageWindow, clock: CalendarClock): ResetText {
  const label = window.resetsLabel;
  const epochMs = agentAccountUsageResetEpochMs(window, clock.nowEpochMs);
  const unparsed = {
    label: label === null ? "Reset unavailable" : `Resets ${label}`,
    title: null,
    passed: false,
  };
  if (epochMs === null) return unparsed;
  const remainingMs = epochMs - clock.nowEpochMs;
  if (remainingMs <= 0) return { label: "Reset passed", title: null, passed: true };
  const at = calendarDateTime(epochMs, clock);
  if (at === null) return unparsed;
  return {
    label: `Resets ${dayTime(at)}`,
    title: `${at.title} · in ${countdown(remainingMs)}`,
    passed: false,
  };
}

function dayTime(at: CalendarDateTime): string {
  switch (at.relation) {
    case "today":
    case "yesterday":
    case "tomorrow":
      return `${at.day} at ${at.time}`;
    case "sameYear":
    case "otherYear":
      return `${at.day} ${at.time}`;
    default:
      return at.relation satisfies never;
  }
}

function countdown(remainingMs: number): string {
  const days = Math.floor(remainingMs / DAY_MS);
  const hours = Math.floor((remainingMs % DAY_MS) / 3_600_000);
  const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
