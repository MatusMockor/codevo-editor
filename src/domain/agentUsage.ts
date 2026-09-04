import type { AgentCliKind } from "./agentTask";
import { MAX_AGENT_PROJECT_ROOTS } from "./agentProject";
import {
  MAX_AGENT_THREADS_PER_ROOT,
  MAX_AGENT_TURNS_PER_THREAD,
  isTerminalAgentTurnStatus,
  type AgentThread,
  type AgentTurn,
  type AgentTurnStatus,
} from "./agentThread";

export type AgentUsagePeriod = "today" | "7days" | "30days";

export type AgentCliUsageSource = "claudeStreamJsonResult" | "codexJsonlTurnCompleted";

export interface AgentUsageWallTime {
  readonly totalMs: number | null;
  readonly measuredTurns: number;
  readonly eligibleTurns: number;
}

export interface AgentUsageCliTokens {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly measuredTurns: number;
  readonly eligibleTurns: number;
  readonly costUsd: number | null;
  readonly costMeasuredTurns: number;
  readonly source: AgentCliUsageSource;
  readonly incomplete: boolean;
}

export interface AgentUsageStreamOutput {
  readonly receivedUtf8Bytes: number | null;
  readonly measuredTurns: number;
  readonly completeTurns: number;
  readonly eligibleTurns: number;
  readonly incomplete: boolean;
}

export interface AgentUsageMetrics {
  readonly turnsStarted: number;
  readonly turnsCompleted: number;
  readonly turnsFailed: number;
  readonly turnsStoppedOrInterrupted: number;
  readonly turnsActive: number;
  readonly wallTime: AgentUsageWallTime;
  readonly cliUsage: AgentUsageCliTokens;
  readonly streamOutput: AgentUsageStreamOutput;
}

export interface AgentUsageProject {
  readonly rootKey: string;
  readonly metrics: AgentUsageMetrics;
}

export interface AgentUsageProvider {
  readonly provider: AgentCliKind;
  readonly total: AgentUsageMetrics;
  readonly projects: ReadonlyArray<AgentUsageProject>;
}

export interface AgentUsageAggregate {
  readonly period: AgentUsagePeriod;
  readonly startEpochMs: number;
  readonly endEpochMs: number;
  readonly savedHistoryIncomplete: boolean;
  readonly providers: Readonly<Record<AgentCliKind, AgentUsageProvider>>;
}

interface MutableWallTime {
  totalMs: number | null;
  measuredTurns: number;
  eligibleTurns: number;
}

interface MutableCliTokens {
  inputTokens: number | null;
  outputTokens: number | null;
  measuredTurns: number;
  eligibleTurns: number;
  costUsd: number | null;
  costMeasuredTurns: number;
  readonly source: AgentCliUsageSource;
  incomplete: boolean;
}

interface MutableStreamOutput {
  receivedUtf8Bytes: number | null;
  measuredTurns: number;
  completeTurns: number;
  eligibleTurns: number;
  incomplete: boolean;
}

interface MutableMetrics {
  turnsStarted: number;
  turnsCompleted: number;
  turnsFailed: number;
  turnsStoppedOrInterrupted: number;
  turnsActive: number;
  readonly wallTime: MutableWallTime;
  readonly cliUsage: MutableCliTokens;
  readonly streamOutput: MutableStreamOutput;
}

interface MutableProvider {
  readonly provider: AgentCliKind;
  readonly total: MutableMetrics;
  readonly projects: Map<string, MutableMetrics>;
}

const PERIOD_DAYS: Readonly<Record<AgentUsagePeriod, number>> = {
  today: 1,
  "7days": 7,
  "30days": 30,
};
const MAX_AGGREGATED_THREADS = MAX_AGENT_PROJECT_ROOTS * MAX_AGENT_THREADS_PER_ROOT;

export function aggregateAgentUsage(
  threads: Iterable<AgentThread>,
  period: AgentUsagePeriod,
  nowEpochMs: number = Date.now(),
): AgentUsageAggregate {
  const endEpochMs = validEpoch(nowEpochMs) ? nowEpochMs : 0;
  const startEpochMs = agentUsagePeriodStart(period, endEpochMs);
  const providers: Record<AgentCliKind, MutableProvider> = {
    claudeCode: mutableProvider("claudeCode"),
    codex: mutableProvider("codex"),
  };
  let savedHistoryIncomplete = false;
  let inspectedThreads = 0;

  for (const thread of threads) {
    if (inspectedThreads >= MAX_AGGREGATED_THREADS) {
      savedHistoryIncomplete = true;
      break;
    }
    inspectedThreads += 1;
    if (thread.turnsTruncated) savedHistoryIncomplete = true;
    const provider = providers[thread.provider.kind];
    if (thread.turns.length > MAX_AGENT_TURNS_PER_THREAD) savedHistoryIncomplete = true;
    for (const turn of thread.turns.slice(0, MAX_AGENT_TURNS_PER_THREAD)) {
      if (!turnFallsWithin(turn, startEpochMs, endEpochMs)) continue;
      addTurn(provider.total, turn, endEpochMs);
      addTurn(projectMetrics(provider, thread.owner.rootKey), turn, endEpochMs);
    }
  }

  return {
    period,
    startEpochMs,
    endEpochMs,
    savedHistoryIncomplete,
    providers: {
      claudeCode: freezeProvider(providers.claudeCode),
      codex: freezeProvider(providers.codex),
    },
  };
}

export function agentUsagePeriodStart(
  period: AgentUsagePeriod,
  nowEpochMs: number = Date.now(),
): number {
  const now = new Date(validEpoch(nowEpochMs) ? nowEpochMs : 0);
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() - (PERIOD_DAYS[period] - 1));
  return now.getTime();
}

function mutableProvider(provider: AgentCliKind): MutableProvider {
  return { provider, total: mutableMetrics(provider), projects: new Map() };
}

function mutableMetrics(provider: AgentCliKind): MutableMetrics {
  return {
    turnsStarted: 0,
    turnsCompleted: 0,
    turnsFailed: 0,
    turnsStoppedOrInterrupted: 0,
    turnsActive: 0,
    wallTime: { totalMs: 0, measuredTurns: 0, eligibleTurns: 0 },
    cliUsage: {
      inputTokens: 0,
      outputTokens: 0,
      measuredTurns: 0,
      eligibleTurns: 0,
      costUsd: 0,
      costMeasuredTurns: 0,
      source: usageSource(provider),
      incomplete: false,
    },
    streamOutput: {
      receivedUtf8Bytes: 0,
      measuredTurns: 0,
      completeTurns: 0,
      eligibleTurns: 0,
      incomplete: false,
    },
  };
}

function projectMetrics(provider: MutableProvider, rootKey: string): MutableMetrics {
  const existing = provider.projects.get(rootKey);
  if (existing !== undefined) return existing;
  const created = mutableMetrics(provider.provider);
  provider.projects.set(rootKey, created);
  return created;
}

function turnFallsWithin(turn: AgentTurn, startEpochMs: number, endEpochMs: number): boolean {
  return (
    validEpoch(turn.startedAtEpochMs) &&
    turn.startedAtEpochMs >= startEpochMs &&
    turn.startedAtEpochMs <= endEpochMs
  );
}

function addTurn(metrics: MutableMetrics, turn: AgentTurn, windowEndEpochMs: number): void {
  metrics.turnsStarted += 1;
  classifyStatus(metrics, turn.status);
  addWallTime(metrics.wallTime, turn, windowEndEpochMs);
  addCliUsage(metrics.cliUsage, turn);
  addStreamOutput(metrics.streamOutput, turn);
}

function classifyStatus(metrics: MutableMetrics, status: AgentTurnStatus): void {
  switch (status.kind) {
    case "exited":
      if (status.exitCode === 0) metrics.turnsCompleted += 1;
      else metrics.turnsFailed += 1;
      return;
    case "failed":
      metrics.turnsFailed += 1;
      return;
    case "stopped":
    case "interrupted":
      metrics.turnsStoppedOrInterrupted += 1;
      return;
    case "pending":
    case "running":
      metrics.turnsActive += 1;
      return;
    default:
      return unsupportedStatus(status);
  }
}

function addWallTime(wallTime: MutableWallTime, turn: AgentTurn, windowEndEpochMs: number): void {
  if (turn.status.kind === "pending" || turn.status.kind === "running") return;
  wallTime.eligibleTurns += 1;
  if (
    !validEpoch(turn.endedAtEpochMs) ||
    turn.endedAtEpochMs < turn.startedAtEpochMs ||
    turn.endedAtEpochMs > windowEndEpochMs
  ) {
    return;
  }
  const duration = turn.endedAtEpochMs - turn.startedAtEpochMs;
  const total = safeSum(wallTime.totalMs, duration);
  wallTime.totalMs = total;
  wallTime.measuredTurns += 1;
}

function addCliUsage(cliUsage: MutableCliTokens, turn: AgentTurn): void {
  if (turn.status.kind !== "exited") return;
  cliUsage.eligibleTurns += 1;
  if (turn.eventsTruncated) cliUsage.incomplete = true;
  let capturedUsage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly contextTokens?: number | null;
    readonly costUsd?: number | null;
  } | null = null;
  for (const event of turn.events) {
    if (event.kind !== "result" || event.usage === null) continue;
    if (capturedUsage !== null) {
      cliUsage.incomplete = true;
      return;
    }
    capturedUsage = event.usage;
  }
  if (capturedUsage === null) return;
  cliUsage.measuredTurns += 1;
  // Claude reports cache creation/read tokens separately from input_tokens. The parser's
  // contextTokens total includes that processed input, while Codex input_tokens already includes
  // cached input. Prefer it so the Usage headline does not dramatically under-report real work.
  cliUsage.inputTokens = safeSum(
    cliUsage.inputTokens,
    capturedUsage.contextTokens ?? capturedUsage.inputTokens,
  );
  cliUsage.outputTokens = safeSum(cliUsage.outputTokens, capturedUsage.outputTokens);
  if (capturedUsage.costUsd !== undefined && capturedUsage.costUsd !== null) {
    cliUsage.costUsd = safeFiniteSum(cliUsage.costUsd, capturedUsage.costUsd);
    cliUsage.costMeasuredTurns += 1;
  }
  if (cliUsage.inputTokens === null || cliUsage.outputTokens === null) {
    cliUsage.incomplete = true;
  }
}

function safeFiniteSum(current: number | null, increment: number): number | null {
  if (current === null || !Number.isFinite(increment) || increment < 0) return null;
  const sum = current + increment;
  return Number.isFinite(sum) ? sum : null;
}

function addStreamOutput(streamOutput: MutableStreamOutput, turn: AgentTurn): void {
  streamOutput.eligibleTurns += 1;
  const streamMetrics = turn.streamMetrics ?? null;
  if (streamMetrics === null) {
    streamOutput.incomplete = true;
    return;
  }
  if (
    !Number.isSafeInteger(streamMetrics.receivedUtf8Bytes) ||
    streamMetrics.receivedUtf8Bytes < 0 ||
    typeof streamMetrics.complete !== "boolean"
  ) {
    streamOutput.incomplete = true;
    return;
  }
  streamOutput.measuredTurns += 1;
  if (streamMetrics.complete && isTerminalAgentTurnStatus(turn.status)) {
    streamOutput.completeTurns += 1;
  } else {
    streamOutput.incomplete = true;
  }
  streamOutput.receivedUtf8Bytes = safeSum(
    streamOutput.receivedUtf8Bytes,
    streamMetrics.receivedUtf8Bytes,
  );
  if (streamOutput.receivedUtf8Bytes === null) streamOutput.incomplete = true;
}

function safeSum(current: number | null, increment: number): number | null {
  if (current === null) return null;
  if (!Number.isSafeInteger(increment) || increment < 0) return null;
  const sum = current + increment;
  return Number.isSafeInteger(sum) ? sum : null;
}

function validEpoch(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

function usageSource(provider: AgentCliKind): AgentCliUsageSource {
  return provider === "claudeCode" ? "claudeStreamJsonResult" : "codexJsonlTurnCompleted";
}

function freezeProvider(provider: MutableProvider): AgentUsageProvider {
  return {
    provider: provider.provider,
    total: freezeMetrics(provider.total),
    projects: [...provider.projects.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([rootKey, metrics]) => ({ rootKey, metrics: freezeMetrics(metrics) })),
  };
}

function freezeMetrics(metrics: MutableMetrics): AgentUsageMetrics {
  const streamOutput = metrics.streamOutput;
  return {
    turnsStarted: metrics.turnsStarted,
    turnsCompleted: metrics.turnsCompleted,
    turnsFailed: metrics.turnsFailed,
    turnsStoppedOrInterrupted: metrics.turnsStoppedOrInterrupted,
    turnsActive: metrics.turnsActive,
    wallTime: { ...metrics.wallTime },
    cliUsage: { ...metrics.cliUsage },
    streamOutput: {
      ...streamOutput,
      receivedUtf8Bytes: streamOutput.measuredTurns === 0 ? null : streamOutput.receivedUtf8Bytes,
      incomplete:
        streamOutput.incomplete || streamOutput.measuredTurns < streamOutput.eligibleTurns,
    },
  };
}

function unsupportedStatus(status: never): never {
  throw new TypeError(`Unsupported agent usage turn status: ${JSON.stringify(status)}.`);
}
