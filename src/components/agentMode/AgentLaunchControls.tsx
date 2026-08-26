import { Lock, LockOpen, TriangleAlert } from "lucide-react";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import {
  agentLaunchAccess,
  agentLaunchDangerConfirmLabel,
  agentLaunchDangerNotice,
  agentLaunchEffortChoices,
  agentLaunchEffortHint,
  agentLaunchEffortValue,
  agentLaunchModeChoices,
  agentLaunchModeHint,
  agentLaunchModeLabel,
  agentLaunchModelChoices,
  agentLaunchModelHint,
  agentLaunchSupportsEffort,
  agentLaunchTone,
  agentLaunchWithEffort,
  agentLaunchWithMode,
  agentLaunchWithModel,
  type AgentLaunchAccess,
  type AgentLaunchChoice,
} from "./agentLaunchPresentation";
import { AgentPickerMenu } from "./AgentPickerMenu";
import { agentPickerOption, type AgentPickerOption } from "./agentPickerOption";
import { AgentProviderGlyph } from "./AgentProviderGlyph";

const MODEL_ID = "agent-launch-model";
const EFFORT_ID = "agent-launch-effort";
const MODE_ID = "agent-launch-mode";
const DANGER_ID = "agent-launch-danger-confirm";

export interface AgentLaunchControlsProps {
  readonly launch: AgentLaunchOptions;
  readonly disabled: boolean;
  onLaunchChange(next: AgentLaunchOptions): void;
}

export function AgentLaunchControls({
  disabled,
  launch,
  onLaunchChange,
}: AgentLaunchControlsProps) {
  return (
    <div className="agent-composer__launch">
      <AgentPickerMenu
        align="start"
        describedBy={`${MODEL_ID}-hint`}
        disabled={disabled}
        icon={<AgentProviderGlyph kind={launch.provider} />}
        id={MODEL_ID}
        label="Agent model"
        onChange={(value) => onLaunchChange(agentLaunchWithModel(launch, value))}
        options={agentLaunchModelChoices(launch.provider).map(toOption)}
        prefix={null}
        tone={null}
        value={launch.model}
        variant="ghost"
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
        describedBy={`${MODE_ID}-hint`}
        disabled={disabled}
        icon={accessIcon(agentLaunchAccess(launch))}
        id={MODE_ID}
        label="Agent permission mode"
        onChange={(value) => onLaunchChange(agentLaunchWithMode(launch, value))}
        options={agentLaunchModeChoices(launch.provider).map(toOption)}
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

export function AgentLaunchWarning({
  confirmed,
  launch,
  onConfirmedChange,
}: {
  readonly launch: AgentLaunchOptions;
  readonly confirmed: boolean;
  onConfirmedChange(confirmed: boolean): void;
}) {
  const notice = agentLaunchDangerNotice(launch);
  if (notice === null) return null;

  return (
    <div className="agent-composer__danger" role="alert">
      <span className="agent-composer__danger-title">
        <TriangleAlert aria-hidden="true" size={12} />
        {agentLaunchModeLabel(launch)} removes the safety checks
      </span>
      <p className="agent-composer__danger-body">{notice}</p>
      <label className="agent-composer__checkbox" htmlFor={DANGER_ID}>
        <input
          checked={confirmed}
          id={DANGER_ID}
          onChange={(event) => onConfirmedChange(event.target.checked)}
          type="checkbox"
        />
        {agentLaunchDangerConfirmLabel(launch)}
      </label>
    </div>
  );
}

function toOption(choice: AgentLaunchChoice): AgentPickerOption {
  return agentPickerOption(choice.value, choice.label, choice.hint, choice.tone);
}
