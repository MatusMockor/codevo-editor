import { ChevronDown, Monitor, Server, Settings2 } from "lucide-react";
import type { KeyboardEvent } from "react";
import { agentMachineLabel, type AgentMachine } from "../../domain/agentWorkspaceLocation";
import { MenuItem, MenuLabel, MenuSeparator } from "../../ui/foundation/MenuItem";
import { MenuRadioItem } from "../../ui/foundation/MenuRadioItem";
import { useRemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";
import { ComposerMenuPicker } from "./pickers/ComposerMenuPicker";

export interface AgentRunOnPickerProps {
  readonly disabled: boolean;
  readonly machine: AgentMachine;
  onOpenEnvironmentSettings?(): void;
}

export function AgentRunOnPicker({
  disabled,
  machine,
  onOpenEnvironmentSettings,
}: AgentRunOnPickerProps) {
  const runner = useRemoteRunnerContext();
  const selectedServerId = runner?.selectedServerId ?? null;
  const label = agentMachineLabel(machine);
  return (
    <ComposerMenuPicker
      disabled={disabled}
      label="Run on"
      renderTrigger={(trigger) => (
        <button
          aria-expanded={trigger.open}
          aria-haspopup="menu"
          aria-label={`Run on: ${label}`}
          className="agent-picker__trigger agent-picker__trigger--ghost"
          data-value={machine.kind}
          disabled={disabled}
          id="agent-run-on"
          onClick={trigger.toggle}
          onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            event.stopPropagation();
            trigger.show();
          }}
          ref={trigger.ref}
          type="button"
        >
          <MachineGlyph className="agent-picker__icon" machine={machine} />
          <span className="agent-picker__value">{label}</span>
          <ChevronDown aria-hidden="true" className="agent-picker__chevron" size={14} />
        </button>
      )}
    >
      <MenuLabel>Run on</MenuLabel>
      <MenuRadioItem
        checked={selectedServerId === null}
        icon={<Monitor size={14} />}
        onSelect={() => runner?.selectServer(null)}
      >
        {agentMachineLabel({ kind: "thisComputer" })}
      </MenuRadioItem>
      {(runner?.servers ?? []).map((server) => (
        <MenuRadioItem
          checked={selectedServerId === server.id}
          description={server.connected ? undefined : "Connect in settings"}
          disabled={!server.connected}
          icon={<Server size={14} />}
          key={server.id}
          onSelect={() => runner?.selectServer(server.id)}
        >
          {server.name}
        </MenuRadioItem>
      ))}
      {onOpenEnvironmentSettings === undefined ? null : <MenuSeparator />}
      {onOpenEnvironmentSettings === undefined ? null : (
        <MenuItem icon={<Settings2 size={14} />} onSelect={onOpenEnvironmentSettings}>
          Manage environments
        </MenuItem>
      )}
    </ComposerMenuPicker>
  );
}

export function MachineGlyph({
  className,
  machine,
  size = 14,
}: {
  readonly className?: string;
  readonly machine: AgentMachine;
  readonly size?: number;
}) {
  if (machine.kind === "server") {
    return <Server aria-hidden="true" className={className} size={size} />;
  }
  return <Monitor aria-hidden="true" className={className} size={size} />;
}
