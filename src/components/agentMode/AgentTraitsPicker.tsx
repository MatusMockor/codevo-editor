import { useAgentClaudeModelCatalog } from "./useAgentClaudeModelCatalog";
import { ChevronDown } from "lucide-react";
import type {
  AgentExecutionTarget,
  AgentLaunchOptions,
  ClaudeContextChoice,
  ClaudeEffortChoice,
} from "../../domain/agentLaunch";
import { MenuLabel, MenuSeparator } from "../../ui/foundation/MenuItem";
import { MenuRadioItem } from "../../ui/foundation/MenuRadioItem";
import { MenuSwitchItem } from "../../ui/foundation/MenuSwitchItem";
import {
  agentClaudeLaunchTraits,
  agentLaunchContextLabel,
  agentLaunchEffortLabel,
  agentLaunchWithChrome,
  agentLaunchWithContext,
  agentLaunchWithEffort,
  agentLaunchWithFastMode,
  agentLaunchWithThinkingMode,
} from "./agentLaunchPresentation";
import { ComposerMenuPicker } from "./pickers/ComposerMenuPicker";

interface AgentTraitsPickerProps {
  readonly launch: AgentLaunchOptions & { readonly provider: "claudeCode" };
  readonly disabled: boolean;
  readonly executionTarget: AgentExecutionTarget;
  readonly openRequest?: object | null;
  onOpenRequestHandled?(): void;
  readonly configuredModel: string | null;
  onChange(next: AgentLaunchOptions): void;
}

type EffortLevel = Exclude<ClaudeEffortChoice, "default">;
type EffortMode = Extract<EffortLevel, "ultracode" | "ultrathink">;

const EFFORT_LABELS: Readonly<Record<EffortLevel, string>> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  ultracode: "Ultracode",
  ultrathink: "Ultrathink",
};

const EFFORT_MODE_DESCRIPTIONS: Readonly<Record<EffortMode, string>> = {
  ultracode: "Extra high plus multi-agent orchestration.",
  ultrathink: "Prefixes prompts with Ultrathink.",
};

const CONTEXT_LABELS: Readonly<Record<ClaudeContextChoice, string>> = {
  "200k": "200k",
  "1m": "1M",
};

function isEffortMode(choice: EffortLevel): choice is EffortMode {
  return choice === "ultracode" || choice === "ultrathink";
}

export function AgentTraitsPicker({
  configuredModel,
  disabled,
  executionTarget,
  openRequest = null,
  onOpenRequestHandled,
  launch,
  onChange,
}: AgentTraitsPickerProps) {
  const catalog = useAgentClaudeModelCatalog();
  const traits = agentClaudeLaunchTraits(launch, configuredModel, executionTarget, catalog);
  const effort =
    launch.effort !== "default" && traits.efforts.includes(launch.effort)
      ? launch.effort
      : traits.defaultEffort;
  const context =
    launch.context !== undefined && traits.contextWindows.includes(launch.context)
      ? launch.context
      : configuredModel?.endsWith("[1m]")
        ? "1m"
        : traits.defaultContext;
  const summary = [
    ...(traits.efforts.length > 0 ? [agentLaunchEffortLabel({ ...launch, effort })] : []),
    ...(context === null ? [] : [agentLaunchContextLabel(context)]),
    ...(traits.thinkingMode ? [`Thinking ${launch.thinkingMode === true ? "On" : "Off"}`] : []),
    ...(traits.chrome && launch.chrome === false ? ["Chrome Off"] : []),
  ].join(" · ");
  const levels = traits.efforts.filter((choice) => !isEffortMode(choice));
  const modes = traits.efforts.filter(isEffortMode);
  const showContext = traits.contextWindows.length > 0 && context !== null;
  const showSwitches = traits.fastMode || traits.thinkingMode || traits.chrome;
  const pickEffort = (choice: EffortLevel): void =>
    onChange(agentLaunchWithEffort(launch, choice, configuredModel, catalog));

  return (
    <ComposerMenuPicker
      disabled={disabled}
      label="Effort and options"
      onOpenRequestHandled={onOpenRequestHandled}
      openRequest={openRequest}
      renderTrigger={(trigger) => (
        <button
          aria-expanded={trigger.open}
          aria-haspopup="menu"
          aria-label="Model capabilities"
          className="agent-picker__trigger agent-picker__trigger--ghost"
          data-value={launch.effort}
          disabled={disabled}
          id="agent-launch-effort"
          onClick={trigger.toggle}
          ref={trigger.ref}
          type="button"
        >
          <span className="agent-picker__value">{summary}</span>
          <ChevronDown aria-hidden="true" className="agent-picker__chevron" size={14} />
        </button>
      )}
    >
      {levels.length > 0 ? <MenuLabel>Effort</MenuLabel> : null}
      {levels.map((choice) => (
        <MenuRadioItem
          checked={effort === choice}
          description={traits.defaultEffort === choice ? "Default" : undefined}
          key={choice}
          onSelect={() => pickEffort(choice)}
        >
          {EFFORT_LABELS[choice]}
        </MenuRadioItem>
      ))}
      {modes.length > 0 ? <MenuSeparator /> : null}
      {modes.map((choice) => (
        <MenuRadioItem
          checked={effort === choice}
          description={EFFORT_MODE_DESCRIPTIONS[choice]}
          key={choice}
          onSelect={() => pickEffort(choice)}
        >
          {EFFORT_LABELS[choice]}
        </MenuRadioItem>
      ))}
      {showContext ? <MenuSeparator /> : null}
      {showContext ? <MenuLabel>Context window</MenuLabel> : null}
      {showContext
        ? traits.contextWindows.map((choice) => (
            <MenuRadioItem
              checked={context === choice}
              description={traits.defaultContext === choice ? "Default" : undefined}
              key={choice}
              onSelect={() =>
                onChange(agentLaunchWithContext(launch, choice, configuredModel, catalog))
              }
            >
              {CONTEXT_LABELS[choice]}
            </MenuRadioItem>
          ))
        : null}
      {showSwitches ? <MenuSeparator /> : null}
      {traits.fastMode ? (
        <MenuSwitchItem
          checked={launch.fastMode === true}
          onToggle={(next) =>
            onChange(agentLaunchWithFastMode(launch, next, configuredModel, catalog))
          }
        >
          Fast mode
        </MenuSwitchItem>
      ) : null}
      {traits.thinkingMode ? (
        <MenuSwitchItem
          checked={launch.thinkingMode === true}
          onToggle={(next) =>
            onChange(agentLaunchWithThinkingMode(launch, next, configuredModel, catalog))
          }
        >
          Thinking
        </MenuSwitchItem>
      ) : null}
      {traits.chrome ? (
        <MenuSwitchItem
          checked={launch.chrome !== false}
          onToggle={(next) =>
            onChange(agentLaunchWithChrome(launch, next, configuredModel, catalog))
          }
        >
          Chrome browser tools
        </MenuSwitchItem>
      ) : null}
    </ComposerMenuPicker>
  );
}
