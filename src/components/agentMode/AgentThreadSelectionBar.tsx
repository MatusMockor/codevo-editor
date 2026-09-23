import { useState, type KeyboardEvent } from "react";
import { Archive, ArchiveRestore, Trash2, X } from "lucide-react";
import {
  agentThreadBulkConfirmLabel,
  agentThreadBulkConfirmReady,
  threadCountLabel,
  type AgentThreadBulkAction,
} from "../../domain/agentThreadBulkAction";
import { sameListSelectionOwner, type ListSelectionOwner } from "../../domain/listSelection";

export interface AgentThreadSelectionBarProps {
  readonly selectedIds: ReadonlyArray<string>;
  readonly archivedCount?: number;
  readonly owner: ListSelectionOwner;
  onAction(action: AgentThreadBulkAction, capturedOwner: ListSelectionOwner): void;
  onClear(): void;
}

interface ArmedDelete {
  readonly owner: ListSelectionOwner;
  readonly ids: ReadonlyArray<string>;
  readonly atEpochMs: number;
}

export function AgentThreadSelectionBar({
  archivedCount = 0,
  onAction,
  onClear,
  owner,
  selectedIds,
}: AgentThreadSelectionBarProps) {
  const [armedState, setArmedState] = useState<ArmedDelete | null>(null);
  const count = selectedIds.length;
  const armed =
    armedState !== null &&
    sameListSelectionOwner(armedState.owner, owner) &&
    sameIds(armedState.ids, selectedIds);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (armedState !== null) {
      setArmedState(null);
      return;
    }
    onClear();
  };

  const archive = (): void => {
    setArmedState(null);
    onAction("archive", owner);
  };

  const unarchive = (): void => {
    setArmedState(null);
    onAction("unarchive", owner);
  };

  const remove = (): void => {
    if (!armed || armedState === null) {
      setArmedState({ owner, ids: [...selectedIds], atEpochMs: Date.now() });
      return;
    }
    if (!agentThreadBulkConfirmReady(armedState.atEpochMs, Date.now())) return;
    const capturedOwner = armedState.owner;
    setArmedState(null);
    onAction("delete", capturedOwner);
  };

  return (
    <div
      aria-label="Thread selection actions"
      className="agent-selection-bar"
      onKeyDown={onKeyDown}
      role="group"
    >
      <span className="agent-selection-bar__count">{`${threadCountLabel(count)} selected`}</span>
      {archivedCount < count && (
        <button
          className="agent-selection-bar__action"
          onClick={archive}
          title="Archive the selected threads"
          type="button"
        >
          <Archive aria-hidden="true" size={14} />
          Archive
        </button>
      )}
      {archivedCount > 0 && (
        <button
          className="agent-selection-bar__action"
          onClick={unarchive}
          title="Unarchive the selected archived threads"
          type="button"
        >
          <ArchiveRestore aria-hidden="true" size={14} />
          Unarchive
        </button>
      )}
      <button
        className={deleteClassName(armed)}
        data-armed={armed ? "true" : undefined}
        onClick={remove}
        title="Delete the selected threads"
        type="button"
      >
        <Trash2 aria-hidden="true" size={14} />
        {armed ? agentThreadBulkConfirmLabel("delete", count) : "Delete"}
      </button>
      <button
        aria-label="Clear selection"
        className="agent-selection-bar__clear"
        onClick={onClear}
        title="Clear selection"
        type="button"
      >
        <X aria-hidden="true" size={14} />
      </button>
    </div>
  );
}

function sameIds(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
}

function deleteClassName(armed: boolean): string {
  if (armed) {
    return "agent-selection-bar__action agent-selection-bar__action--danger agent-selection-bar__action--armed";
  }
  return "agent-selection-bar__action agent-selection-bar__action--danger";
}
