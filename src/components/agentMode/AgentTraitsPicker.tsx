import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import type {
  AgentLaunchOptions,
  ClaudeContextChoice,
  ClaudeEffortChoice,
} from "../../domain/agentLaunch";
import { CLAUDE_CONTEXT_CHOICES, CLAUDE_EFFORT_CHOICES } from "../../domain/agentLaunch";
import {
  agentLaunchContextLabel,
  agentLaunchEffortLabel,
  agentLaunchWithContext,
  agentLaunchWithEffort,
} from "./agentLaunchPresentation";
import { useAgentPopover } from "./agentPopover";

interface AgentTraitsPickerProps {
  readonly launch: AgentLaunchOptions & { readonly provider: "claudeCode" };
  readonly disabled: boolean;
  readonly configuredModel: string | null;
  onChange(next: AgentLaunchOptions): void;
}

const EFFORT_LABELS: Readonly<Record<ClaudeEffortChoice, string>> = {
  default: "CLI default",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
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
  const context = launch.context ?? (configuredModel?.endsWith("[1m]") ? "1m" : "200k");
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
        <span className="agent-picker__value">
          {agentLaunchEffortLabel(launch)} · {agentLaunchContextLabel(context)}
        </span>
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
          <TraitGroup label="Reasoning">
            {CLAUDE_EFFORT_CHOICES.map((effort) => (
              <TraitOption
                checked={launch.effort === effort}
                key={effort}
                label={EFFORT_LABELS[effort]}
                onSelect={() => onChange(agentLaunchWithEffort(launch, effort))}
              />
            ))}
          </TraitGroup>
          <TraitGroup label="Context window">
            {CLAUDE_CONTEXT_CHOICES.map((choice) => (
              <TraitOption
                checked={context === choice}
                key={choice}
                label={CONTEXT_LABELS[choice]}
                onSelect={() => onChange(agentLaunchWithContext(launch, choice, configuredModel))}
              />
            ))}
          </TraitGroup>
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
  label,
  onSelect,
}: {
  readonly checked: boolean;
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
      <span aria-hidden="true" className="agent-picker__mark">
        {checked && <Check size={12} />}
      </span>
      <span className="agent-picker__label">{label}</span>
    </button>
  );
}
