import { RefreshCw } from "lucide-react";
import { useCallback, useId, useMemo, useState } from "react";
import { useCodexRateLimitResets } from "../../application/useCodexRateLimitResets";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import { Button } from "../../ui/foundation/Button";
import { IconButton } from "../../ui/foundation/IconButton";
import { SegmentedControl } from "../../ui/foundation/SegmentedControl";
import { useNowMs } from "../../ui/foundation/useNowMs";
import type { SettingsEnvironment } from "../settings/settingsPageProps";
import { CodexResetAvailablePanel, CodexResetHistoryPanel } from "./CodexResetCreditList";
import {
  codexResetAvailableModel,
  codexResetHistoryRows,
  codexResetSegmentLabel,
  codexResetUsageNote,
} from "./codexResetCreditsPresentation";
import "./codexRateLimitResets.css";

type ResetTab = "available" | "history";

export function CodexRateLimitResets({ env }: { readonly env: SettingsEnvironment }) {
  const activity = env.agentActivity;
  const providerGeneration =
    activity?.accountUsageSource === "remote"
      ? null
      : codexResetProviderGeneration(env.providerManagement);
  const refreshLimits = useCallback(async () => {
    const result = await activity?.refreshAccountUsage("codex");
    if (result?.kind === "failed" || result?.kind === "unavailable") {
      throw new Error("Codex usage could not be refreshed.");
    }
  }, [activity]);
  const accountUsage = activity?.accountUsage.codex;
  const resets = useCodexRateLimitResets({
    gateway: env.codexRateLimitResetGateway ?? undefined,
    providerGeneration,
    accountIdentity:
      accountUsage?.kind === "ready"
        ? (accountUsage.snapshot.accountIdentity ?? undefined)
        : undefined,
    refreshLimits,
  });
  const [tab, setTab] = useState<ResetTab>("available");
  const nowEpochMs = useNowMs();
  const titleId = useId();
  const snapshot = resets.state.snapshot;
  const available = useMemo(
    () => (snapshot === null ? null : codexResetAvailableModel(snapshot, { nowEpochMs })),
    [nowEpochMs, snapshot],
  );
  const history = useMemo(
    () => (snapshot === null ? null : codexResetHistoryRows(snapshot.history, { nowEpochMs })),
    [nowEpochMs, snapshot],
  );
  if (!env.codexRateLimitResetGateway || activity?.accountUsageSource === "remote") return null;
  const { state } = resets;
  const count = snapshot?.availableCount ?? null;
  const busy =
    state.status === "loading" || state.status === "preparing" || state.status === "consuming";
  const canReset = providerGeneration !== null && resets.canReset;
  return (
    <section
      aria-labelledby={titleId}
      className="settings-row cv-codex-resets"
      data-layout="stacked"
    >
      <div className="cv-codex-resets__head">
        <span className="cv-codex-resets__heading">
          <span className="settings-row__title" id={titleId}>
            Limit resets
          </span>
          <span className="cv-codex-resets__description">
            Restores your 5-hour limit, weekly limit, or both.
          </span>
        </span>
        <span className="cv-codex-resets__tools">
          <SegmentedControl<ResetTab>
            label="Limit reset list"
            onChange={setTab}
            options={[
              { value: "available", label: codexResetSegmentLabel(count) },
              { value: "history", label: "History" },
            ]}
            value={tab}
          />
          <IconButton
            disabled={busy || state.status === "confirming" || providerGeneration === null}
            icon={<RefreshCw aria-hidden="true" size={14} />}
            label="Check resets again"
            onClick={() => void resets.refresh()}
          />
        </span>
      </div>
      {state.outcome === null ? null : (
        <p
          className="cv-codex-resets__notice"
          data-tone={state.outcome === "reset" ? "ok" : undefined}
          role="status"
        >
          {resetOutcomeLabel(state.outcome)}
        </p>
      )}
      {state.status === "uncertain" ? (
        <div className="cv-codex-resets__uncertain" role="alert">
          <span>
            {state.error ??
              "The reset result is unknown. Check its status before starting another reset."}
          </span>
          <Button
            disabled={providerGeneration === null}
            onClick={() => {
              setTab("available");
              void resets.retryReset();
            }}
            size="sm"
          >
            Check reset status
          </Button>
        </div>
      ) : state.error !== null ? (
        <p className="cv-codex-resets__notice" data-tone="danger" role="alert">
          {state.error}
        </p>
      ) : null}
      {providerGeneration === null ? (
        <p className="cv-codex-resets__empty">
          Sign in and wait for the local Codex provider to be ready to view resets.
        </p>
      ) : state.status === "loading" && snapshot === null ? (
        <p className="cv-codex-resets__empty" role="status">
          Loading reset availability…
        </p>
      ) : available === null || history === null ? null : tab === "history" ? (
        <CodexResetHistoryPanel rows={history} truncated={snapshot?.historyTruncated === true} />
      ) : (
        <>
          {state.status === "ready" && count !== null && count > 0 && !canReset ? (
            <p className="cv-codex-resets__notice">
              Refresh Codex sign-in to verify this account before using a reset.
            </p>
          ) : null}
          <CodexResetAvailablePanel
            canReset={canReset}
            model={available}
            onCancel={resets.cancelReset}
            onConfirm={() => void resets.confirmReset()}
            onUse={(creditId) => void resets.requestReset(creditId)}
            retrying={state.intent === "retry"}
            status={state.status}
            targetCreditId={state.targetCreditId}
            usageNote={codexResetUsageNote(accountUsage, nowEpochMs)}
          />
        </>
      )}
    </section>
  );
}

function codexResetProviderGeneration(
  management: AgentProviderManagementSurface | null,
): number | null {
  const provider = management?.providers.codex;
  if (
    !management ||
    !provider ||
    provider.policy.kind !== "registered" ||
    provider.health.kind !== "ready" ||
    provider.signInActive
  )
    return null;
  const admission = management.admissionAuthority("codex");
  if (
    admission.disposition.kind !== "ready" ||
    !("providerGeneration" in admission) ||
    admission.providerGeneration !== provider.policy.providerGeneration
  )
    return null;
  return provider.policy.providerGeneration;
}

function resetOutcomeLabel(
  outcome: "reset" | "alreadyRedeemed" | "nothingToReset" | "noCredit" | "notApplied",
): string {
  switch (outcome) {
    case "reset":
      return "Codex usage limits were reset.";
    case "alreadyRedeemed":
      return "This reset was already applied. No additional credit was used.";
    case "nothingToReset":
      return "No eligible limit needed a reset. No credit was used.";
    case "noCredit":
      return "No reset credit was available. Usage limits were not reset.";
    case "notApplied":
      return "Codevo has no record that the last reset went through. Check your usage limits above.";
    default:
      return outcome satisfies never;
  }
}
