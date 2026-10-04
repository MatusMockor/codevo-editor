import type { AgentThreadView } from "../../application/agentThreadPorts";
import { memo } from "react";
import { useAgentThreadDrag } from "./useAgentThreadDrag";
import { ChevronDown } from "lucide-react";
import type { AgentTurnLogEvidenceLookup } from "../../domain/agentTurnContentLoss";
import type { ListSelectionModifiers } from "../../domain/listSelection";
import type { AgentPendingInteraction } from "../../domain/agentPendingInteraction";
import type { AgentThreadDropSection } from "../../domain/agentThreadOrganization";
import { AgentThreadRow } from "./AgentThreadRow";
import { AgentRailProjectGroup, type AgentRailProjectGroupActions } from "./AgentRailProjectGroup";
import type { AgentRailProjectSection } from "./agentRailProjectLayout";
import { NO_AGENT_RAIL_WORKING_SHELF, type AgentRailWorkingShelf } from "./agentRailWorkingSection";
import {
  agentRowProjectLabel,
  type AgentRailEmptyState,
  type AgentRailSections,
  type AgentThreadMenuCommand,
} from "./agentSidebarPresentation";

const NO_PENDING_INTERACTIONS: ReadonlyMap<string, AgentPendingInteraction> = new Map();
const NO_REPOSITORY_LABELS: ReadonlyMap<string, string> = new Map();
const PINNED_HEADING_ID = "agent-rail-pinned-heading";
const NO_REORDER_NEIGHBORS: ReadonlyArray<AgentThreadView> = [];
const NO_WORKING_TOGGLE = (): void => undefined;

export interface AgentThreadListProps {
  readonly sections: AgentRailSections;
  readonly projects: ReadonlyArray<AgentRailProjectSection>;
  readonly currentProjectRootKey: string | null;
  readonly projectActions: AgentRailProjectGroupActions;
  readonly projectLabels: ReadonlyMap<string, string>;
  readonly repositoryLabels?: ReadonlyMap<string, string>;
  readonly selectedThreadId: string | null;
  readonly markedThreadIds: ReadonlySet<string>;
  readonly focusedThreadId: string | null;
  readonly jumpLabels: ReadonlyMap<string, string>;
  readonly settledExpanded: boolean;
  readonly snoozedExpanded: boolean;
  readonly empty: AgentRailEmptyState;
  readonly evidenceOf?: AgentTurnLogEvidenceLookup;
  readonly pendingInteractions?: ReadonlyMap<string, AgentPendingInteraction>;
  readonly working?: AgentRailWorkingShelf;
  onToggleWorking?(): void;
  onToggleSettled(): void;
  onToggleSnoozed(): void;
  onSelectThread(threadId: string, modifiers: ListSelectionModifiers): void;
  onThreadMenuCommand(threadId: string, command: AgentThreadMenuCommand): void;
}

export const AgentThreadList = memo(function AgentThreadList({
  currentProjectRootKey,
  empty,
  evidenceOf,
  focusedThreadId,
  jumpLabels,
  markedThreadIds,
  onSelectThread,
  onThreadMenuCommand,
  onToggleSettled,
  onToggleSnoozed,
  onToggleWorking = NO_WORKING_TOGGLE,
  pendingInteractions = NO_PENDING_INTERACTIONS,
  projectActions,
  projectLabels,
  projects,
  repositoryLabels = NO_REPOSITORY_LABELS,
  sections,
  selectedThreadId,
  settledExpanded,
  snoozedExpanded,
  working = NO_AGENT_RAIL_WORKING_SHELF,
}: AgentThreadListProps) {
  const drag = useAgentThreadDrag(sections, onThreadMenuCommand, working.threads);
  const renderRows = (
    rows: ReadonlyArray<AgentThreadView>,
    grouped = false,
    order: ReadonlyArray<AgentThreadView> = rows,
  ) => {
    const neighbors = threadNeighbors(order);
    return rows.map((view) => {
      const threadId = view.thread.threadId;
      const adjacent = neighbors.get(threadId);
      return (
        <AgentThreadRow
          moveUpId={adjacent?.before}
          moveDownId={adjacent?.after}
          reorderable
          evidenceOf={evidenceOf}
          focused={focusedThreadId === threadId}
          grouped={grouped}
          repositoryLabel={repositoryLabels.get(view.thread.owner.repositoryRoot) ?? null}
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
      {sections.pinned.length > 0 && (
        <li className="cv-sb-heading" id={PINNED_HEADING_ID} role="none">
          Pinned
        </li>
      )}
      {drag.marker("pinned", "Pins")}
      {sections.pinned.length > 0 && (
        <li className="cv-sb-pinned" role="none">
          <ul aria-labelledby={PINNED_HEADING_ID} className="cv-sb-pinned__rows" role="group">
            {renderRows(sections.pinned)}
          </ul>
        </li>
      )}
      <li className="cv-sb-heading" role="none">
        Projects
      </li>
      {drag.marker("active", "Active")}
      {projects.map((project) => (
        <AgentRailProjectGroup
          actions={projectActions}
          current={project.entry.projectRootKey === currentProjectRootKey}
          key={project.entry.projectRootKey}
          pendingInteractions={pendingInteractions}
          project={project}
        >
          {renderRows(project.rows, true, project.threads)}
        </AgentRailProjectGroup>
      ))}
      {working.threads.length > 0 && (
        <Shelf
          count={working.threads.length}
          expanded={working.disclosure === "expanded"}
          label="Working"
          onToggle={onToggleWorking}
        />
      )}
      {renderRows(working.rows, false, NO_REORDER_NEIGHBORS)}
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
  switch (state.kind) {
    case "noProjects":
      return <div className="cv-sb-empty">No projects yet</div>;
    default:
      return unsupportedEmptyState(state.kind);
  }
}

function unsupportedEmptyState(kind: never): never {
  throw new TypeError(`Unsupported rail empty state: ${String(kind)}`);
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
