import type { AgentCliKind } from "./agentTask";
import type { AgentAppServerTokenBreakdown, AgentTurn, AgentTurnUsage } from "./agentThread";
import { attributeClaudeTurnCosts, type ClaudeTurnCost } from "./claudeTurnCostAttribution";

export interface AgentTurnTokens {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number | null;
  readonly costInferred: boolean;
}

export type AgentTurnTokenMeasurement =
  | { readonly kind: "unreported" }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "unknownBaseline" }
  | { readonly kind: "carriedAcrossPeriod" }
  | { readonly kind: "measured"; readonly tokens: AgentTurnTokens };

export type AgentTurnTokenMeasurer = (turn: AgentTurn, index: number) => AgentTurnTokenMeasurement;

type ThreadTotalBaseline =
  | { readonly kind: "zero" }
  | { readonly kind: "unknown" }
  | { readonly kind: "known"; readonly total: AgentAppServerTokenBreakdown };

type ReportedUsage =
  | { readonly kind: "none" }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "perTurn"; readonly usage: AgentTurnUsage }
  | {
      readonly kind: "cumulative";
      readonly total: AgentAppServerTokenBreakdown;
      readonly costUsd: number | null;
      readonly ordered: boolean;
    };

const UNREPORTED: AgentTurnTokenMeasurement = { kind: "unreported" };
const AMBIGUOUS: AgentTurnTokenMeasurement = { kind: "ambiguous" };
const UNKNOWN_BASELINE: AgentTurnTokenMeasurement = { kind: "unknownBaseline" };
const CARRIED_ACROSS_PERIOD: AgentTurnTokenMeasurement = { kind: "carriedAcrossPeriod" };
const ZERO: ThreadTotalBaseline = { kind: "zero" };
const UNKNOWN: ThreadTotalBaseline = { kind: "unknown" };
const NO_REPORT: ReportedUsage = { kind: "none" };
const AMBIGUOUS_REPORT: ReportedUsage = { kind: "ambiguous" };

export function agentTurnTokenMeasurer(
  provider: AgentCliKind,
  turns: ReadonlyArray<AgentTurn>,
  earlierTurnsMissing: boolean,
  periodStartEpochMs: number,
): AgentTurnTokenMeasurer {
  if (provider !== "codex") {
    const costs = attributeClaudeTurnCosts(turns, earlierTurnsMissing);
    return (turn, index) => withAttributedCost(measureAgentTurnTokensPerTurn(turn), costs[index]);
  }
  const measurements = measureAgentTurnTokens(turns, earlierTurnsMissing, periodStartEpochMs);
  return (_turn, index) => measurements[index] ?? AMBIGUOUS;
}

export function measureAgentTurnTokensPerTurn(turn: AgentTurn): AgentTurnTokenMeasurement {
  const usages = reportedUsages(turn);
  const [usage] = usages;
  if (usage === undefined) return UNREPORTED;
  if (usages.length > 1) return AMBIGUOUS;
  return perTurn(usage);
}

export function measureAgentTurnTokens(
  turns: ReadonlyArray<AgentTurn>,
  earlierTurnsMissing: boolean,
  periodStartEpochMs: number,
): ReadonlyArray<AgentTurnTokenMeasurement> {
  let baseline = earlierTurnsMissing ? UNKNOWN : ZERO;
  let carriedFromEpochMs: number | null = null;
  const measurements: AgentTurnTokenMeasurement[] = [];
  for (const turn of turns) {
    const reported = classifyReportedUsage(turn);
    if (reported.kind === "none") {
      carriedFromEpochMs ??= turn.startedAtEpochMs;
      measurements.push(UNREPORTED);
      continue;
    }
    const carriedFrom = carriedFromEpochMs;
    carriedFromEpochMs = null;
    if (reported.kind === "ambiguous") {
      baseline = UNKNOWN;
      measurements.push(AMBIGUOUS);
      continue;
    }
    if (reported.kind === "perTurn") {
      baseline = UNKNOWN;
      measurements.push(perTurn(reported.usage));
      continue;
    }
    const measurement = reported.ordered
      ? delta(baseline, reported.total, reported.costUsd)
      : AMBIGUOUS;
    measurements.push(withinPeriod(measurement, carriedFrom, periodStartEpochMs));
    baseline = { kind: "known", total: reported.total };
  }
  return measurements;
}

function withinPeriod(
  measurement: AgentTurnTokenMeasurement,
  carriedFromEpochMs: number | null,
  periodStartEpochMs: number,
): AgentTurnTokenMeasurement {
  if (measurement.kind !== "measured" || carriedFromEpochMs === null) return measurement;
  if (Number.isSafeInteger(carriedFromEpochMs) && carriedFromEpochMs >= periodStartEpochMs) {
    return measurement;
  }
  return CARRIED_ACROSS_PERIOD;
}

function withAttributedCost(
  measurement: AgentTurnTokenMeasurement,
  cost: ClaudeTurnCost | undefined,
): AgentTurnTokenMeasurement {
  if (measurement.kind !== "measured") return measurement;
  if (cost?.kind !== "attributed") {
    return { kind: "measured", tokens: { ...measurement.tokens, costUsd: null } };
  }
  return {
    kind: "measured",
    tokens: { ...measurement.tokens, costUsd: cost.costUsd, costInferred: cost.inferred },
  };
}

function reportedUsages(turn: AgentTurn): ReadonlyArray<AgentTurnUsage> {
  const usages: AgentTurnUsage[] = [];
  for (const event of turn.events) {
    if (event.kind !== "result" || event.usage === null) continue;
    usages.push(event.usage);
  }
  return usages;
}

function classifyReportedUsage(turn: AgentTurn): ReportedUsage {
  const usages = reportedUsages(turn);
  const [first] = usages;
  if (first === undefined) return NO_REPORT;
  if (usages.length === 1 && first.appServerUsage === undefined) {
    return { kind: "perTurn", usage: first };
  }
  return cumulativeReport(usages);
}

function cumulativeReport(usages: ReadonlyArray<AgentTurnUsage>): ReportedUsage {
  let previous: AgentAppServerTokenBreakdown | null = null;
  let ordered = true;
  let costUsd: number | null = 0;
  for (const usage of usages) {
    const total = usage.appServerUsage?.total;
    if (total === undefined) return AMBIGUOUS_REPORT;
    if (previous !== null && !notBelow(total, previous)) ordered = false;
    costUsd = addCost(costUsd, usage.costUsd ?? null);
    previous = total;
  }
  if (previous === null) return NO_REPORT;
  return { kind: "cumulative", total: previous, costUsd, ordered };
}

function notBelow(
  total: AgentAppServerTokenBreakdown,
  previous: AgentAppServerTokenBreakdown,
): boolean {
  return total.inputTokens >= previous.inputTokens && total.outputTokens >= previous.outputTokens;
}

function addCost(current: number | null, increment: number | null): number | null {
  if (current === null || increment === null) return null;
  return current + increment;
}

function perTurn(usage: AgentTurnUsage): AgentTurnTokenMeasurement {
  return measured(
    usage.contextTokens ?? usage.inputTokens,
    usage.outputTokens,
    usage.costUsd ?? null,
  );
}

function delta(
  baseline: ThreadTotalBaseline,
  total: AgentAppServerTokenBreakdown,
  costUsd: number | null,
): AgentTurnTokenMeasurement {
  switch (baseline.kind) {
    case "zero":
      return measured(total.inputTokens, total.outputTokens, costUsd);
    case "unknown":
      return UNKNOWN_BASELINE;
    case "known": {
      const inputTokens = total.inputTokens - baseline.total.inputTokens;
      const outputTokens = total.outputTokens - baseline.total.outputTokens;
      if (inputTokens < 0 || outputTokens < 0) return UNKNOWN_BASELINE;
      return measured(inputTokens, outputTokens, costUsd);
    }
    default:
      return unsupportedBaseline(baseline);
  }
}

function measured(
  inputTokens: number,
  outputTokens: number,
  costUsd: number | null,
): AgentTurnTokenMeasurement {
  return { kind: "measured", tokens: { inputTokens, outputTokens, costUsd, costInferred: false } };
}

function unsupportedBaseline(baseline: never): never {
  throw new TypeError(`Unsupported token baseline: ${JSON.stringify(baseline)}.`);
}
