import { useCallback } from "react";
import { useCodexRateLimitResets } from "../../application/useCodexRateLimitResets";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import { Button } from "../../ui/foundation/Button";
import type { SettingsEnvironment } from "../settings/settingsPageProps";
import "./codexRateLimitResets.css";

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
  if (!env.codexRateLimitResetGateway || activity?.accountUsageSource === "remote") return null;
  const { state } = resets;
  const count = state.snapshot?.availableCount ?? null;
  const busy =
    state.status === "loading" || state.status === "preparing" || state.status === "consuming";
  const canReset = providerGeneration !== null && resets.canReset;
  return (
    <div className="settings-row cv-codex-resets" data-layout="stacked">
      <div className="cv-codex-resets__summary">
        <span>
          <span className="settings-row__label">Local Codex account</span>
          <span className="cv-codex-resets__count">
            Available resets: <strong>{count === null ? "—" : count.toLocaleString()}</strong>
          </span>
        </span>
        <span className="cv-codex-resets__actions">
          <Button
            disabled={busy || state.status === "confirming" || providerGeneration === null}
            onClick={() => void resets.refresh()}
            size="sm"
            variant="ghost"
          >
            Refresh resets
          </Button>
          <Button disabled={!canReset} onClick={() => void resets.requestReset()} size="sm">
            {state.status === "preparing"
              ? "Preparing…"
              : state.status === "consuming"
                ? "Resetting…"
                : "Use reset"}
          </Button>
        </span>
      </div>
      {state.status === "confirming" ? (
        <div
          className="cv-codex-resets__confirmation"
          role="group"
          aria-label="Confirm Codex limit reset"
        >
          <p className="settings-row__description">
            Use one reset credit for this local Codex account? This resets eligible usage limits
            immediately and cannot be undone.
          </p>
          <span className="cv-codex-resets__actions">
            <Button onClick={resets.cancelReset} size="sm" variant="ghost">
              Cancel
            </Button>
            <Button onClick={() => void resets.confirmReset()} size="sm" variant="primary">
              Confirm · use 1 reset
            </Button>
          </span>
        </div>
      ) : null}
      {state.status === "uncertain" ? (
        <p className="settings-row__description" role="alert">
          {state.error ??
            "The reset result is unknown. Check its status before starting another reset."}{" "}
          <Button
            disabled={providerGeneration === null}
            onClick={() => void resets.retryReset()}
            size="sm"
          >
            Check reset status
          </Button>
        </p>
      ) : state.error !== null ? (
        <p className="settings-row__description cv-codex-resets__error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.outcome === null ? null : (
        <p className="settings-row__description" role="status">
          {resetOutcomeLabel(state.outcome)}
        </p>
      )}
      {providerGeneration === null ? (
        <p className="settings-row__description">
          Sign in and wait for the local Codex provider to be ready to view resets.
        </p>
      ) : state.status === "loading" ? (
        <p className="settings-row__description" role="status">
          Loading reset availability…
        </p>
      ) : state.status === "ready" && count === null ? (
        <p className="settings-row__description">
          This account does not provide reset availability.
        </p>
      ) : state.status === "ready" && count === 0 ? (
        <p className="settings-row__description">No reset credits are available.</p>
      ) : state.status === "ready" && !canReset ? (
        <p className="settings-row__description">
          Refresh Codex sign-in to verify this account before using a reset.
        </p>
      ) : null}
      {state.snapshot === null ? null : (
        <details className="cv-codex-resets__history">
          <summary>Reset history via Codevo</summary>
          <p className="settings-row__description">
            Only resets recorded through Codevo for this account are shown. Resets used in other
            apps are not included.
          </p>
          {state.snapshot.history.length === 0 ? (
            <p className="settings-row__description">No resets recorded through Codevo.</p>
          ) : (
            <ul>
              {state.snapshot.history.map((entry) => (
                <li key={entry.operationId}>
                  <time dateTime={new Date(entry.usedAtEpochMs).toISOString()}>
                    {new Date(entry.usedAtEpochMs).toLocaleString()}
                  </time>
                  <span>1 reset used</span>
                </li>
              ))}
            </ul>
          )}
          {state.snapshot.historyTruncated ? (
            <p className="settings-row__description">
              Older Codevo reset records are no longer retained.
            </p>
          ) : null}
        </details>
      )}
    </div>
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
  outcome: "reset" | "alreadyRedeemed" | "nothingToReset" | "noCredit",
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
    default:
      return outcome satisfies never;
  }
}
