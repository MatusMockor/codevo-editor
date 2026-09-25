import type {
  AgentAccountUsageLoadState,
  AgentAccountUsageWindow,
} from "../../domain/agentAccountUsage";
import type { AgentUsageProvider } from "../../domain/agentUsage";

export type UsageProviderKind = AgentUsageProvider["provider"];

export type UsageAccountStates = Readonly<Record<UsageProviderKind, AgentAccountUsageLoadState>>;

export interface UsageLimitBarModel {
  readonly id: string;
  readonly label: string;
  readonly usedPercent: number;
  readonly usedLabel: string;
  readonly elapsedPercent: number | null;
  readonly resetsLabel: string;
  readonly hot: boolean;
  readonly aheadOfPace: boolean;
  readonly ariaLabel: string;
}

export interface VisibleUsageWindows {
  readonly windows: ReadonlyArray<AgentAccountUsageWindow>;
  readonly hiddenCount: number;
}

export interface LocalSpendSummary {
  readonly costUsd: number | null;
  readonly tokens: number | null;
  readonly completedTurns: number;
  readonly costMeasuredTurns: number;
  readonly costEligibleTurns: number;
}

export interface UsageProjectRow {
  readonly key: string;
  readonly provider: UsageProviderKind;
  readonly label: string;
  readonly turnsStarted: number;
  readonly tokens: number | null;
  readonly wallTimeMs: number | null;
  readonly costUsd: number | null;
}

export const USAGE_HOT_PERCENT = 90;
export const USAGE_PROJECT_ROWS_VISIBLE = 5;
const PACE_TOLERANCE_PERCENT = 5;
const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_DATE_EPOCH_MS = 8.64e15;

export function usageLimitBarModel(
  window: AgentAccountUsageWindow,
  nowEpochMs: number,
): UsageLimitBarModel {
  const usedPercent = clampPercent(window.usedPercent);
  const elapsedPercent = elapsedShare(window, nowEpochMs);
  const usedLabel = `${formatPercent(usedPercent)} used`;
  const resetsLabel = resetLabel(
    representableResetEpochMs(window.resetsAtEpochMs),
    window.resetsLabel,
    nowEpochMs,
  );
  const elapsedText =
    elapsedPercent === null ? "" : `, ${Math.round(elapsedPercent)}% of the window elapsed`;
  return {
    id: window.id,
    label: window.label,
    usedPercent,
    usedLabel,
    elapsedPercent,
    resetsLabel,
    hot: usedPercent >= USAGE_HOT_PERCENT,
    aheadOfPace: elapsedPercent !== null && usedPercent > elapsedPercent + PACE_TOLERANCE_PERCENT,
    ariaLabel: `${window.label}: ${usedLabel}${elapsedText}, ${lowerFirst(resetsLabel)}`,
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

export function durationLabel(totalMs: number | null): string {
  if (totalMs === null) return "Unavailable";
  if (totalMs < 1_000) return `${totalMs} ms`;
  const totalSeconds = Math.floor(totalMs / 1_000);
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${minutes} min`;
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

export function localSpendSummary(
  providers: Readonly<Record<UsageProviderKind, AgentUsageProvider>>,
): LocalSpendSummary {
  let costUsd = 0;
  let tokens = 0;
  let hasTokens = false;
  let completedTurns = 0;
  let costMeasuredTurns = 0;
  let costEligibleTurns = 0;
  for (const provider of Object.values(providers)) {
    const metrics = provider.total;
    const cli = metrics.cliUsage;
    completedTurns += metrics.turnsCompleted;
    costMeasuredTurns += cli.costMeasuredTurns;
    costEligibleTurns += cli.eligibleTurns;
    if (cli.costUsd !== null) costUsd += cli.costUsd;
    if (cli.measuredTurns > 0 && cli.inputTokens !== null && cli.outputTokens !== null) {
      tokens += cli.inputTokens + cli.outputTokens;
      hasTokens = true;
    }
  }
  return {
    costUsd: costMeasuredTurns === 0 ? null : costUsd,
    tokens: hasTokens ? tokens : null,
    completedTurns,
    costMeasuredTurns,
    costEligibleTurns,
  };
}

export function usageProjectRows(
  providers: Readonly<Record<UsageProviderKind, AgentUsageProvider>>,
  labelOf: (rootKey: string) => string,
): ReadonlyArray<UsageProjectRow> {
  return Object.values(providers)
    .flatMap((provider) =>
      provider.projects.map((project) => {
        const metrics = project.metrics;
        const cli = metrics.cliUsage;
        return {
          key: JSON.stringify([provider.provider, project.rootKey]),
          provider: provider.provider,
          label: labelOf(project.rootKey),
          turnsStarted: metrics.turnsStarted,
          tokens:
            cli.measuredTurns === 0 || cli.inputTokens === null || cli.outputTokens === null
              ? null
              : cli.inputTokens + cli.outputTokens,
          wallTimeMs: metrics.wallTime.totalMs,
          costUsd: cli.costMeasuredTurns === 0 ? null : cli.costUsd,
        };
      }),
    )
    .filter((row) => row.turnsStarted > 0)
    .sort(
      (left, right) =>
        right.turnsStarted - left.turnsStarted ||
        left.label.localeCompare(right.label) ||
        left.key.localeCompare(right.key),
    );
}

export function projectLabelFromRootKey(rootKey: string): string {
  const segments = rootKey.split(/[\\/]/u).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? rootKey;
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

function resetLabel(epochMs: number | null, label: string | null, nowEpochMs: number): string {
  if (epochMs === null) return label === null ? "Reset unavailable" : `Resets ${label}`;
  const remainingMs = epochMs - nowEpochMs;
  if (remainingMs <= 0) return "Reset passed";
  if (remainingMs < DAY_MS) {
    const totalMinutes = Math.ceil(remainingMs / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `Resets in ${hours > 0 ? `${hours}h ` : ""}${minutes}m`;
  }
  return `Resets ${new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(epochMs)}`;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
