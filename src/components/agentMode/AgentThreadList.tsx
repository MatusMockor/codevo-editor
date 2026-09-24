import type { AgentThreadView } from "../../application/agentThreadPorts";
import { memo } from "react";
import { useAgentThreadDrag } from "./useAgentThreadDrag";
import { ChevronDown } from "lucide-react";
import type { AgentTurnLogEvidenceLookup } from "../../domain/agentTurnContentLoss";
import type { ListSelectionModifiers } from "../../domain/listSelection";
import type { AgentPendingInteraction } from "../../domain/agentPendingInteraction";
import type { AgentThreadDropSection } from "../../domain/agentThreadOrganization";
import { AgentThreadArchivedShelf } from "./AgentThreadArchivedShelf";
import { AgentThreadRow } from "./AgentThreadRow";
import {
  agentRowProjectLabel,
  type AgentRailEmptyState,
  type AgentRailSections,
  type AgentThreadMenuCommand,
} from "./agentSidebarPresentation";

const NO_PENDING_INTERACTIONS: ReadonlyMap<string, AgentPendingInteraction> = new Map();

export interface AgentThreadListProps {
  readonly sections: AgentRailSections;
  readonly projectLabels: ReadonlyMap<string, string>;
  readonly selectedThreadId: string | null;
  readonly markedThreadIds: ReadonlySet<string>;
  readonly focusedThreadId: string | null;
  readonly jumpLabels: ReadonlyMap<string, string>;
  readonly archivedExpanded: boolean;
  readonly settledExpanded: boolean;
  readonly snoozedExpanded: boolean;
  readonly empty: AgentRailEmptyState;
  readonly evidenceOf?: AgentTurnLogEvidenceLookup;
  readonly pendingInteractions?: ReadonlyMap<string, AgentPendingInteraction>;
  onToggleArchived(): void;
  onToggleSettled(): void;
  onToggleSnoozed(): void;
  onShowMoreArchived(): void;
  onSelectThread(threadId: string, modifiers: ListSelectionModifiers): void;
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
  onToggleSettled,
  onToggleSnoozed,
  pendingInteractions = NO_PENDING_INTERACTIONS,
  projectLabels,
  sections,
  selectedThreadId,
  settledExpanded,
  snoozedExpanded,
}: AgentThreadListProps) {
  const drag = useAgentThreadDrag(sections, onThreadMenuCommand);
  const renderRows = (rows: ReadonlyArray<AgentThreadView>) => {
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
          pending={pendingInteractions.get(threadId) ?? null}
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
        <Shelf
          count={sections.snoozed?.length ?? 0}
          expanded={snoozedExpanded}
          label="Snoozed"
          onToggle={onToggleSnoozed}
        />
      )}
      {snoozedExpanded && renderRows(sections.snoozed ?? [])}
      <Shelf
        count={sections.settled?.length ?? 0}
        dropSection="settled"
        expanded={settledExpanded}
        label="Settled"
        onToggle={onToggleSettled}
      />
      {settledExpanded && renderRows(sections.settled ?? [])}
      <AgentThreadArchivedShelf
        expanded={archivedExpanded}
        onShowMore={onShowMoreArchived}
        onToggle={onToggleArchived}
        renderRows={renderRows}
        sections={sections}
      />
    </ul>
  );
});

function Shelf({
  count,
  dropSection,
  expanded,
  label,
  onToggle,
}: {
  readonly count: number;
  readonly dropSection?: AgentThreadDropSection;
  readonly expanded: boolean;
  readonly label: string;
  onToggle(): void;
}) {
  return (
    <li className="cv-sb-shelf-slot" data-thread-drop-section={dropSection} role="none">
      <button
        aria-expanded={expanded}
        className="cv-sb-shelf"
        data-shelf={label.toLowerCase()}
        onClick={onToggle}
        type="button"
      >
        {count > 0 ? `${label} (${count})` : label}
        <span aria-hidden="true" className="cv-sb-shelf__rule" />
        <ChevronDown aria-hidden="true" className="cv-sb-shelf__chevron" size={12} />
      </button>
    </li>
  );
}

function EmptyState({ state }: { readonly state: NonNullable<AgentRailEmptyState> }) {
  if (state.kind === "noProjects") return <div className="cv-sb-empty">No projects yet</div>;
  if (state.scopeLabel === null) return <div className="cv-sb-empty">No threads yet</div>;
  return <div className="cv-sb-empty">{`No threads in ${state.scopeLabel} yet`}</div>;
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
