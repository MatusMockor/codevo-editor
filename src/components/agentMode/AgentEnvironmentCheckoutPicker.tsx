import { ChevronDown, Folder, GitBranch, Monitor, Server, Settings2 } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { AgentTaskIsolation } from "../../domain/agentTask";
import { MenuItem, MenuLabel, MenuSeparator } from "../../ui/foundation/MenuItem";
import { MenuRadioItem } from "../../ui/foundation/MenuRadioItem";
import { useRemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";
import { ComposerMenuPicker } from "./pickers/ComposerMenuPicker";

export interface AgentEnvironmentCheckoutPickerProps {
  readonly disabled: boolean;
  readonly isolation: AgentTaskIsolation;
  readonly remote: boolean;
  readonly worktreeAvailable: boolean;
  readonly worktreeOnly: boolean;
  onIsolationChange(isolation: AgentTaskIsolation): void;
  onOpenEnvironmentSettings?(): void;
  onRefreshIsolation?(): void;
}

export function AgentEnvironmentCheckoutPicker({
  disabled,
  isolation,
  onIsolationChange,
  onOpenEnvironmentSettings,
  onRefreshIsolation,
  remote,
  worktreeAvailable,
  worktreeOnly,
}: AgentEnvironmentCheckoutPickerProps) {
  const runner = useRemoteRunnerContext();
  const selectedServerId = runner?.selectedServerId ?? null;
  const serverName =
    selectedServerId === null
      ? null
      : (runner?.servers.find((server) => server.id === selectedServerId)?.name ??
        "Server unavailable");
  const localLabel = remote ? "Server checkout" : "Local checkout";
  const checkoutLabel = isolation === "worktree" ? "New worktree" : localLabel;
  const triggerText = serverName === null ? checkoutLabel : `${serverName} · ${checkoutLabel}`;
  const pickIsolation = (next: AgentTaskIsolation): void => {
    if (next === isolation) return;
    onIsolationChange(next);
  };

  return (
    <ComposerMenuPicker
      disabled={disabled}
      label="Workspace"
      onOpen={onRefreshIsolation}
      renderTrigger={(trigger) => (
        <button
          aria-expanded={trigger.open}
          aria-haspopup="menu"
          aria-label={`Workspace: ${serverName ?? "This computer"}, ${checkoutLabel}`}
          className="agent-picker__trigger agent-picker__trigger--ghost"
          data-value={isolation}
          disabled={disabled}
          id="agent-checkout"
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
          {serverName !== null ? (
            <Server aria-hidden="true" className="agent-picker__icon" size={14} />
          ) : isolation === "worktree" ? (
            <GitBranch aria-hidden="true" className="agent-picker__icon" size={14} />
          ) : (
            <Folder aria-hidden="true" className="agent-picker__icon" size={14} />
          )}
          <span className="agent-picker__value">{triggerText}</span>
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
        This computer
      </MenuRadioItem>
      {(runner?.servers ?? []).map((server) => (
        <MenuRadioItem
          checked={selectedServerId === server.id}
          description={server.connected ? "Run on server" : "Connect in settings"}
          disabled={!server.connected}
          icon={<Server size={14} />}
          key={server.id}
          onSelect={() => runner?.selectServer(server.id)}
        >
          {server.name}
        </MenuRadioItem>
      ))}
      {runner === null ? (
        <MenuRadioItem
          checked={false}
          description="Coming soon"
          disabled
          icon={<Server size={14} />}
          onSelect={() => undefined}
        >
          Remote server
        </MenuRadioItem>
      ) : null}
      <MenuSeparator />
      <MenuLabel>Checkout</MenuLabel>
      <MenuRadioItem
        checked={isolation === "in-place"}
        disabled={worktreeOnly}
        icon={<Folder size={14} />}
        onSelect={() => pickIsolation("in-place")}
      >
        {localLabel}
      </MenuRadioItem>
      {worktreeAvailable || worktreeOnly ? (
        <MenuRadioItem
          checked={isolation === "worktree"}
          description="Runs in a new git worktree from the selected branch."
          icon={<GitBranch size={14} />}
          onSelect={() => pickIsolation("worktree")}
        >
          New worktree
        </MenuRadioItem>
      ) : null}
      {onOpenEnvironmentSettings === undefined ? null : <MenuSeparator />}
      {onOpenEnvironmentSettings === undefined ? null : (
        <MenuItem icon={<Settings2 size={14} />} onSelect={onOpenEnvironmentSettings}>
          Manage environments
        </MenuItem>
      )}
    </ComposerMenuPicker>
  );
}
