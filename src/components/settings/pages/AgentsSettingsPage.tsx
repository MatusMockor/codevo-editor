import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  AgentProviderManagementSurface,
  AgentProviderManagementView,
} from "../../../application/useAgentProviderManagement";
import type { AgentProviderSignInSurface } from "../../../application/useAgentProviderSignIn";
import {
  defaultAgentProviderPreferences,
  MAX_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS,
  MIN_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS,
} from "../../../domain/agentProviderSettings";
import { defaultAgentCliDiscoveryResult, type AgentCliKind } from "../../../domain/agentSettings";
import { AgentProviderCard } from "../AgentProviderCard";
import { providerCheckedAt, providerChecksSummaryLabel } from "../agentProviderCardPresentation";
import {
  AGENT_PROVIDERS,
  agentProviderDraftWriter,
  withClearedModelFavorites,
  withHealthCheckIntervalSeconds,
  withProviderEnabled,
  withProviderPath,
  withProviderReset,
} from "../agentProviderSettingsPersistence";
import { AgentThreadDefaultsRows } from "../AgentThreadDefaultsRows";
import { SettingsButton } from "../primitives/SettingsButton";
import { SettingsNumberField } from "../primitives/SettingsNumberField";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import type { SettingsPageProps } from "../settingsPageProps";

const PROVIDER_HEALTH_CLOCK_TICK_MS = 30_000;

const PROVIDER_ROW_IDS = {
  claudeCode: "agents.providerClaudeCode",
  codex: "agents.providerCodex",
} as const;

export function AgentsSettingsPage({ actions, draft, env }: SettingsPageProps) {
  const [nowEpochMs, setNowEpochMs] = useState(() => Date.now());
  const appSettingsRef = useRef(draft.appSettings);

  const management = env.providerManagement ?? UNAVAILABLE_MANAGEMENT;
  const preferences =
    draft.appSettings.agentProviderPreferences ?? defaultAgentProviderPreferences();
  const claudeInterval = preferences.claudeCode.healthCheckIntervalSeconds;
  const codexInterval = preferences.codex.healthCheckIntervalSeconds;
  const healths = AGENT_PROVIDERS.map((provider) => management.providers[provider].health);
  const oldestCheckedAt = healths.reduce<number | null>(
    (oldest, health) => oldestEpoch(oldest, providerCheckedAt(health)),
    null,
  );
  const checking = healths.some((health) => health.kind === "checking");

  useEffect(() => {
    appSettingsRef.current = draft.appSettings;
  }, [draft.appSettings]);

  useEffect(() => {
    setNowEpochMs(Date.now());

    if (oldestCheckedAt === null) return undefined;

    const timer = setInterval(() => setNowEpochMs(Date.now()), PROVIDER_HEALTH_CLOCK_TICK_MS);

    return () => clearInterval(timer);
  }, [oldestCheckedAt]);

  const writeAppSettings = agentProviderDraftWriter({
    draftRef: appSettingsRef,
    management: env.providerManagement,
    persistDraft: (settings) => {
      appSettingsRef.current = settings;
      actions.updateAppSettings(settings);
    },
    publishDraft: (settings) => {
      appSettingsRef.current = settings;
      actions.publishAppSettings(settings);
    },
  });

  const providerConfigured = (provider: AgentCliKind): boolean =>
    management.admissionAuthority(provider).disposition.kind === "ready";

  return (
    <>
      <SettingsSectionHeading
        actions={
          <>
            <span className="settings-section__note">
              {providerChecksSummaryLabel(healths, nowEpochMs)}
            </span>
            <SettingsButton
              busy={checking}
              label="Refresh provider status"
              onClick={() => {
                for (const provider of AGENT_PROVIDERS) {
                  void management.refresh(provider);
                }
              }}
              size="micro"
              title="Refresh provider status"
              variant="ghostMuted"
            >
              <RefreshCw aria-hidden="true" size={13} />
            </SettingsButton>
          </>
        }
        title="Agents"
      >
        <SettingsRow
          meta={
            claudeInterval === codexInterval ? undefined : (
              <span className="settings-row__meta">
                Codex still uses {codexInterval} seconds until the next change.
              </span>
            )
          }
          rowId="agents.healthCheckInterval"
        >
          <SettingsNumberField
            max={MAX_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS}
            min={MIN_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS}
            onChange={(value) =>
              writeAppSettings(withHealthCheckIntervalSeconds(appSettingsRef.current, value))
            }
            unit="seconds"
            value={claudeInterval}
          />
        </SettingsRow>

        <SettingsRow rowId="agents.checkCliUpdates">
          <span className="settings-readout">Automatic for enabled providers</span>
        </SettingsRow>

        {AGENT_PROVIDERS.map((provider) => (
          <AgentProviderCard
            key={provider}
            management={management}
            nowEpochMs={nowEpochMs}
            onChangeEnabled={(enabled) =>
              writeAppSettings(
                withProviderEnabled(appSettingsRef.current, provider, enabled, providerConfigured),
              )
            }
            onChangePath={(path) =>
              writeAppSettings(withProviderPath(appSettingsRef.current, provider, path))
            }
            onCopyInstallCommand={env.onCopyInstallCommand}
            onResetProvider={() =>
              writeAppSettings(withProviderReset(appSettingsRef.current, provider))
            }
            path={draft.appSettings.agentCliPaths[provider]}
            preference={preferences[provider]}
            provider={provider}
            rowId={PROVIDER_ROW_IDS[provider]}
            signIn={signInControl(env.providerSignIn, provider)}
          />
        ))}
      </SettingsSectionHeading>

      <AgentThreadDefaultsRows
        appSettings={draft.appSettings}
        hasWorkspace={env.hasWorkspace}
        onChangeDefaultProvider={(agentCliKind) =>
          writeAppSettings({ ...appSettingsRef.current, agentCliKind })
        }
        onChangeIsolationPolicy={(agentIsolationPolicy) =>
          actions.updateWorkspaceSettings({
            ...draft.workspaceSettings,
            agentIsolationPolicy,
          })
        }
        onClearFavorites={() => {
          const next = withClearedModelFavorites(appSettingsRef.current);

          if (next === null) return;

          writeAppSettings(next);
        }}
        workspaceSettings={draft.workspaceSettings}
      />
    </>
  );
}

function signInControl(surface: AgentProviderSignInSurface | null, provider: AgentCliKind) {
  if (surface === null) return null;

  return {
    blockedReason: surface.blockedReason(provider),
    state: surface.states[provider],
    onSignIn: () => {
      surface.request(provider);
    },
  };
}

function oldestEpoch(oldest: number | null, candidate: number | null): number | null {
  if (candidate === null) return oldest;
  if (oldest === null) return candidate;

  return Math.min(oldest, candidate);
}

function unavailableProviderView(provider: AgentCliKind): AgentProviderManagementView {
  return {
    executable: {
      kind: "notFound",
      installCommand:
        provider === "claudeCode" ? "npm i -g @anthropic-ai/claude-code" : "npm i -g @openai/codex",
    },
    health: { kind: "notConfigured" },
    policy: { kind: "unregistered" },
    updateState: { kind: "idle" },
    liveTurnCount: 0,
  };
}

const UNAVAILABLE_MANAGEMENT: AgentProviderManagementSurface = {
  cliDiscovery: defaultAgentCliDiscoveryResult(),
  providers: {
    claudeCode: unavailableProviderView("claudeCode"),
    codex: unavailableProviderView("codex"),
  },
  selectedProviderAuthority: null,
  toast: null,
  admissionAuthority: (provider) => ({
    provider,
    revision: 0,
    disposition: { kind: "policyUnavailable", reason: "unregistered" },
  }),
  authority: () => null,
  dismissToast: () => undefined,
  dismissUpdate: async () => false,
  refresh: async () => undefined,
  refreshAll: async () => undefined,
  retryRegistration: async () => undefined,
  save: async () => false,
  saveWithOutcome: async () => ({ kind: "rejected", reason: "notHydrated" }),
  update: async () => "policyUnavailable",
};
