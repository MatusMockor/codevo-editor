import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { AgentThread } from "../../domain/agentThread";
import type { AgentAccountUsageLoadState } from "../../domain/agentAccountUsage";
import {
  aggregateAgentUsage,
  type AgentCliUsageSource,
  type AgentUsageMetrics,
  type AgentUsagePeriod,
  type AgentUsageProvider,
} from "../../domain/agentUsage";

export interface AgentUsagePanelProps {
  readonly threads: ReadonlyArray<AgentThread>;
  readonly projectLabels: ReadonlyMap<string, string>;
  readonly accountUsage?: Readonly<Record<"claudeCode" | "codex", AgentAccountUsageLoadState>>;
  readonly nowEpochMs?: number;
}

interface PeriodOption {
  readonly period: AgentUsagePeriod;
  readonly label: string;
}

const PERIODS: ReadonlyArray<PeriodOption> = [
  { period: "today", label: "Today" },
  { period: "7days", label: "7 days" },
  { period: "30days", label: "30 days" },
];

const PROVIDER_ORDER = ["claudeCode", "codex"] as const;

export function AgentUsagePanel({
  accountUsage,
  nowEpochMs = Date.now(),
  projectLabels,
  threads,
}: AgentUsagePanelProps) {
  const [period, setPeriod] = useState<AgentUsagePeriod>("today");
  const periodTabsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const usage = useMemo(
    () => aggregateAgentUsage(threads, period, nowEpochMs),
    [nowEpochMs, period, threads],
  );
  const handlePeriodKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const target = periodTabIndex(event.key, index);
    if (target === null) return;
    const option = PERIODS[target];
    if (option === undefined) return;
    event.preventDefault();
    setPeriod(option.period);
    periodTabsRef.current[target]?.focus();
  };

  return (
    <section aria-label="Usage" className="agent-usage-panel">
      <header className="agent-usage-panel__header">
        <h2>Usage</h2>
        <p>Provider account limits and Saved threads on this device.</p>
      </header>
      <section aria-label="Account limits" className="agent-usage-panel__limits">
        <h3>Account limits</h3>
        {PROVIDER_ORDER.map((provider) => (
          <AccountLimits
            key={provider}
            provider={provider}
            state={accountUsage?.[provider] ?? { kind: "idle" }}
          />
        ))}
      </section>
      <div className="agent-usage-panel__local-heading">
        <h3>Local activity</h3>
        <p>Saved Codevo threads; not billing usage.</p>
      </div>
      <div aria-label="Usage period" className="agent-usage-panel__periods" role="tablist">
        {PERIODS.map((option, index) => (
          <button
            aria-controls="agent-usage-period-panel"
            aria-label={option.label}
            aria-selected={period === option.period}
            id={`agent-usage-period-${option.period}`}
            key={option.period}
            onClick={() => setPeriod(option.period)}
            onKeyDown={(event) => handlePeriodKeyDown(event, index)}
            ref={(node) => {
              periodTabsRef.current[index] = node;
            }}
            role="tab"
            tabIndex={period === option.period ? 0 : -1}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      <div
        aria-labelledby={`agent-usage-period-${period}`}
        id="agent-usage-period-panel"
        role="tabpanel"
      >
        {usage.savedHistoryIncomplete ? (
          <p role="note">Saved history is incomplete because older turns were evicted.</p>
        ) : null}
        {PROVIDER_ORDER.map((provider) => (
          <ProviderUsage
            key={provider}
            projectLabels={projectLabels}
            usage={usage.providers[provider]}
          />
        ))}
      </div>
    </section>
  );
}

function AccountLimits({
  provider,
  state,
}: {
  readonly provider: AgentUsageProvider["provider"];
  readonly state: AgentAccountUsageLoadState;
}) {
  return (
    <section aria-label={`${providerLabel(provider)} account limits`}>
      <h4>{providerLabel(provider)}</h4>
      {state.kind === "loading" || state.kind === "idle" ? <p>Loading account limits…</p> : null}
      {state.kind === "unavailable" ? <p>Account limits are unavailable.</p> : null}
      {state.kind === "ready" ? (
        <div className="agent-usage-panel__limit-list">
          {state.snapshot.windows.map((window) => (
            <div className="agent-usage-panel__limit" key={window.id}>
              <div>
                <span>{window.label}</span>
                <strong>{formatPercent(window.usedPercent)} used</strong>
              </div>
              <div
                aria-label={`${window.label}: ${formatPercent(window.usedPercent)} used`}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={Math.round(window.usedPercent)}
                className="agent-usage-panel__meter"
                role="progressbar"
              >
                <span style={{ width: `${window.usedPercent}%` }} />
              </div>
              <p>{resetLabel(window.resetsAtEpochMs, window.resetsLabel)}</p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function periodTabIndex(key: string, current: number): number | null {
  if (key === "ArrowLeft") return (current - 1 + PERIODS.length) % PERIODS.length;
  if (key === "ArrowRight") return (current + 1) % PERIODS.length;
  if (key === "Home") return 0;
  if (key === "End") return PERIODS.length - 1;
  return null;
}

function ProviderUsage({
  projectLabels,
  usage,
}: {
  readonly projectLabels: ReadonlyMap<string, string>;
  readonly usage: AgentUsageProvider;
}) {
  return (
    <section aria-label={`${providerLabel(usage.provider)} usage`}>
      <h3>{providerLabel(usage.provider)}</h3>
      <Metrics metrics={usage.total} />
      <p>CLI source: {sourceLabel(usage.total.cliUsage.source)}</p>
      {usage.projects.length === 0 ? (
        <p>No saved turns in this period.</p>
      ) : (
        <div aria-label={`${providerLabel(usage.provider)} projects`}>
          {usage.projects.map((project) => (
            <section key={project.rootKey}>
              <h4>{projectLabels.get(project.rootKey) ?? project.rootKey}</h4>
              <Metrics metrics={project.metrics} compact />
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function Metrics({ metrics, compact = false }: { metrics: AgentUsageMetrics; compact?: boolean }) {
  const usage = metrics.cliUsage;
  return (
    <div>
      <p>
        {metrics.turnsStarted} started · {metrics.turnsCompleted} completed · {metrics.turnsFailed}{" "}
        failed · {metrics.turnsStoppedOrInterrupted} stopped/interrupted · {metrics.turnsActive}{" "}
        active
      </p>
      <p>
        Wall time: {durationLabel(metrics.wallTime.totalMs)} ({metrics.wallTime.measuredTurns} of{" "}
        {metrics.wallTime.eligibleTurns} ended turns measured)
      </p>
      <StreamOutput metrics={metrics} />
      {!compact && usage.measuredTurns > 0 && usage.inputTokens !== null ? (
        <p>{formatInteger(usage.inputTokens)} input tokens</p>
      ) : null}
      {!compact && usage.measuredTurns > 0 && usage.outputTokens !== null ? (
        <p>{formatInteger(usage.outputTokens)} output tokens</p>
      ) : null}
      {!compact ? (
        <p>
          {usage.measuredTurns} of {usage.eligibleTurns} turns reported CLI usage
          {usage.incomplete ? "; usage evidence is incomplete" : ""}.
        </p>
      ) : null}
    </div>
  );
}

function StreamOutput({ metrics }: { readonly metrics: AgentUsageMetrics }) {
  const output = metrics.streamOutput;
  if (output.eligibleTurns === 0) {
    return <p>Output received by Codevo: No turns in this period.</p>;
  }
  if (output.measuredTurns === 0) {
    return (
      <p>
        Output received by Codevo: Unavailable for these saved turns. Older saved turns may not
        include this measurement. ({output.measuredTurns} of {output.eligibleTurns} turns measured;{" "}
        {output.completeTurns} complete)
      </p>
    );
  }
  if (output.receivedUtf8Bytes === null) {
    return (
      <p>
        Output received by Codevo: Unavailable because the measured total exceeded safe numeric
        bounds. ({output.measuredTurns} of {output.eligibleTurns} turns measured;{" "}
        {output.completeTurns} complete); output coverage is incomplete.
      </p>
    );
  }
  return (
    <p>
      Output received by Codevo: {formatInteger(output.receivedUtf8Bytes)} B ({output.measuredTurns}{" "}
      of {output.eligibleTurns} turns measured; {output.completeTurns} complete)
      {output.incomplete ? "; output coverage is incomplete" : ""}.
    </p>
  );
}

function durationLabel(totalMs: number | null): string {
  if (totalMs === null) return "Unavailable";
  if (totalMs < 1_000) return `${totalMs} ms`;
  const totalSeconds = Math.floor(totalMs / 1_000);
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${minutes} min`;
}

function providerLabel(provider: AgentUsageProvider["provider"]): string {
  return provider === "claudeCode" ? "Claude Code" : "Codex";
}

function sourceLabel(source: AgentCliUsageSource): string {
  return source === "claudeStreamJsonResult"
    ? "Claude Code stream-json result"
    : "Codex JSONL turn.completed";
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}%`;
}

function resetLabel(epochMs: number | null, label: string | null): string {
  if (epochMs !== null) {
    return `Resets ${new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(epochMs)}`;
  }
  return label === null ? "Reset time unavailable" : `Resets ${label}`;
}
