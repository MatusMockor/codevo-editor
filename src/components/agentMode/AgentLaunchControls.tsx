import { Lock, LockOpen } from "lucide-react";
import type { AgentModelFavorites } from "../../application/useAgentModelFavorites";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import type { AgentCliKind } from "../../domain/agentTask";
import {
  agentLaunchAccess,
  agentLaunchModeChoices,
  agentLaunchModeHint,
  agentLaunchModelHint,
  agentLaunchTone,
  agentLaunchWithMode,
  agentLaunchWithModel,
  type AgentLaunchAccess,
  type AgentLaunchChoice,
} from "./agentLaunchPresentation";
import { AgentModelPicker } from "./AgentModelPicker";
import { defaultAgentComposerLaunch } from "./agentComposerLaunch";
import { AgentPickerMenu } from "./AgentPickerMenu";
import { AgentTraitsPicker } from "./AgentTraitsPicker";
import { agentPickerOption, type AgentPickerOption } from "./agentPickerOption";

const MODEL_ID = "agent-launch-model";
const MODE_ID = "agent-launch-mode";

export interface AgentLaunchControlsProps {
  readonly launch: AgentLaunchOptions;
  readonly disabled: boolean;
  readonly favorites: AgentModelFavorites;
  readonly providerEnabled?: Readonly<Record<AgentCliKind, boolean>> | null;
  readonly providerManagement?: AgentProviderManagementSurface | null;
  readonly providerSwitchable?: boolean;
  onLaunchChange(next: AgentLaunchOptions): void;
}

export function AgentLaunchControls({
  disabled,
  favorites,
  launch,
  onLaunchChange,
  providerEnabled = null,
  providerManagement = null,
  providerSwitchable = false,
}: AgentLaunchControlsProps) {
  const modeChoices = agentLaunchModeChoices(launch.provider);
  const discovered = providerManagement?.cliDiscovery[launch.provider];
  const configuredModel =
    discovered?.kind === "detected" ? (discovered.configuredModel ?? null) : null;
  return (
    <div className="agent-composer__launch">
      <AgentModelPicker
        describedBy={`${MODEL_ID}-hint`}
        disabled={disabled}
        favorites={favorites}
        id={MODEL_ID}
        label="Agent model"
        launch={launch}
        onSelect={(model, provider = launch.provider) =>
          onLaunchChange(
            agentLaunchWithModel(
              provider === launch.provider ? launch : defaultAgentComposerLaunch(provider),
              model,
            ),
          )
        }
        providerEnabled={providerEnabled}
        providerManagement={providerManagement}
        providerSwitchable={providerSwitchable}
      />
      <span className="agent-visually-hidden" id={`${MODEL_ID}-hint`}>
        {agentLaunchModelHint(launch, configuredModel)}
      </span>

      {launch.provider === "claudeCode" && (
        <>
          <AgentLaunchDivider />
          <AgentTraitsPicker
            configuredModel={configuredModel}
            disabled={disabled}
            launch={launch}
            onChange={onLaunchChange}
          />
        </>
      )}

      <AgentLaunchDivider />
      <AgentPickerMenu
        align="start"
        confirmation={null}
        describedBy={`${MODE_ID}-hint`}
        disabled={disabled}
        icon={accessIcon(agentLaunchAccess(launch))}
        id={MODE_ID}
        label="Agent permission mode"
        onChange={(value) => onLaunchChange(agentLaunchWithMode(launch, value))}
        options={modeChoices.map(toOption)}
        prefix={null}
        tone={agentLaunchTone(launch)}
        value={launch.mode}
        variant="ghost"
      />
      <span className="agent-visually-hidden" id={`${MODE_ID}-hint`}>
        {agentLaunchModeHint(launch)}
      </span>
    </div>
  );
}

function AgentLaunchDivider() {
  return <span aria-hidden="true" className="agent-composer__divider" />;
}

function accessIcon(access: AgentLaunchAccess) {
  if (access === "open") return <LockOpen size={14} />;
  return <Lock size={14} />;
}

function toOption(choice: AgentLaunchChoice): AgentPickerOption {
  return agentPickerOption(choice.value, choice.label, choice.hint, choice.tone);
}
