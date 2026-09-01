import { memo } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { AgentThreadRow } from "./AgentThreadRow";
import {
  type AgentRailEmptyState,
  type AgentRailSections,
  type AgentThreadMenuCommand,
} from "./agentSidebarPresentation";

export interface AgentThreadListProps {
  readonly sections: AgentRailSections;
  readonly projectLabels: ReadonlyMap<string, string>;
  readonly selectedThreadId: string | null;
  readonly focusedThreadId: string | null;
  readonly jumpLabels: ReadonlyMap<string, string>;
  readonly archivedExpanded: boolean;
  readonly empty: AgentRailEmptyState;
  onToggleArchived(): void;
  onShowMoreArchived(): void;
  onSelectThread(threadId: string): void;
  onTogglePin(threadId: string): void;
  onThreadMenuCommand(threadId: string, command: AgentThreadMenuCommand): void;
  onImportTerminalSession?(): void;
}

export const AgentThreadList = memo(function AgentThreadList({
  archivedExpanded,
  empty,
  focusedThreadId,
  jumpLabels,
  onImportTerminalSession,
  onSelectThread,
  onShowMoreArchived,
  onThreadMenuCommand,
  onToggleArchived,
  onTogglePin,
  projectLabels,
  sections,
  selectedThreadId,
}: AgentThreadListProps) {
  const archivedTotal = sections.archived.length + sections.hiddenArchivedCount;
  const renderRow = (view: (typeof sections.active)[number]) => {
    const threadId = view.thread.threadId;
    return (
      <AgentThreadRow
        focused={focusedThreadId === threadId}
        jumpLabel={jumpLabels.get(threadId) ?? null}
        key={threadId}
        on={selectedThreadId === threadId}
        onMenuCommand={onThreadMenuCommand}
        onSelect={onSelectThread}
        onTogglePin={onTogglePin}
        projectLabel={projectLabels.get(view.thread.owner.repositoryRoot) ?? view.repositoryLabel}
        view={view}
      />
    );
  };

  if (empty !== null) {
    return <EmptyState onImportTerminalSession={onImportTerminalSession} state={empty} />;
  }

  return (
    <ul aria-label="Thread list" className="agent-list" role="list">
      {sections.pinned.map(renderRow)}
      {sections.pinned.length > 0 && <li aria-hidden="true" className="agent-list__divider" />}
      {sections.active.map(renderRow)}
      {archivedTotal > 0 && (
        <li className="agent-shelf-slot">
          <button
            aria-controls={archivedExpanded ? "agent-rail-archived" : undefined}
            aria-expanded={archivedExpanded}
            className="agent-shelf"
            onClick={onToggleArchived}
            type="button"
          >
            {archivedExpanded ? "Archived" : `Archived (${archivedTotal})`}
            <span aria-hidden="true" className="agent-shelf__rule" />
            <ChevronDown aria-hidden="true" size={12} />
          </button>
        </li>
      )}
      {archivedExpanded && (
        <li className="agent-shelf-body" id="agent-rail-archived">
          <ul aria-label="Archived threads" className="agent-list" role="list">
            {sections.archived.map(renderRow)}
            {sections.hiddenArchivedCount > 0 && (
              <li>
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

function EmptyState({
  onImportTerminalSession,
  state,
}: {
  onImportTerminalSession?(): void;
  readonly state: NonNullable<AgentRailEmptyState>;
}) {
  if (state.kind === "noProjects") {
    return <div className="agent-rail__empty-state">No projects yet</div>;
  }
  const label =
    state.scopeLabel === null ? "No threads yet" : `No threads in ${state.scopeLabel} yet`;
  return (
    <div className="agent-rail__empty-state">
      {label}
      {onImportTerminalSession !== undefined && (
        <button
          className="agent-linkbutton agent-rail__empty-import"
          onClick={onImportTerminalSession}
          type="button"
        >
          Import a terminal session…
        </button>
      )}
    </div>
  );
}
