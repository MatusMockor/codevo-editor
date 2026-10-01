import { agentEventReportsSessionNotFound } from "./agentSessionIdentity";
import type { AgentTurn, AgentTurnUsage } from "./agentThread";

export type ClaudeTurnCost =
  | { readonly kind: "unreported" }
  | { readonly kind: "attributed"; readonly costUsd: number; readonly inferred: boolean }
  | { readonly kind: "unattributable" };

type ReadingCost = Exclude<ClaudeTurnCost, { readonly kind: "unreported" }>;

interface CostReading {
  readonly costUsd: number;
  readonly spentTokens: boolean;
}

interface SessionCounter {
  readonly spentUsd: number;
  readonly exact: boolean;
}

interface ReadingStep {
  readonly counter: SessionCounter;
  readonly cost: ReadingCost;
}

const COST_TOLERANCE_USD = 1e-6;
const FRESH_SESSION: SessionCounter = { spentUsd: 0, exact: true };
const UNREPORTED: ClaudeTurnCost = { kind: "unreported" };
const UNATTRIBUTABLE: ReadingCost = { kind: "unattributable" };

export function attributeClaudeTurnCosts(
  turns: ReadonlyArray<AgentTurn>,
  sessionBaselineUnknown: boolean,
): ReadonlyArray<ClaudeTurnCost> {
  let counter: SessionCounter = sessionBaselineUnknown
    ? { spentUsd: 0, exact: false }
    : FRESH_SESSION;
  return turns.map((turn) => {
    const readings = costReadings(turn);
    if (lostSession(turn)) counter = FRESH_SESSION;
    let cost = UNREPORTED;
    for (const reading of readings) {
      const step = attributeReading(counter, reading);
      counter = step.counter;
      cost = combine(cost, step.cost);
    }
    return cost;
  });
}

function attributeReading(counter: SessionCounter, reading: CostReading): ReadingStep {
  const reported = reading.costUsd;
  if (reported <= COST_TOLERANCE_USD) return { counter, cost: attributed(0, false) };
  if (reported < counter.spentUsd - COST_TOLERANCE_USD) {
    return {
      counter: { spentUsd: counter.spentUsd + reported, exact: counter.exact },
      cost: attributed(reported, false),
    };
  }
  const restored: SessionCounter = { spentUsd: reported, exact: true };
  if (!reading.spentTokens) return { counter: restored, cost: attributed(0, false) };
  if (!counter.exact) {
    return { counter: { spentUsd: reported, exact: false }, cost: UNATTRIBUTABLE };
  }
  const fresh = counter.spentUsd <= COST_TOLERANCE_USD;
  return {
    counter: restored,
    cost: attributed(Math.max(0, reported - counter.spentUsd), !fresh),
  };
}

function costReadings(turn: AgentTurn): ReadonlyArray<CostReading> {
  const readings: CostReading[] = [];
  for (const event of turn.events) {
    if (event.kind !== "result" || event.usage === null) continue;
    const costUsd = reportedCost(event.usage);
    if (costUsd === null) continue;
    readings.push({
      costUsd,
      spentTokens: event.usage.inputTokens > 0 || event.usage.outputTokens > 0,
    });
  }
  return readings;
}

function lostSession(turn: AgentTurn): boolean {
  if (!failedTurn(turn)) return false;
  if (turn.events.some((event) => event.kind === "result")) return false;
  return turn.events.some((event) => agentEventReportsSessionNotFound("claudeCode", event));
}

function failedTurn(turn: AgentTurn): boolean {
  const status = turn.status;
  if (status.kind === "failed") return true;
  return status.kind === "exited" && status.exitCode !== 0;
}

function reportedCost(usage: AgentTurnUsage): number | null {
  const costUsd = usage.costUsd;
  if (typeof costUsd !== "number" || !Number.isFinite(costUsd) || costUsd < 0) return null;
  return costUsd;
}

function combine(current: ClaudeTurnCost, next: ReadingCost): ClaudeTurnCost {
  switch (current.kind) {
    case "unreported":
      return next;
    case "unattributable":
      return current;
    case "attributed":
      return next.kind === "attributed"
        ? attributed(current.costUsd + next.costUsd, current.inferred || next.inferred)
        : next;
    default:
      return unsupportedCost(current);
  }
}

function attributed(costUsd: number, inferred: boolean): ReadingCost {
  return { kind: "attributed", costUsd, inferred };
}

function unsupportedCost(cost: never): never {
  throw new TypeError(`Unsupported Claude turn cost: ${JSON.stringify(cost)}.`);
}
