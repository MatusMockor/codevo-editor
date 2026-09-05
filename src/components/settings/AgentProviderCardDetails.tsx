import { Copy, LoaderCircle } from "lucide-react";
import type { AgentProviderManagementView } from "../../application/useAgentProviderManagement";
import type { AgentCliExecutablePresentation, AgentCliKind } from "../../domain/agentSettings";
import { SettingsButton } from "./primitives/SettingsButton";
import {
  providerAuthLabel,
  providerCheckedLabel,
  providerConfigured,
  providerExecutableName,
  providerHealthLabel,
  providerLabel,
  providerPathPlaceholder,
  providerPolicyFailureLabel,
} from "./agentProviderCardPresentation";
import { providerUpdateAvailabilityMessage } from "./agentProviderUpdatePresentation";

export interface AgentProviderCardDetailsProps {
  readonly enabled: boolean;
  readonly intervalSeconds: number;
  readonly invalidPath: boolean;
  readonly nowEpochMs: number;
  readonly pathDraft: string;
  readonly provider: AgentCliKind;
  readonly view: AgentProviderManagementView;
  onChangePathDraft(value: string): void;
  onCommitPath(): void;
  onCopyInstallCommand(command: string): void;
  onRetryRegistration(): void;
}

export function AgentProviderCardDetails({
  enabled,
  intervalSeconds,
  invalidPath,
  nowEpochMs,
  onChangePathDraft,
  onCommitPath,
  onCopyInstallCommand,
  onRetryRegistration,
  pathDraft,
  provider,
  view,
}: AgentProviderCardDetailsProps) {
  const label = providerLabel(provider);
  const discoveryId = `${provider}-cli-discovery`;
  const healthId = `${provider}-cli-health`;
  const updateMessage = providerUpdateAvailabilityMessage(view.health);

  return (
    <div className="settings-provider__details">
      <label className="settings-provider__field">
        <span className="settings-provider__field-label">Executable path</span>
        <input
          aria-describedby={`${discoveryId} ${healthId}`}
          aria-invalid={invalidPath || undefined}
          className="settings-input"
          data-mono="true"
          data-width="full"
          disabled={!enabled}
          onBlur={onCommitPath}
          onChange={(event) => onChangePathDraft(event.currentTarget.value)}
          placeholder={providerPathPlaceholder(provider)}
          spellCheck={false}
          type="text"
          value={pathDraft}
        />
        <small className="settings-provider__hint">
          {invalidPath
            ? "Enter an absolute executable path."
            : `Leave empty to run ${providerExecutableName(provider)} from PATH.`}
        </small>
      </label>

      <ProviderDiscovery
        id={discoveryId}
        onCopyInstallCommand={onCopyInstallCommand}
        presentation={view.executable}
        provider={provider}
      />

      <p className="settings-provider__status" id={healthId} role="status">
        <span>{providerHealthLabel(view.policy, view.health, providerConfigured(view))}</span>
        <span>{providerAuthLabel(view.health)}</span>
        <span>{providerCheckedLabel(view.health, nowEpochMs)}</span>
      </p>

      {updateMessage === null ? null : (
        <p className="settings-provider__status" role="status">
          {updateMessage}
        </p>
      )}

      <ProviderPolicy disabled={!enabled} onRetry={onRetryRegistration} view={view} />

      <p className="settings-provider__status">
        {intervalSeconds === 0
          ? `${label} is checked only when you refresh manually.`
          : `${label} health check interval: ${intervalSeconds} seconds.`}
      </p>
    </div>
  );
}

function ProviderDiscovery({
  id,
  onCopyInstallCommand,
  presentation,
  provider,
}: {
  readonly id: string;
  readonly presentation: AgentCliExecutablePresentation;
  readonly provider: AgentCliKind;
  onCopyInstallCommand(command: string): void;
}) {
  if (presentation.kind === "manual") {
    return (
      <p className="settings-provider__status" id={id} role="status">
        Manual override: {presentation.path}
      </p>
    );
  }

  if (presentation.kind === "detected") {
    return (
      <p className="settings-provider__status" id={id} role="status">
        Detected at {presentation.path}
        {presentation.version === null ? null : ` (v${presentation.version})`}
      </p>
    );
  }

  return (
    <p className="settings-provider__status settings-provider__status--danger" id={id}>
      <span>Not found: install with</span>
      <code>{presentation.installCommand}</code>
      <SettingsButton
        label={`Copy ${providerLabel(provider)} install command`}
        onClick={() => onCopyInstallCommand(presentation.installCommand)}
        size="xsq"
        variant="ghostMuted"
      >
        <Copy aria-hidden="true" size={12} />
      </SettingsButton>
    </p>
  );
}

function ProviderPolicy({
  disabled,
  onRetry,
  view,
}: {
  readonly disabled: boolean;
  readonly view: AgentProviderManagementView;
  onRetry(): void;
}) {
  const policy = view.policy;

  if (policy.kind === "registered") {
    return (
      <p className="settings-provider__status" role="status">
        Policy registered
      </p>
    );
  }

  if (policy.kind === "registering") {
    return (
      <p className="settings-provider__status" role="status">
        <LoaderCircle aria-hidden="true" className="settings-spin" size={13} />
        <span>Registering policy…</span>
      </p>
    );
  }

  if (policy.kind === "unregistered") {
    return (
      <p className="settings-provider__status" role="status">
        <span>Policy not registered</span>
        <SettingsButton disabled={disabled} onClick={onRetry} size="compact" variant="outline">
          Register
        </SettingsButton>
      </p>
    );
  }

  return (
    <p className="settings-provider__status settings-provider__status--danger" role="alert">
      <span>{providerPolicyFailureLabel(policy.reason)}</span>
      <SettingsButton disabled={disabled} onClick={onRetry} size="compact" variant="outline">
        Retry registration
      </SettingsButton>
    </p>
  );
}
