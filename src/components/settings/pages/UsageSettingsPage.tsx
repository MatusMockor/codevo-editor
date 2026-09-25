import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentAccountUsageRefreshOutcome } from "../../../application/agentAccountUsageRefresh";
import { useAgentTurnLogThreadEvidence } from "../../../application/agentTurnLogStatusStore";
import type { AgentAccountUsageLoadState } from "../../../domain/agentAccountUsage";
import {
  aggregateAgentUsage,
  type AgentUsagePeriod,
  type AgentUsageProvider,
} from "../../../domain/agentUsage";
import { IconButton } from "../../../ui/foundation/IconButton";
import { SegmentedControl } from "../../../ui/foundation/SegmentedControl";
import { useNowMs } from "../../../ui/foundation/useNowMs";
import type { AgentProjectDescriptor } from "../../../domain/agentProject";
import { Button } from "../../../ui/foundation/Button";
import { AgentProviderGlyph } from "../../agentMode/AgentProviderGlyph";
import { UsageLimitBars } from "../../usage/UsageLimitBars";
import {
  durationLabel,
  formatInteger,
  formatUsd,
  latestUsageFetch,
  localSpendSummary,
  projectLabelFromRootKey,
  updatedLabel,
  USAGE_PROJECT_ROWS_VISIBLE,
  usageProjectRows,
  usageProviderLabel,
  usageProviderLimitsNotice,
  type UsageProjectRow,
} from "../../usage/usagePresentation";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import type {
  SettingsAgentActivity,
  SettingsEnvironment,
  SettingsPageProps,
  SettingsUsageProvider,
} from "../settingsPageProps";
import { useSettingsRowTarget } from "../settingsTargetContext";

const PROVIDERS: ReadonlyArray<SettingsUsageProvider> = ["claudeCode", "codex"];
const PERIOD_OPTIONS: ReadonlyArray<{ readonly value: AgentUsagePeriod; readonly label: string }> =
  [
    { value: "today", label: "Today" },
    { value: "7days", label: "7 days" },
    { value: "30days", label: "30 days" },
  ];
const NOT_LOADED_NOTICE = "Usage appears after agent mode has loaded.";
const NO_PROJECTS: ReadonlyArray<AgentProjectDescriptor> = [];

type RefreshProblem = "failed" | "unavailable";

export function UsageSettingsPage({ env }: SettingsPageProps) {
  const activity = env.agentActivity ?? null;
  const limitsRef = useSettingsRowTarget("usage.limits");
  const activityRef = useSettingsRowTarget("usage.localActivity");
  const nowEpochMs = useNowMs();

  if (activity === null) {
    return (
      <>
        <div
          className="settings-stack"
          data-settings-row="usage.limits"
          ref={limitsRef}
          tabIndex={-1}
        >
          <SettingsSectionHeading title="Subscription limits">
            <p className="settings-empty">{NOT_LOADED_NOTICE}</p>
          </SettingsSectionHeading>
        </div>
        <div
          className="settings-stack"
          data-settings-row="usage.localActivity"
          ref={activityRef}
          tabIndex={-1}
        >
          <SettingsSectionHeading title="Local activity">
            <p className="settings-empty">{NOT_LOADED_NOTICE}</p>
          </SettingsSectionHeading>
        </div>
      </>
    );
  }

  return (
    <>
      <div
        className="settings-stack"
        data-settings-row="usage.limits"
        ref={limitsRef}
        tabIndex={-1}
      >
        {PROVIDERS.map((provider) => (
          <ProviderLimits
            key={provider}
            nowEpochMs={nowEpochMs}
            provider={provider}
            state={activity.accountUsage[provider]}
          />
        ))}
      </div>
      <div
        className="settings-stack"
        data-settings-row="usage.localActivity"
        ref={activityRef}
        tabIndex={-1}
      >
        <LocalActivity
          activity={activity}
          nowEpochMs={nowEpochMs}
          projects={env.agentProjects ?? NO_PROJECTS}
        />
      </div>
    </>
  );
}

export function UsagePageActions({ env }: { readonly env: SettingsEnvironment }) {
  const nowEpochMs = useNowMs();
  const activity = env.agentActivity ?? null;
  const [problem, setProblem] = useState<string | null>(null);
  const refreshGeneration = useRef(0);
  useEffect(() => {
    const generations = refreshGeneration;
    return () => {
      generations.current += 1;
    };
  }, []);
  if (activity === null) return null;
  const fetchedAt = latestUsageFetch(activity.accountUsage);
  const refresh = async () => {
    refreshGeneration.current += 1;
    const generation = refreshGeneration.current;
    setProblem(null);
    const outcomes = await Promise.all(
      PROVIDERS.map((provider) =>
        activity.refreshAccountUsage(provider).then(
          (outcome) => ({ provider, outcome }),
          () => ({ provider, outcome: { kind: "failed" } as const }),
        ),
      ),
    );
    if (refreshGeneration.current !== generation) return;
    setProblem(refreshProblemMessage(outcomes));
  };
  return (
    <span className="settings-page-actions">
      {problem === null ? null : (
        <span className="settings-section__note cv-usage-refresh-error" role="alert">
          {problem}
        </span>
      )}
      {fetchedAt === null ? null : (
        <span className="settings-section__note">{updatedLabel(fetchedAt, nowEpochMs)}</span>
      )}
      <IconButton
        icon={<RefreshCw aria-hidden="true" size={14} />}
        label="Refresh usage"
        onClick={() => void refresh()}
      />
    </span>
  );
}

function refreshProblemMessage(
  outcomes: ReadonlyArray<{
    readonly provider: SettingsUsageProvider;
    readonly outcome: AgentAccountUsageRefreshOutcome;
  }>,
): string | null {
  const problems = outcomes.flatMap(({ provider, outcome }) => {
    const kind = refreshProblemKind(outcome);
    return kind === null ? [] : [{ provider, kind }];
  });
  if (problems.length === 0) return null;
  const names = problems.map(({ provider }) => usageProviderLabel(provider)).join(" and ");
  const hint = problems.some(({ kind }) => kind === "unavailable") ? " Sign in and try again." : "";
  return `Could not refresh ${names} usage.${hint}`;
}

function refreshProblemKind(outcome: AgentAccountUsageRefreshOutcome): RefreshProblem | null {
  switch (outcome.kind) {
    case "refreshed":
    case "superseded":
      return null;
    case "failed":
    case "unavailable":
      return outcome.kind;
    default:
      return outcome satisfies never;
  }
}

function ProviderLimits({
  nowEpochMs,
  provider,
  state,
}: {
  readonly nowEpochMs: number;
  readonly provider: SettingsUsageProvider;
  readonly state: AgentAccountUsageLoadState;
}) {
  const notice = usageProviderLimitsNotice(state);
  return (
    <SettingsSectionHeading title={usageProviderLabel(provider)}>
      <div className="settings-row" data-layout="stacked">
        <span className="settings-usage-provider">
          <AgentProviderGlyph decorative kind={provider} />
        </span>
        {state.kind === "ready" && notice === null ? (
          <UsageLimitBars nowEpochMs={nowEpochMs} windows={state.snapshot.windows} />
        ) : (
          <p className="settings-row__description">{notice}</p>
        )}
      </div>
    </SettingsSectionHeading>
  );
}

function LocalActivity({
  activity,
  nowEpochMs,
  projects,
}: {
  readonly activity: SettingsAgentActivity;
  readonly nowEpochMs: number;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
}) {
  const [period, setPeriod] = useState<AgentUsagePeriod>("7days");
  const threads = useMemo(() => activity.threads.map((view) => view.thread), [activity.threads]);
  const threadIds = useMemo(() => threads.map((thread) => thread.threadId), [threads]);
  const evidence = useAgentTurnLogThreadEvidence(activity.turnLog, threadIds);
  const usage = useMemo(
    () => aggregateAgentUsage(threads, period, nowEpochMs, evidence),
    [evidence, nowEpochMs, period, threads],
  );
  const spend = useMemo(() => localSpendSummary(usage.providers), [usage.providers]);
  const projectRows = useMemo(() => {
    const labels = new Map(projects.map((project) => [project.rootKey, project.label]));
    return usageProjectRows(
      usage.providers,
      (rootKey) => labels.get(rootKey) ?? projectLabelFromRootKey(rootKey),
    );
  }, [projects, usage.providers]);

  return (
    <SettingsSectionHeading
      actions={
        <SegmentedControl<AgentUsagePeriod>
          label="Period"
          onChange={setPeriod}
          options={PERIOD_OPTIONS}
          value={period}
        />
      }
      title="Local activity"
    >
      <div className="settings-row" data-layout="stacked">
        <div className="cv-usage-totals">
          <Total
            label="Estimated cost"
            value={spend.costUsd === null ? "—" : formatUsd(spend.costUsd)}
          />
          <Total
            label="Processed tokens"
            value={spend.tokens === null ? "—" : formatInteger(spend.tokens)}
          />
          <Total label="Completed turns" value={formatInteger(spend.completedTurns)} />
        </div>
        <p className="settings-row__description">
          Saved threads and turns on this device, not subscription billing. Provider-reported API
          equivalent for {spend.costMeasuredTurns} of {spend.costEligibleTurns} completed turns.
          {usage.savedHistoryIncomplete
            ? " Saved history is incomplete because older turns were evicted."
            : ""}
        </p>
      </div>
      {PROVIDERS.map((provider) => (
        <ProviderActivityRow key={provider} usage={usage.providers[provider]} />
      ))}
      <ProjectBreakdown rows={projectRows} />
    </SettingsSectionHeading>
  );
}

function ProviderActivityRow({ usage }: { readonly usage: AgentUsageProvider }) {
  const metrics = usage.total;
  const cli = metrics.cliUsage;
  const tokens =
    cli.measuredTurns === 0 || cli.inputTokens === null || cli.outputTokens === null
      ? null
      : cli.inputTokens + cli.outputTokens;
  return (
    <div className="settings-row">
      <span className="settings-usage-provider">
        <AgentProviderGlyph decorative kind={usage.provider} />
        <span className="settings-row__title">{usageProviderLabel(usage.provider)}</span>
      </span>
      <span className="cv-usage-provider-row">
        <span>{formatInteger(metrics.turnsStarted)} turns</span>
        <span>{tokens === null ? "—" : `${formatInteger(tokens)} tokens`}</span>
        <span>{durationLabel(metrics.wallTime.totalMs)}</span>
        <strong>
          {cli.costMeasuredTurns === 0 || cli.costUsd === null ? "—" : formatUsd(cli.costUsd)}
        </strong>
      </span>
    </div>
  );
}

function ProjectBreakdown({ rows }: { readonly rows: ReadonlyArray<UsageProjectRow> }) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;
  const visible = expanded ? rows : rows.slice(0, USAGE_PROJECT_ROWS_VISIBLE);
  const hidden = rows.length - visible.length;
  return (
    <div aria-label="Projects" className="cv-usage-projects" role="group">
      {visible.map((row) => (
        <div className="settings-row" key={row.key}>
          <span className="settings-usage-provider">
            <AgentProviderGlyph decorative kind={row.provider} />
            <span className="settings-row__title">{row.label}</span>
          </span>
          <span className="cv-usage-provider-row">
            <span>
              {formatInteger(row.turnsStarted)} {row.turnsStarted === 1 ? "turn" : "turns"}
            </span>
            <span>{row.tokens === null ? "—" : `${formatInteger(row.tokens)} tokens`}</span>
            <span>{durationLabel(row.wallTimeMs)}</span>
            <strong>{row.costUsd === null ? "—" : formatUsd(row.costUsd)}</strong>
          </span>
        </div>
      ))}
      {hidden <= 0 ? null : (
        <div className="cv-usage-projects__more">
          <Button onClick={() => setExpanded(true)} size="sm" variant="ghost">
            {`Show ${hidden} more ${hidden === 1 ? "project" : "projects"}`}
          </Button>
        </div>
      )}
    </div>
  );
}

function Total({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="cv-usage-totals__item">
      <span className="cv-usage-totals__key">{label}</span>
      <span className="cv-usage-totals__value">{value}</span>
    </div>
  );
}
