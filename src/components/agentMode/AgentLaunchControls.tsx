import { Lock, LockOpen } from "lucide-react";
import type { AgentModelFavorites } from "../../application/useAgentModelFavorites";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import type { AgentCliKind } from "../../domain/agentTask";
import {
  agentLaunchAccess,
  agentLaunchEffortChoices,
  agentLaunchEffortHint,
  agentLaunchEffortValue,
  agentLaunchModeChoices,
  agentLaunchModeHint,
  agentLaunchModelHint,
  agentLaunchSupportsEffort,
  agentLaunchTone,
  agentLaunchWithEffort,
  agentLaunchWithMode,
  agentLaunchWithModel,
  type AgentLaunchAccess,
  type AgentLaunchChoice,
} from "./agentLaunchPresentation";
import { AgentModelPicker } from "./AgentModelPicker";
import { AgentPickerMenu } from "./AgentPickerMenu";
import { agentPickerOption, type AgentPickerOption } from "./agentPickerOption";

const MODEL_ID = "agent-launch-model";
const EFFORT_ID = "agent-launch-effort";
const MODE_ID = "agent-launch-mode";

export interface AgentLaunchControlsProps {
  readonly launch: AgentLaunchOptions;
  readonly disabled: boolean;
  readonly favorites: AgentModelFavorites;
  readonly providerEnabled?: Readonly<Record<AgentCliKind, boolean>> | null;
  readonly providerManagement?: AgentProviderManagementSurface | null;
  onLaunchChange(next: AgentLaunchOptions): void;
}

export function AgentLaunchControls({
  disabled,
  favorites,
  launch,
  onLaunchChange,
  providerEnabled = null,
  providerManagement = null,
}: AgentLaunchControlsProps) {
  const modeChoices = agentLaunchModeChoices(launch.provider);
  return (
    <div className="agent-composer__launch">
      <AgentModelPicker
        describedBy={`${MODEL_ID}-hint`}
        disabled={disabled}
        favorites={favorites}
        id={MODEL_ID}
        label="Agent model"
        launch={launch}
        onSelect={(model) => onLaunchChange(agentLaunchWithModel(launch, model))}
        providerEnabled={providerEnabled}
        providerManagement={providerManagement}
      />
      <span className="agent-visually-hidden" id={`${MODEL_ID}-hint`}>
        {agentLaunchModelHint(launch)}
      </span>

      {agentLaunchSupportsEffort(launch) && (
        <>
          <AgentLaunchDivider />
          <AgentPickerMenu
            align="start"
            describedBy={`${EFFORT_ID}-hint`}
            disabled={disabled}
            id={EFFORT_ID}
            label="Agent reasoning effort"
            onChange={(value) => onLaunchChange(agentLaunchWithEffort(launch, value))}
            options={agentLaunchEffortChoices().map(toOption)}
            prefix={null}
            tone={null}
            value={agentLaunchEffortValue(launch)}
            variant="ghost"
          />
          <span className="agent-visually-hidden" id={`${EFFORT_ID}-hint`}>
            {agentLaunchEffortHint(launch)}
          </span>
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
