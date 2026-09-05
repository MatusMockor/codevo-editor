import { ArrowUp, ChevronDown, LoaderCircle, LogIn, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { AgentProviderSignInState } from "../../domain/agentProviderSignIn";
import type { AgentProviderPreference } from "../../domain/agentProviderSettings";
import { normalizeAgentCliPath, type AgentCliKind } from "../../domain/agentSettings";
import { AgentProviderGlyph } from "../agentMode/AgentProviderGlyph";
import { AgentProviderCardDetails } from "./AgentProviderCardDetails";
import { AgentProviderUpdatePopover } from "./AgentProviderUpdatePopover";
import { SettingsButton } from "./primitives/SettingsButton";
import { SettingsSwitch } from "./primitives/SettingsSwitch";
import {
  providerHeadline,
  providerHeadlineTitle,
  providerLabel,
  providerSettingsAtDefault,
  providerSignedOut,
  providerSignInBusy,
  providerSignInPresentation,
  providerStatusTone,
  providerVersionLabel,
} from "./agentProviderCardPresentation";
import {
  availableUpdate,
  providerUpdateBlockedReason,
  providerUpdateResultPresentation,
  providerUpdating,
} from "./agentProviderUpdatePresentation";
import type { SettingsRowId } from "./settingsRegistry";
import { useSettingsRowTarget } from "./settingsTargetContext";

export interface AgentProviderSignInCardControl {
  readonly blockedReason: string | null;
  readonly state: AgentProviderSignInState;
  onSignIn(): void;
}

export interface AgentProviderCardProps {
  readonly management: AgentProviderManagementSurface;
  readonly nowEpochMs: number;
  readonly path: string | null;
  readonly preference: AgentProviderPreference;
  readonly provider: AgentCliKind;
  readonly rowId: SettingsRowId;
  readonly signIn: AgentProviderSignInCardControl | null;
  onChangeEnabled(value: boolean): void;
  onChangePath(value: string | null): void;
  onCopyInstallCommand(command: string): void;
  onResetProvider(): void;
}

export function AgentProviderCard({
  management,
  nowEpochMs,
  onChangeEnabled,
  onChangePath,
  onCopyInstallCommand,
  onResetProvider,
  path,
  preference,
  provider,
  rowId,
  signIn,
}: AgentProviderCardProps) {
  const [pathDraft, setPathDraft] = useState(path ?? "");
  const [expanded, setExpanded] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const updateAnchorRef = useRef<HTMLButtonElement | null>(null);
  const elementRef = useSettingsRowTarget(rowId);

  const label = providerLabel(provider);
  const view = management.providers[provider];
  const enabled = preference.enabled;
  const available = availableUpdate(view.health);
  const updating = providerUpdating(view);
  const signingIn = signIn !== null && providerSignInBusy(signIn.state);
  const signInOffered = providerSignedOut(view.health);
  const signInBlockedReason =
    signIn === null ? "Provider sign-in is not connected." : signIn.blockedReason;
  const signInStatus = providerSignInPresentation(
    signIn?.state ?? { kind: "idle" },
    signInOffered ? signInBlockedReason : null,
  );
  const signInStatusId = `${provider}-sign-in-status`;
  const headlineTitle = providerHeadlineTitle(view, enabled);
  const headlineTitleId = `${provider}-headline-note`;
  const updateBlockedReason = providerUpdateBlockedReason(
    provider,
    view,
    available,
    enabled,
    signingIn,
  );
  const updateResult = providerUpdateResultPresentation(
    view.updateState,
    available?.installer ?? null,
  );
  const version = providerVersionLabel(view.health);
  const invalidPath = pathDraft.trim() !== "" && normalizeAgentCliPath(pathDraft) === null;

  useEffect(() => setPathDraft(path ?? ""), [path]);
  useEffect(() => {
    if (available !== null) return;

    setUpdateOpen(false);
  }, [available]);

  const commitPath = (): void => {
    const normalized = normalizeAgentCliPath(pathDraft);

    if (pathDraft.trim() !== "" && normalized === null) return;

    onChangePath(normalized);
  };

  return (
    <section
      aria-label={`${label} provider`}
      className="settings-provider"
      data-expanded={expanded ? "true" : undefined}
      data-settings-row={rowId}
      ref={elementRef}
      tabIndex={-1}
    >
      <div className="settings-provider__head">
        <div className="settings-provider__body">
          <div className="settings-provider__line">
            <span
              className="settings-provider__glyph"
              data-tone={providerStatusTone(enabled, view)}
            >
              <AgentProviderGlyph decorative kind={provider} />
              {providerStatusTone(enabled, view) === "checking" ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="settings-provider__dot settings-spin"
                  size={9}
                />
              ) : (
                <i aria-hidden="true" className="settings-provider__dot" />
              )}
            </span>
            <h3 className="settings-provider__name">{label}</h3>
            {version === null ? null : (
              <code className="settings-provider__version">{version}</code>
            )}
            {available === null ? null : (
              <span className="settings-provider__update">
                <SettingsButton
                  expanded={updateOpen}
                  label={`${label} update available - view details`}
                  onClick={() => setUpdateOpen((open) => !open)}
                  ref={updateAnchorRef}
                  size="micro"
                  title={`Update available: install v${available.availableVersion}`}
                  variant="primary"
                >
                  <ArrowUp aria-hidden="true" size={12} />
                </SettingsButton>
              </span>
            )}
            {providerSettingsAtDefault(path, preference) ? null : (
              <SettingsButton
                label={`Reset ${label} provider settings to default`}
                onClick={onResetProvider}
                size="micro"
                title={`Reset ${label} provider settings to default`}
                variant="ghostMuted"
              >
                <RotateCcw aria-hidden="true" size={12} />
              </SettingsButton>
            )}
          </div>
          <p
            aria-describedby={headlineTitle === null ? undefined : headlineTitleId}
            className="settings-provider__desc"
            title={headlineTitle ?? undefined}
          >
            {providerHeadline(view, enabled)}
          </p>
          {headlineTitle === null ? null : (
            <span className="settings-visually-hidden" id={headlineTitleId}>
              {headlineTitle}
            </span>
          )}
          {signInStatus === null ? (
            <span id={signInStatusId} />
          ) : (
            <p
              className={`settings-provider__status${signInStatus.role === "alert" ? " settings-provider__status--danger" : ""}`}
              id={signInStatusId}
              role={signInStatus.role}
            >
              {signInStatus.message}
            </p>
          )}
          {updateResult === null ? null : (
            <div
              className={`settings-provider__status settings-provider__status--${updateResult.tone}`}
              role={updateResult.role}
            >
              <span>{updateResult.message}</span>
              {updateResult.outputTail === "" ? null : <pre>{updateResult.outputTail}</pre>}
              {updateResult.outputTruncated ? <small>Output was truncated.</small> : null}
            </div>
          )}
        </div>
        <div className="settings-provider__side">
          {signIn === null || !signInOffered ? null : (
            <button
              aria-busy={signingIn || undefined}
              aria-describedby={signInStatusId}
              className="settings-btn settings-btn--outline settings-btn--compact"
              disabled={signInBlockedReason !== null}
              onClick={signIn.onSignIn}
              title={signInBlockedReason ?? undefined}
              type="button"
            >
              {signingIn ? (
                <LoaderCircle aria-hidden="true" className="settings-spin" size={13} />
              ) : (
                <LogIn aria-hidden="true" size={13} />
              )}
              {signingIn ? "Signing in…" : "Sign in"}
            </button>
          )}
          <span className="settings-provider__chevron">
            <SettingsButton
              expanded={expanded}
              label={`${expanded ? "Hide" : "Show"} ${label} details`}
              onClick={() => setExpanded((open) => !open)}
              size="compact"
              variant="ghostMuted"
            >
              <ChevronDown aria-hidden="true" size={14} />
            </SettingsButton>
          </span>
          <SettingsSwitch checked={enabled} label={`Enable ${label}`} onChange={onChangeEnabled} />
        </div>
      </div>

      {expanded ? (
        <AgentProviderCardDetails
          enabled={enabled}
          intervalSeconds={preference.healthCheckIntervalSeconds}
          invalidPath={invalidPath}
          nowEpochMs={nowEpochMs}
          onChangePathDraft={setPathDraft}
          onCommitPath={commitPath}
          onCopyInstallCommand={onCopyInstallCommand}
          onRetryRegistration={() => void management.retryRegistration(provider)}
          pathDraft={pathDraft}
          provider={provider}
          view={view}
        />
      ) : null}

      {available === null ? null : (
        <AgentProviderUpdatePopover
          anchorRef={updateAnchorRef}
          available={available}
          blockedReason={updateBlockedReason}
          onClose={(restoreFocus) => {
            setUpdateOpen(false);

            if (!restoreFocus) return;

            updateAnchorRef.current?.focus();
          }}
          onCopyCommand={onCopyInstallCommand}
          onDismiss={() => {
            setUpdateOpen(false);
            void management.dismissUpdate(provider, available.availableVersion);
          }}
          onUpdate={() => void management.update(provider, available.availableVersion)}
          open={updateOpen}
          providerLabel={label}
          updating={updating}
        />
      )}
    </section>
  );
}
