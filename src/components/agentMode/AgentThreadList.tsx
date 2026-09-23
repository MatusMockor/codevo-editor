import type { AgentThreadView } from "../../application/agentThreadPorts";
import { memo } from "react";
import { useAgentThreadDrag } from "./useAgentThreadDrag";
import { ChevronDown, Plus } from "lucide-react";
import type { AgentTurnLogEvidenceLookup } from "../../domain/agentTurnContentLoss";
import type { ListSelectionModifiers } from "../../domain/listSelection";
import { AgentThreadRow } from "./AgentThreadRow";
import {
  agentRowProjectLabel,
  type AgentRailEmptyState,
  type AgentRailSections,
  type AgentThreadMenuCommand,
} from "./agentSidebarPresentation";

export interface AgentThreadListProps {
  readonly sections: AgentRailSections;
  readonly projectLabels: ReadonlyMap<string, string>;
  readonly selectedThreadId: string | null;
  readonly markedThreadIds: ReadonlySet<string>;
  readonly focusedThreadId: string | null;
  readonly jumpLabels: ReadonlyMap<string, string>;
  readonly archivedExpanded: boolean;
  readonly empty: AgentRailEmptyState;
  readonly evidenceOf?: AgentTurnLogEvidenceLookup;
  onToggleArchived(): void;
  onShowMoreArchived(): void;
  onSelectThread(threadId: string, modifiers: ListSelectionModifiers): void;
  onTogglePin(threadId: string): void;
  onThreadMenuCommand(threadId: string, command: AgentThreadMenuCommand): void;
}

export const AgentThreadList = memo(function AgentThreadList({
  archivedExpanded,
  empty,
  evidenceOf,
  focusedThreadId,
  jumpLabels,
  markedThreadIds,
  onSelectThread,
  onShowMoreArchived,
  onThreadMenuCommand,
  onToggleArchived,
  onTogglePin,
  projectLabels,
  sections,
  selectedThreadId,
}: AgentThreadListProps) {
  const drag = useAgentThreadDrag(sections, onThreadMenuCommand);
  const archivedTotal = sections.archived.length + sections.hiddenArchivedCount;
  const renderRows = (rows: typeof sections.active) => {
    const neighbors = threadNeighbors(rows);
    return rows.map((view) => {
      const threadId = view.thread.threadId;
      const adjacent = neighbors.get(threadId);
      return (
        <AgentThreadRow
          moveUpId={view.thread.archived ? undefined : adjacent?.before}
          moveDownId={view.thread.archived ? undefined : adjacent?.after}
          reorderable={!view.thread.archived}
          evidenceOf={evidenceOf}
          focused={focusedThreadId === threadId}
          jumpLabel={jumpLabels.get(threadId) ?? null}
          key={threadId}
          on={selectedThreadId === threadId}
          onMenuCommand={onThreadMenuCommand}
          onSelect={onSelectThread}
          onTogglePin={onTogglePin}
          projectLabel={agentRowProjectLabel(projectLabels, view)}
          selected={markedThreadIds.has(threadId)}
          view={view}
        />
      );
    });
  };

  if (empty !== null) return <EmptyState state={empty} />;

  return (
    <ul
      aria-label="Thread list"
      aria-multiselectable="true"
      className="agent-list"
      role="listbox"
      {...drag.handlers}
    >
      {drag.marker("pinned", "Pins")}
      {renderRows(sections.pinned)}
      {drag.marker("active", "Active")}
      {renderRows(sections.active)}
      {(sections.snoozed?.length ?? 0) > 0 && (
        <>
          <li className="agent-shelf-slot" role="none">
            <span className="agent-shelf">Snoozed ({sections.snoozed!.length})</span>
          </li>
          {renderRows(sections.snoozed!)}
        </>
      )}
      {drag.marker(
        "settled",
        (sections.settled?.length ?? 0) > 0 ? `Settled (${sections.settled!.length})` : "Settled",
      )}
      {renderRows(sections.settled ?? [])}
      {archivedTotal > 0 && (
        <li className="agent-shelf-slot" role="none">
          <button
            aria-controls={archivedExpanded ? "agent-rail-archived" : undefined}
            aria-expanded={archivedExpanded}
            className="agent-shelf"
            onClick={onToggleArchived}
            type="button"
          >
            {`Archived (${archivedTotal})`}
            <span aria-hidden="true" className="agent-shelf__rule" />
            <ChevronDown aria-hidden="true" size={12} />
          </button>
        </li>
      )}
      {archivedExpanded && (
        <li className="agent-shelf-body" id="agent-rail-archived" role="none">
          <ul aria-label="Archived threads" className="agent-list" role="group">
            {renderRows(sections.archived)}
            {sections.hiddenArchivedCount > 0 && (
              <li role="none">
                <button
                  className="agent-row agent-row--slim agent-row--more"
                  onClick={onShowMoreArchived}
                  type="button"
                >
                  <Plus aria-hidden="true" size={16} />
                  Show {sections.hiddenArchivedCount} more
                </button>
              </li>
            )}
          </ul>
        </li>
      )}
    </ul>
  );
});

function EmptyState({ state }: { readonly state: NonNullable<AgentRailEmptyState> }) {
  if (state.kind === "noProjects") {
    return <div className="agent-rail__empty-state">No projects yet</div>;
  }
  if (state.kind === "noScope") {
    return <div className="agent-rail__empty-state">No project selected</div>;
  }
  return <div className="agent-rail__empty-state">{`No threads in ${state.scopeLabel} yet`}</div>;
}

function threadNeighbors(
  rows: ReadonlyArray<AgentThreadView>,
): ReadonlyMap<string, { before?: string; after?: string }> {
  const result = new Map<string, { before?: string; after?: string }>();
  const previous = new Map<string, string>();
  for (const view of rows) {
    const owner = view.thread.owner;
    const key = JSON.stringify([
      owner.rootKey,
      owner.ownerId,
      owner.repositoryRoot,
      view.execution?.kind === "remote" ? view.execution.serverId : null,
    ]);
    const before = previous.get(key);
    result.set(view.thread.threadId, { before });
    if (before !== undefined) result.get(before)!.after = view.thread.threadId;
    previous.set(key, view.thread.threadId);
  }
  return result;
}
