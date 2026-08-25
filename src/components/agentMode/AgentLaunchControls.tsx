import { TriangleAlert } from "lucide-react";
import {
  CLAUDE_MODEL_CHOICES,
  CLAUDE_PERMISSION_MODES,
  CODEX_EXECUTION_MODES,
  CODEX_MODEL_CHOICES,
  type AgentLaunchOptions,
} from "../../domain/agentLaunch";
import {
  agentLaunchDangerConfirmLabel,
  agentLaunchDangerNotice,
  agentLaunchModeChoices,
  agentLaunchModeHint,
  agentLaunchModeLabel,
  agentLaunchModelChoices,
  agentLaunchModelHint,
} from "./agentLaunchPresentation";

const MODEL_ID = "agent-launch-model";
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
  const modelHint = agentLaunchModelHint(launch);
  const modeHint = agentLaunchModeHint(launch);

  return (
    <div className="agent-composer__launch">
      <label className="agent-visually-hidden" htmlFor={MODEL_ID}>
        Agent model
      </label>
      <select
        aria-describedby={`${MODEL_ID}-hint`}
        className="agent-composer__launch-select"
        disabled={disabled}
        id={MODEL_ID}
        onChange={(event) => onLaunchChange(withModel(launch, event.target.value))}
        title={modelHint}
        value={launch.model}
      >
        {agentLaunchModelChoices(launch.provider).map((choice) => (
          <option key={choice.value} title={choice.hint} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
      <span className="agent-visually-hidden" id={`${MODEL_ID}-hint`}>
        {modelHint}
      </span>

      <label className="agent-visually-hidden" htmlFor={MODE_ID}>
        Agent permission mode
      </label>
      <select
        aria-describedby={`${MODE_ID}-hint`}
        className="agent-composer__launch-select"
        disabled={disabled}
        id={MODE_ID}
        onChange={(event) => onLaunchChange(withMode(launch, event.target.value))}
        title={modeHint}
        value={launch.mode}
      >
        {agentLaunchModeChoices(launch.provider).map((choice) => (
          <option key={choice.value} title={choice.hint} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
      <span className="agent-visually-hidden" id={`${MODE_ID}-hint`}>
        {modeHint}
      </span>
    </div>
  );
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

function withModel(launch: AgentLaunchOptions, value: string): AgentLaunchOptions {
  if (launch.provider === "claudeCode") {
    const model = pick(CLAUDE_MODEL_CHOICES, value);
    if (model === null) return launch;
    return { ...launch, model };
  }
  const model = pick(CODEX_MODEL_CHOICES, value);
  if (model === null) return launch;
  return { ...launch, model };
}

function withMode(launch: AgentLaunchOptions, value: string): AgentLaunchOptions {
  if (launch.provider === "claudeCode") {
    const mode = pick(CLAUDE_PERMISSION_MODES, value);
    if (mode === null) return launch;
    return { ...launch, mode };
  }
  const mode = pick(CODEX_EXECUTION_MODES, value);
  if (mode === null) return launch;
  return { ...launch, mode };
}

function pick<Value extends string>(values: ReadonlyArray<Value>, value: string): Value | null {
  const match = values.find((candidate) => candidate === value);
  return match ?? null;
}
