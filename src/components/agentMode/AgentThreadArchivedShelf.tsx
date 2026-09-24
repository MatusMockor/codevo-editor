import { ChevronDown, Plus } from "lucide-react";
import type { ReactNode } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentRailSections } from "./agentSidebarPresentation";

export const ARCHIVED_SHELF_ID = "agent-rail-archived";

export interface AgentThreadArchivedShelfProps {
  readonly sections: AgentRailSections;
  readonly expanded: boolean;
  renderRows(rows: ReadonlyArray<AgentThreadView>): ReactNode;
  onToggle(): void;
  onShowMore(): void;
}

export function AgentThreadArchivedShelf({
  expanded,
  onShowMore,
  onToggle,
  renderRows,
  sections,
}: AgentThreadArchivedShelfProps) {
  const total = sections.archived.length + sections.hiddenArchivedCount;
  if (total === 0) return null;
  return (
    <>
      <li className="cv-sb-shelf-slot" role="none">
        <button
          aria-controls={expanded ? ARCHIVED_SHELF_ID : undefined}
          aria-expanded={expanded}
          className="cv-sb-shelf"
          data-shelf="archived"
          onClick={onToggle}
          type="button"
        >
          {`Archived (${total})`}
          <span aria-hidden="true" className="cv-sb-shelf__rule" />
          <ChevronDown aria-hidden="true" className="cv-sb-shelf__chevron" size={12} />
        </button>
      </li>
      {expanded && (
        <li className="cv-sb-shelf-body" id={ARCHIVED_SHELF_ID} role="none">
          <ul aria-label="Archived threads" className="agent-list" role="group">
            {renderRows(sections.archived)}
            {sections.hiddenArchivedCount > 0 && (
              <li role="none">
                <button
                  className="agent-row agent-row--slim agent-row--more"
                  onClick={onShowMore}
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
    </>
  );
}
