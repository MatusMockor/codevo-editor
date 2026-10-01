import type { AgentUsageMetrics, AgentUsageProvider } from "../../domain/agentUsage";
import {
  formatInteger,
  formatUsd,
  usageProviderLabel,
  type UsageProviderKind,
} from "./usagePresentation";

export type UsageProviders = Readonly<Record<UsageProviderKind, AgentUsageProvider>>;

export interface LocalSpendSummary {
  readonly costUsd: number | null;
  readonly tokens: number | null;
  readonly turns: number;
  readonly backgroundTurns: number;
  readonly costMeasuredRuns: number;
  readonly costEligibleRuns: number;
  readonly costInferredRuns: number;
  readonly costProviders: ReadonlyArray<UsageProviderKind>;
  readonly costlessProviders: ReadonlyArray<UsageProviderKind>;
}

export interface UsageBreakdownRow {
  readonly key: string;
  readonly provider: UsageProviderKind;
  readonly label: string;
  readonly turns: number;
  readonly tokens: number | null;
  readonly wallTimeMs: number | null;
  readonly costUsd: number | null;
}

export const USAGE_PROJECT_ROWS_VISIBLE = 5;
const EMPTY_CELL = "—";

export function localSpendSummary(providers: UsageProviders): LocalSpendSummary {
  let costUsd: number | null = 0;
  let tokens = 0;
  let hasTokens = false;
  let turns = 0;
  let backgroundTurns = 0;
  let costMeasuredRuns = 0;
  let costEligibleRuns = 0;
  let costInferredRuns = 0;
  const costProviders: UsageProviderKind[] = [];
  const costlessProviders: UsageProviderKind[] = [];
  for (const provider of Object.values(providers)) {
    const metrics = provider.total;
    const cli = metrics.cliUsage;
    turns += metrics.turnsStarted;
    backgroundTurns += metrics.turnsBackground;
    const processed = processedTokens(metrics);
    if (processed !== null) {
      tokens += processed;
      hasTokens = true;
    }
    if (!usageProviderReportsCost(provider.provider)) {
      if (metrics.turnsStarted + metrics.turnsBackground > 0) {
        costlessProviders.push(provider.provider);
      }
      continue;
    }
    if (cli.eligibleTurns > 0) costProviders.push(provider.provider);
    costMeasuredRuns += cli.costMeasuredTurns;
    costEligibleRuns += cli.eligibleTurns;
    costInferredRuns += cli.costInferredTurns;
    if (cli.costMeasuredTurns === 0) continue;
    costUsd = costUsd === null || cli.costUsd === null ? null : costUsd + cli.costUsd;
  }
  return {
    costUsd: costMeasuredRuns === 0 ? null : costUsd,
    tokens: hasTokens ? tokens : null,
    turns,
    backgroundTurns,
    costMeasuredRuns,
    costEligibleRuns,
    costInferredRuns,
    costProviders,
    costlessProviders,
  };
}

export function localActivityNote(summary: LocalSpendSummary, historyIncomplete: boolean): string {
  const sentences = [
    "Saved threads on this device, not subscription billing.",
    "Cost is the provider-reported API equivalent; tokens include cached input.",
  ];
  const background = summary.backgroundTurns;
  if (background > 0) {
    sentences.push(
      background === 1
        ? "Totals also include 1 background continuation, which is not counted as a turn."
        : `Totals also include ${formatInteger(background)} background continuations, which are not counted as turns.`,
    );
  }
  if (summary.costMeasuredRuns > 0 && summary.costUsd === null) {
    sentences.push(
      "The cost total is unavailable because a provider's reported costs could not be added up.",
    );
  }
  const missing = summary.costEligibleRuns - summary.costMeasuredRuns;
  if (missing > 0) {
    sentences.push(
      `Cost is unavailable for ${formatInteger(missing)} of ${formatInteger(summary.costEligibleRuns)} finished ${providerNames(summary.costProviders)} turns and continuations.`,
    );
  }
  const inferred = summary.costInferredRuns;
  if (inferred > 0) {
    sentences.push(
      inferred === 1
        ? "The cost of 1 turn or continuation is inferred from Claude Code's running session total."
        : `The cost of ${formatInteger(inferred)} turns or continuations is inferred from Claude Code's running session total.`,
    );
  }
  const costless = summary.costlessProviders;
  if (costless.length > 0) {
    sentences.push(
      `${providerNames(costless)} ${costless.length === 1 ? "does" : "do"} not report cost.`,
    );
  }
  if (historyIncomplete) {
    sentences.push("Saved history is incomplete because older turns were evicted.");
  }
  return sentences.join(" ");
}

export function usageProviderReportsCost(provider: UsageProviderKind): boolean {
  switch (provider) {
    case "claudeCode":
      return true;
    case "codex":
      return false;
    default:
      return unsupportedProvider(provider);
  }
}

export function usageProviderRows(providers: UsageProviders): ReadonlyArray<UsageBreakdownRow> {
  return Object.values(providers).map((provider) =>
    breakdownRow(
      provider.provider,
      provider.provider,
      usageProviderLabel(provider.provider),
      provider.total,
    ),
  );
}

export function usageProjectRows(
  providers: UsageProviders,
  labelOf: (rootKey: string) => string,
): ReadonlyArray<UsageBreakdownRow> {
  return Object.values(providers)
    .flatMap((provider) =>
      provider.projects
        .filter(({ metrics }) => metrics.turnsStarted + metrics.turnsBackground > 0)
        .map((project) =>
          breakdownRow(
            JSON.stringify([provider.provider, project.rootKey]),
            provider.provider,
            labelOf(project.rootKey),
            project.metrics,
          ),
        ),
    )
    .sort(
      (left, right) =>
        right.turns - left.turns ||
        left.label.localeCompare(right.label) ||
        left.key.localeCompare(right.key),
    );
}

export function projectLabelFromRootKey(rootKey: string): string {
  const segments = rootKey.split(/[\\/]/u).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? rootKey;
}

export function usageTurnsCell(turns: number): string {
  return formatInteger(turns);
}

export function usageTokensCell(tokens: number | null): string {
  return tokens === null ? EMPTY_CELL : formatInteger(tokens);
}

export function usageCostCell(costUsd: number | null): string {
  return costUsd === null ? EMPTY_CELL : formatUsd(costUsd);
}

export function usageDurationCell(totalMs: number | null): string {
  if (totalMs === null || totalMs <= 0) return EMPTY_CELL;
  if (totalMs < 1_000) return `${totalMs} ms`;
  const totalSeconds = Math.floor(totalMs / 1_000);
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${minutes} min`;
}

function breakdownRow(
  key: string,
  provider: UsageProviderKind,
  label: string,
  metrics: AgentUsageMetrics,
): UsageBreakdownRow {
  const cli = metrics.cliUsage;
  return {
    key,
    provider,
    label,
    turns: metrics.turnsStarted,
    tokens: processedTokens(metrics),
    wallTimeMs: metrics.wallTime.measuredTurns === 0 ? null : metrics.wallTime.totalMs,
    costUsd: cli.costMeasuredTurns === 0 ? null : cli.costUsd,
  };
}

function processedTokens(metrics: AgentUsageMetrics): number | null {
  const cli = metrics.cliUsage;
  if (cli.measuredTurns === 0 || cli.inputTokens === null || cli.outputTokens === null) {
    return null;
  }
  return cli.inputTokens + cli.outputTokens;
}

function providerNames(providers: ReadonlyArray<UsageProviderKind>): string {
  return providers.map(usageProviderLabel).join(" and ");
}

function unsupportedProvider(provider: never): never {
  throw new TypeError(`Unsupported usage provider: ${String(provider)}.`);
}
