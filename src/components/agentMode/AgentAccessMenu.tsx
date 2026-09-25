import {
  ChevronDown,
  ClipboardList,
  Lock,
  LockOpen,
  PenLine,
  Settings2,
  Sparkles,
} from "lucide-react";
import { useId } from "react";
import type { AgentExecutionTarget, AgentLaunchOptions } from "../../domain/agentLaunch";
import { MenuLabel, MenuSeparator } from "../../ui/foundation/MenuItem";
import { MenuRadioItem } from "../../ui/foundation/MenuRadioItem";
import {
  agentLaunchAccess,
  agentLaunchModeGroups,
  agentLaunchModeHint,
  agentLaunchModeLabel,
  agentLaunchTone,
  type AgentLaunchChoice,
} from "./agentLaunchPresentation";
import { ComposerMenuPicker } from "./pickers/ComposerMenuPicker";

export interface AgentAccessMenuProps {
  readonly disabled: boolean;
  readonly launch: AgentLaunchOptions;
  readonly openRequest?: object | null;
  readonly target: AgentExecutionTarget;
  onChange(mode: string): void;
  onOpenRequestHandled?(): void;
}

export function AgentAccessMenu({
  disabled,
  launch,
  onChange,
  onOpenRequestHandled,
  openRequest = null,
  target,
}: AgentAccessMenuProps) {
  const hintId = useId();
  const groups = agentLaunchModeGroups(launch.provider, target);
  const tone = agentLaunchTone(launch);
  const row = (choice: AgentLaunchChoice) => (
    <MenuRadioItem
      checked={choice.value === launch.mode}
      description={choice.value === "default" ? undefined : choice.hint}
      icon={modeIcon(choice.value)}
      key={choice.value}
      onSelect={() => {
        if (choice.value === launch.mode) return;
        onChange(choice.value);
      }}
    >
      {choice.label}
    </MenuRadioItem>
  );
  return (
    <ComposerMenuPicker
      disabled={disabled}
      label="Access"
      onOpenRequestHandled={onOpenRequestHandled}
      openRequest={openRequest}
      renderTrigger={(trigger) => (
        <>
          <button
            aria-describedby={hintId}
            aria-expanded={trigger.open}
            aria-haspopup="menu"
            aria-label="Agent permission mode"
            className={`agent-picker__trigger agent-picker__trigger--ghost${tone === null ? "" : ` agent-picker__trigger--${tone}`}`}
            data-value={launch.mode}
            disabled={disabled}
            id="agent-launch-mode"
            onClick={trigger.toggle}
            ref={trigger.ref}
            type="button"
          >
            {agentLaunchAccess(launch) === "open" ? (
              <LockOpen aria-hidden="true" className="agent-picker__icon" size={14} />
            ) : (
              <Lock aria-hidden="true" className="agent-picker__icon" size={14} />
            )}
            <span className="agent-picker__value">{agentLaunchModeLabel(launch)}</span>
            <ChevronDown aria-hidden="true" className="agent-picker__chevron" size={14} />
          </button>
          <span className="agent-visually-hidden" id={hintId}>
            {agentLaunchModeHint(launch, target)}
          </span>
        </>
      )}
    >
      <MenuLabel>Access</MenuLabel>
      {groups.access.map(row)}
      <MenuSeparator />
      {groups.other.map(row)}
    </ComposerMenuPicker>
  );
}

function modeIcon(value: string) {
  if (value === "supervised" || value === "readOnly") return <Lock size={14} />;
  if (value === "acceptEdits" || value === "workspaceWrite") return <PenLine size={14} />;
  if (value === "auto") return <Sparkles size={14} />;
  if (value === "plan") return <ClipboardList size={14} />;
  if (value === "default") return <Settings2 size={14} />;
  return <LockOpen size={14} />;
}
