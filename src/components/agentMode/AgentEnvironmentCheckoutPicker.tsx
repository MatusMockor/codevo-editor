import { ChevronDown, Folder, FolderGit, FolderGit2, History, Settings2 } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { AgentTaskIsolation } from "../../domain/agentTask";
import {
  agentCheckoutLabel,
  agentPreviousWorktreeLabel,
  type AgentCheckoutKind,
} from "../../domain/agentWorkspaceLocation";
import { MenuItem, MenuSeparator } from "../../ui/foundation/MenuItem";
import { MenuRadioItem } from "../../ui/foundation/MenuRadioItem";
import type { AgentComposerPreviousWorktreeChoice } from "./agentComposerPreviousWorktree";
import { ComposerMenuPicker } from "./pickers/ComposerMenuPicker";

export interface AgentEnvironmentCheckoutPickerProps {
  readonly disabled: boolean;
  readonly checkout: AgentCheckoutKind;
  readonly isolation: AgentTaskIsolation;
  readonly remote: boolean;
  readonly worktreeAvailable: boolean;
  readonly worktreeOnly: boolean;
  readonly previousWorktree?: AgentComposerPreviousWorktreeChoice | null;
  onIsolationChange(isolation: AgentTaskIsolation): void;
  onOpenEnvironmentSettings?(): void;
  onRefreshIsolation?(): void;
}

export function AgentEnvironmentCheckoutPicker({
  checkout,
  disabled,
  isolation,
  onIsolationChange,
  onOpenEnvironmentSettings,
  onRefreshIsolation,
  previousWorktree = null,
  remote,
  worktreeAvailable,
  worktreeOnly,
}: AgentEnvironmentCheckoutPickerProps) {
  const previousSelected = previousWorktree?.selected ?? false;
  const label = agentCheckoutLabel(checkout);
  const pickIsolation = (next: AgentTaskIsolation): void => {
    if (next === isolation && !previousSelected) return;
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
          aria-label={`Workspace: ${label}`}
          className="agent-picker__trigger agent-picker__trigger--ghost"
          data-checkout={checkout}
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
          <CheckoutGlyph checkout={checkout} className="agent-picker__icon" />
          <span className="agent-picker__value">{label}</span>
          <ChevronDown aria-hidden="true" className="agent-picker__chevron" size={14} />
        </button>
      )}
    >
      <MenuRadioItem
        checked={!previousSelected && isolation === "in-place"}
        disabled={worktreeOnly}
        icon={<Folder size={14} />}
        onSelect={() => pickIsolation("in-place")}
      >
        {agentCheckoutLabel(remote ? "serverCheckout" : "localCheckout")}
      </MenuRadioItem>
      {worktreeAvailable || worktreeOnly ? (
        <MenuRadioItem
          checked={!previousSelected && isolation === "worktree"}
          description="Runs in a new git worktree from the selected branch."
          icon={<FolderGit2 size={14} />}
          onSelect={() => pickIsolation("worktree")}
        >
          {agentCheckoutLabel("newWorktree")}
        </MenuRadioItem>
      ) : null}
      {previousWorktree === null ? null : (
        <MenuRadioItem
          checked={previousSelected}
          icon={<History size={14} />}
          onSelect={() => {
            if (previousSelected) return;
            previousWorktree.onSelect();
          }}
        >
          {agentPreviousWorktreeLabel(previousWorktree.available.branch)}
        </MenuRadioItem>
      )}
      {onOpenEnvironmentSettings === undefined ? null : <MenuSeparator />}
      {onOpenEnvironmentSettings === undefined ? null : (
        <MenuItem icon={<Settings2 size={14} />} onSelect={onOpenEnvironmentSettings}>
          Manage environments
        </MenuItem>
      )}
    </ComposerMenuPicker>
  );
}

export function CheckoutGlyph({
  checkout,
  className,
  size = 14,
}: {
  readonly checkout: AgentCheckoutKind;
  readonly className?: string;
  readonly size?: number;
}) {
  switch (checkout) {
    case "localCheckout":
    case "serverCheckout":
      return <Folder aria-hidden="true" className={className} size={size} />;
    case "newWorktree":
      return <FolderGit2 aria-hidden="true" className={className} size={size} />;
    case "worktree":
      return <FolderGit aria-hidden="true" className={className} size={size} />;
    case "previousWorktree":
      return <History aria-hidden="true" className={className} size={size} />;
  }
}
