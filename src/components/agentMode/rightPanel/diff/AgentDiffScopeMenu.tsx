import type { RefObject } from "react";
import type {
  AgentDiffScope,
  AgentDiffTurnOption,
} from "../../../../domain/diffView/agentDiffScope";
import { agentDiffScopesEqual } from "../../../../domain/diffView/agentDiffScope";
import { Menu } from "../../../../ui/foundation/Menu";
import { MenuItem, MenuSeparator } from "../../../../ui/foundation/MenuItem";
import type { AgentDiffScopeChoices } from "./AgentDiffSurface";

export interface AgentDiffScopeMenuProps {
  readonly open: boolean;
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly scope: AgentDiffScope;
  readonly choices: AgentDiffScopeChoices;
  onSelect(scope: AgentDiffScope): void;
  onClose(): void;
}

export function AgentDiffScopeMenu({
  anchorRef,
  choices,
  onClose,
  onSelect,
  open,
  scope,
}: AgentDiffScopeMenuProps) {
  const pick = (next: AgentDiffScope) => {
    onClose();
    onSelect(next);
  };
  const branch = choices.branch;
  return (
    <Menu anchorRef={anchorRef} label="Diff scope" onClose={onClose} open={open}>
      {choices.workingTree && (
        <MenuItem
          checked={scope.kind === "workingTree"}
          onSelect={() => pick({ kind: "workingTree" })}
        >
          Working tree
        </MenuItem>
      )}
      {branch !== null && (
        <MenuItem
          checked={scope.kind === "branch"}
          onSelect={() => pick({ kind: "branch", baseRef: branch.defaultBase })}
        >
          Branch changes
        </MenuItem>
      )}
      {choices.turns.length > 0 && (
        <MenuItem
          checked={scope.kind === "latestTurn"}
          onSelect={() => pick({ kind: "latestTurn" })}
        >
          Latest turn
        </MenuItem>
      )}
      {choices.turns.length > 0 && <MenuSeparator />}
      {choices.turns.map((turn) => (
        <MenuItem
          checked={agentDiffScopesEqual(scope, { kind: "turn", turnId: turn.turnId })}
          key={turn.turnId}
          onSelect={() => pick({ kind: "turn", turnId: turn.turnId })}
          shortcut={turnTime(turn)}
        >
          {turn.label}
        </MenuItem>
      ))}
    </Menu>
  );
}

function turnTime(turn: AgentDiffTurnOption): string {
  return new Date(turn.endedAtEpochMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
