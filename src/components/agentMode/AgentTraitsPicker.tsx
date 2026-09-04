import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import type {
  AgentLaunchOptions,
  ClaudeContextChoice,
  ClaudeEffortChoice,
} from "../../domain/agentLaunch";
import {
  agentClaudeLaunchTraits,
  agentLaunchContextLabel,
  agentLaunchEffortLabel,
  agentLaunchWithContext,
  agentLaunchWithEffort,
  agentLaunchWithFastMode,
  agentLaunchWithThinkingMode,
} from "./agentLaunchPresentation";
import { useAgentPopover } from "./agentPopover";

interface AgentTraitsPickerProps {
  readonly launch: AgentLaunchOptions & { readonly provider: "claudeCode" };
  readonly disabled: boolean;
  readonly configuredModel: string | null;
  onChange(next: AgentLaunchOptions): void;
}

const EFFORT_LABELS: Readonly<Record<Exclude<ClaudeEffortChoice, "default">, string>> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
  ultracode: "Ultracode",
  ultrathink: "Ultrathink",
};

const CONTEXT_LABELS: Readonly<Record<ClaudeContextChoice, string>> = {
  "200k": "200k",
  "1m": "1M",
};

export function AgentTraitsPicker({
  configuredModel,
  disabled,
  launch,
  onChange,
}: AgentTraitsPickerProps) {
  const popover = useAgentPopover("start", disabled);
  const traits = agentClaudeLaunchTraits(launch, configuredModel);
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
  ].join(" · ");
  return (
    <div
      className={`agent-picker${popover.open ? " agent-picker--open" : ""}`}
      data-placement={popover.open ? popover.placement : undefined}
      onBlur={popover.onBlur}
      ref={popover.rootRef}
    >
      <button
        aria-expanded={popover.open}
        aria-haspopup="dialog"
        aria-label="Model capabilities"
        className="agent-picker__trigger agent-picker__trigger--ghost"
        data-value={launch.effort}
        disabled={disabled}
        id="agent-launch-effort"
        onClick={popover.toggle}
        ref={popover.triggerRef}
        type="button"
      >
        <span className="agent-picker__value">{summary}</span>
        <ChevronDown aria-hidden="true" className="agent-picker__chevron" size={12} />
      </button>
      {popover.open && (
        <div
          aria-label="Model capabilities"
          className="agent-picker__menu agent-traits-picker__menu"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            popover.hide(true);
          }}
          ref={popover.popoverRef}
          role="dialog"
          style={popover.style}
        >
          {traits.efforts.length > 0 && (
            <TraitGroup label="Reasoning">
              {traits.efforts.map((choice) => (
                <TraitOption
                  checked={effort === choice}
                  description={
                    choice === "ultracode"
                      ? "xhigh effort plus multi-agent workflow orchestration"
                      : null
                  }
                  isDefault={traits.defaultEffort === choice}
                  key={choice}
                  label={EFFORT_LABELS[choice]}
                  onSelect={() => onChange(agentLaunchWithEffort(launch, choice, configuredModel))}
                />
              ))}
            </TraitGroup>
          )}
          {traits.contextWindows.length > 0 && context !== null && (
            <TraitGroup label="Context Window">
              {traits.contextWindows.map((choice) => (
                <TraitOption
                  checked={context === choice}
                  isDefault={traits.defaultContext === choice}
                  key={choice}
                  label={CONTEXT_LABELS[choice]}
                  onSelect={() => onChange(agentLaunchWithContext(launch, choice, configuredModel))}
                />
              ))}
            </TraitGroup>
          )}
          {traits.fastMode && (
            <TraitGroup label="Fast Mode">
              <TraitOption
                checked={launch.fastMode === true}
                isDefault={false}
                label="On"
                onSelect={() => onChange(agentLaunchWithFastMode(launch, true, configuredModel))}
              />
              <TraitOption
                checked={launch.fastMode !== true}
                label="Off"
                onSelect={() => onChange(agentLaunchWithFastMode(launch, false, configuredModel))}
              />
            </TraitGroup>
          )}
          {traits.thinkingMode && (
            <TraitGroup label="Thinking">
              <TraitOption
                checked={launch.thinkingMode === true}
                label="On"
                onSelect={() =>
                  onChange(agentLaunchWithThinkingMode(launch, true, configuredModel))
                }
              />
              <TraitOption
                checked={launch.thinkingMode !== true}
                label="Off"
                onSelect={() =>
                  onChange(agentLaunchWithThinkingMode(launch, false, configuredModel))
                }
              />
            </TraitGroup>
          )}
        </div>
      )}
    </div>
  );
}

function TraitGroup({ children, label }: { readonly children: ReactNode; readonly label: string }) {
  return (
    <div aria-label={label} className="agent-traits-picker__group" role="group">
      <div className="agent-traits-picker__heading">{label}</div>
      {children}
    </div>
  );
}

function TraitOption({
  checked,
  description = null,
  isDefault = false,
  label,
  onSelect,
}: {
  readonly checked: boolean;
  readonly description?: string | null;
  readonly isDefault?: boolean;
  readonly label: string;
  onSelect(): void;
}) {
  return (
    <button
      aria-checked={checked}
      className="agent-picker__option agent-traits-picker__option"
      onClick={onSelect}
      role="radio"
      type="button"
    >
      <span className="agent-traits-picker__copy">
        <span className="agent-picker__label">
          {label}
          {isDefault && <span className="agent-traits-picker__default">Default</span>}
        </span>
        {description !== null && (
          <span className="agent-traits-picker__description">{description}</span>
        )}
      </span>
    </button>
  );
}
