import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ChevronRight, Ellipsis, SquarePen } from "lucide-react";
import type { AgentPendingInteraction } from "../../domain/agentPendingInteraction";
import { IconButton } from "../../ui/foundation/IconButton";
import { Menu } from "../../ui/foundation/Menu";
import { MenuItem } from "../../ui/foundation/MenuItem";
import { agentProjectMonogram } from "./agentProjectMonogram";
import {
  agentProjectMenuEntries,
  agentProjectMenuTarget,
  agentProjectRepositoryCountLabel,
  agentProjectUsable,
  agentRailProjectState,
  type AgentProjectMenuCommand,
  type AgentProjectMenuTarget,
} from "./agentProjectMenuPresentation";
import { agentRailProjectSignal, type AgentRailProjectSignal } from "./agentRailProjectSignal";
import type { AgentRailProjectSection } from "./agentRailProjectLayout";
import { agentRailProjectEmptyLabel } from "./agentRailWorkingSection";
import { AgentRailStartingRow } from "./AgentRailStartingRow";
import { NO_AGENT_STARTING_THREADS, type AgentStartingThread } from "./agentStartingThreads";

export interface AgentRailProjectGroupActions {
  onToggleCollapsed(projectRootKey: string): void;
  onActivate(projectRootKey: string): void;
  onToggleShowingAll(projectRootKey: string): void;
  onNewThread(projectRootKey: string): void;
  onProjectCommand(target: AgentProjectMenuTarget, command: AgentProjectMenuCommand): void;
}

export interface AgentRailProjectGroupProps {
  readonly project: AgentRailProjectSection;
  readonly current: boolean;
  readonly actions: AgentRailProjectGroupActions;
  readonly pendingInteractions: ReadonlyMap<string, AgentPendingInteraction>;
  readonly starting?: ReadonlyArray<AgentStartingThread>;
  readonly children: ReactNode;
}

export function AgentRailProjectGroup({
  actions,
  children,
  current,
  pendingInteractions,
  project,
  starting = NO_AGENT_STARTING_THREADS,
}: AgentRailProjectGroupProps) {
  const { collapsed, entry, overflow } = project;
  const startingRows = collapsed ? NO_AGENT_STARTING_THREADS : starting;
  const key = entry.projectRootKey;
  const label = entry.label;
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const state = agentRailProjectState(entry);
  const repositories = agentProjectRepositoryCountLabel(entry);
  const signal = collapsed
    ? agentRailProjectSignal(project.threads, pendingInteractions, project.working)
    : null;
  const usable = agentProjectUsable(entry);
  const openMenu = (event: MouseEvent): void => {
    event.preventDefault();
    setMenuOpen(true);
  };

  return (
    <li
      className="cv-sb-project"
      data-current={current ? "true" : undefined}
      data-project-root-key={key}
      role="none"
    >
      <div
        className="cv-sb-project__head"
        data-menu-open={menuOpen ? "true" : undefined}
        ref={anchorRef}
      >
        <button
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${label}`}
          className="cv-sb-project__toggle"
          onClick={() => actions.onToggleCollapsed(key)}
          onContextMenu={openMenu}
          type="button"
        >
          <ChevronRight aria-hidden="true" className="cv-sb-project__chevron" size={12} />
        </button>
        <button
          aria-current={current ? "true" : undefined}
          className="cv-sb-project__select"
          onClick={() => actions.onActivate(key)}
          onContextMenu={openMenu}
          title={entry.rootPath ?? label}
          type="button"
        >
          <span aria-hidden="true" className="cv-favicon">
            {agentProjectMonogram(label)}
          </span>
          <span className="cv-sb-project__name">{label}</span>
          {repositories !== null && <span className="cv-sb-project__meta">{repositories}</span>}
          {state !== null && <span className="cv-sb-project__state">{state}</span>}
          {signal !== null && <ProjectSignal signal={signal} />}
        </button>
        <span className="cv-sb-project__actions">
          <IconButton
            className="cv-sb-project__action"
            disabled={!usable}
            icon={<SquarePen size={14} />}
            label={`Create new thread in ${label}`}
            onClick={() => actions.onNewThread(key)}
            size="xs"
          />
          <IconButton
            className="cv-sb-project__action"
            icon={<Ellipsis size={14} />}
            label={`Project actions for ${label}`}
            onClick={openMenu}
            size="xs"
          />
        </span>
      </div>
      <Menu
        anchorRef={anchorRef}
        label={`Project actions for ${label}`}
        onClose={() => setMenuOpen(false)}
        open={menuOpen}
        placement="bottom-end"
      >
        {agentProjectMenuEntries(entry).map((item) => (
          <MenuItem
            disabled={item.disabled}
            key={item.id}
            onSelect={() => actions.onProjectCommand(agentProjectMenuTarget(entry), item.command)}
          >
            {item.label}
          </MenuItem>
        ))}
      </Menu>
      {(!collapsed || project.rows.length > 0) && (
        <ul aria-label={`${label} threads`} className="cv-sb-project__threads" role="group">
          {startingRows.map((thread) => (
            <AgentRailStartingRow key={thread.key} thread={thread} />
          ))}
          {children}
          {!collapsed && project.threads.length === 0 && startingRows.length === 0 && (
            <li className="cv-sb-project__empty" role="none">
              {agentRailProjectEmptyLabel(project.working, project.shelved)}
            </li>
          )}
          {!collapsed && overflow.kind !== "none" && (
            <li className="cv-sb-project__more-slot" role="none">
              <button
                aria-label={
                  overflow.kind === "more"
                    ? `Show ${overflow.hidden} more threads in ${label}`
                    : `Show fewer threads in ${label}`
                }
                className="cv-sb-project__more"
                onClick={() => actions.onToggleShowingAll(key)}
                type="button"
              >
                {overflow.kind === "more" ? `Show ${overflow.hidden} more` : "Show less"}
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function ProjectSignal({ signal }: { readonly signal: AgentRailProjectSignal }) {
  return (
    <span
      aria-label={signal.label}
      className="cv-sb-project__signal"
      data-tone={signal.tone}
      role="img"
      title={signal.label}
    />
  );
}
