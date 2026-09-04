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
import { AgentProviderGlyph } from "./AgentProviderGlyph";

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

const PROVIDER_ORDER = ["codex", "claudeCode"] as const;

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
  const spend = useMemo(() => localSpendSummary(usage.providers), [usage.providers]);
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
      <section aria-label="Subscription limits" className="agent-usage-panel__limits">
        <h3>Subscription limits</h3>
        <div className="agent-usage-panel__limit-providers">
          {PROVIDER_ORDER.map((provider) => (
            <AccountLimits
              key={provider}
              nowEpochMs={nowEpochMs}
              provider={provider}
              state={accountUsage?.[provider] ?? { kind: "idle" }}
            />
          ))}
        </div>
      </section>
      <section aria-label="Local activity" className="agent-usage-panel__local">
        <header className="agent-usage-panel__local-heading">
          <div>
            <h3>Local activity</h3>
            <p>Saved threads and turns on this device, not subscription billing.</p>
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
        </header>
        <section aria-label="API-equivalent usage" className="agent-usage-panel__spend">
          <div>
            <span>Estimated cost</span>
            <strong>{spend.costUsd === null ? "—" : formatUsd(spend.costUsd)}</strong>
          </div>
          <div>
            <span>Processed tokens</span>
            <strong>{spend.tokens === null ? "—" : formatInteger(spend.tokens)}</strong>
          </div>
          <div>
            <span>Completed turns</span>
            <strong>{formatInteger(spend.completedTurns)}</strong>
          </div>
          <p>
            Provider-reported API equivalent for {spend.costMeasuredTurns} of{" "}
            {spend.costEligibleTurns} completed turns. Subscription plans are not billed at this
            amount.
          </p>
        </section>
        <div
          aria-labelledby={`agent-usage-period-${period}`}
          className="agent-usage-panel__provider-grid"
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
    </section>
  );
}

function AccountLimits({
  provider,
  nowEpochMs,
  state,
}: {
  readonly provider: AgentUsageProvider["provider"];
  readonly nowEpochMs: number;
  readonly state: AgentAccountUsageLoadState;
}) {
  return (
    <section
      aria-label={`${providerLabel(provider)} subscription limits`}
      className={`agent-usage-panel__limit-provider agent-usage-panel__limit-provider--${provider === "claudeCode" ? "claude" : "codex"}`}
    >
      <header>
        <h4>
          <AgentProviderGlyph decorative kind={provider} />
          <span>{providerLabel(provider)}</span>
        </h4>
        {state.kind === "ready" ? (
          <span>{updatedLabel(state.snapshot.fetchedAtEpochMs, nowEpochMs)}</span>
        ) : null}
      </header>
      {state.kind === "loading" ? <p>Updating…</p> : null}
      {state.kind === "idle" ? <p>Available after the next provider turn.</p> : null}
      {state.kind === "unavailable" ? <p>No limits reported by the latest turn.</p> : null}
      {state.kind === "ready" ? (
        <div className="agent-usage-panel__limit-list">
          {state.snapshot.windows.map((window) => (
            <div className="agent-usage-panel__limit" key={window.id}>
              <div>
                <span>{window.label}</span>
                <span className="agent-usage-panel__limit-meta">
                  <strong>{formatPercent(window.usedPercent)}</strong>
                  <span>{resetLabel(window.resetsAtEpochMs, window.resetsLabel, nowEpochMs)}</span>
                </span>
              </div>
              <div
                aria-label={`${window.label}: ${formatPercent(window.usedPercent)} used`}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={Math.round(window.usedPercent)}
                className={`agent-usage-panel__meter${window.usedPercent >= 90 ? " agent-usage-panel__meter--danger" : ""}`}
                role="progressbar"
              >
                <span style={{ width: `${window.usedPercent}%` }} />
              </div>
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
  const metrics = usage.total;
  const hasActivity = metrics.turnsStarted > 0;
  return (
    <section
      aria-label={`${providerLabel(usage.provider)} usage`}
      className="agent-usage-panel__provider"
    >
      <h4>
        <AgentProviderGlyph decorative kind={usage.provider} />
        <span>{providerLabel(usage.provider)}</span>
      </h4>
      {hasActivity ? <Metrics metrics={metrics} /> : <p>No saved turns in this period.</p>}
      {hasActivity ? (
        <details className="agent-usage-panel__details">
          <summary>Details</summary>
          <div>
            <p>
              {metrics.turnsStarted} started · {metrics.turnsCompleted} completed ·{" "}
              {metrics.turnsFailed} failed · {metrics.turnsStoppedOrInterrupted} stopped/interrupted
              · {metrics.turnsActive} active
            </p>
            <p>
              Wall time: {durationLabel(metrics.wallTime.totalMs)} ({metrics.wallTime.measuredTurns}{" "}
              of {metrics.wallTime.eligibleTurns} ended turns measured)
            </p>
            <StreamOutput metrics={metrics} />
            <p>
              {metrics.cliUsage.measuredTurns} of {metrics.cliUsage.eligibleTurns} turns reported
              CLI usage{metrics.cliUsage.incomplete ? "; usage evidence is incomplete" : ""}.
            </p>
            <p>CLI source: {sourceLabel(metrics.cliUsage.source)}</p>
            {usage.projects.length > 0 ? (
              <div aria-label={`${providerLabel(usage.provider)} projects`}>
                {usage.projects.map((project) => (
                  <section key={project.rootKey}>
                    <h4>{projectLabels.get(project.rootKey) ?? project.rootKey}</h4>
                    <Metrics metrics={project.metrics} compact />
                  </section>
                ))}
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function Metrics({ metrics, compact = false }: { metrics: AgentUsageMetrics; compact?: boolean }) {
  const usage = metrics.cliUsage;
  const totalTokens =
    usage.measuredTurns === 0 || usage.inputTokens === null || usage.outputTokens === null
      ? null
      : usage.inputTokens + usage.outputTokens;
  return (
    <div
      className={`agent-usage-panel__metrics${compact ? " agent-usage-panel__metrics--compact" : ""}`}
    >
      <Metric label="Turns" value={formatInteger(metrics.turnsStarted)} />
      <Metric label="Completed" value={formatInteger(metrics.turnsCompleted)} />
      {!compact ? (
        <Metric label="Tokens" value={totalTokens === null ? "—" : formatInteger(totalTokens)} />
      ) : null}
      {!compact ? (
        <Metric
          label="Est. cost"
          value={
            usage.costMeasuredTurns === 0 || usage.costUsd === null ? "—" : formatUsd(usage.costUsd)
          }
        />
      ) : null}
      <Metric label="Wall time" value={durationLabel(metrics.wallTime.totalMs)} />
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

function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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

function formatUsd(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 0.01 ? 4 : 2,
    maximumFractionDigits: value < 0.01 ? 4 : 2,
  }).format(value);
}

function localSpendSummary(
  providers: Readonly<Record<AgentUsageProvider["provider"], AgentUsageProvider>>,
): {
  readonly costUsd: number | null;
  readonly tokens: number | null;
  readonly completedTurns: number;
  readonly costMeasuredTurns: number;
  readonly costEligibleTurns: number;
} {
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

function resetLabel(epochMs: number | null, label: string | null, nowEpochMs: number): string {
  if (epochMs !== null) {
    const remainingMs = epochMs - nowEpochMs;
    if (remainingMs > 0 && remainingMs < 24 * 60 * 60 * 1_000) {
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
  return label === null ? "Reset unavailable" : `Resets ${label}`;
}

function updatedLabel(observedAtEpochMs: number, nowEpochMs: number): string {
  const elapsedMs = Math.max(0, nowEpochMs - observedAtEpochMs);
  if (elapsedMs < 60_000) return "Updated just now";
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  return `Updated ${Math.floor(hours / 24)}d ago`;
}
