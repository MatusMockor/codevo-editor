import { useContext } from "react";
import { CircleDashed } from "lucide-react";
import { AGENT_ROW_WORKING_ICON_SIZE, AgentThreadRowRuntimeBadge } from "./AgentThreadRowParts";
import { AgentRowServerNamesContext } from "./agentRowServerNamesContext";
import { agentRowClassName } from "./agentSidebarPresentation";
import {
  AGENT_RAIL_STARTING_STATUS_LABEL,
  agentRailStartingRowLabel,
  agentRailStartingRowRuntime,
} from "./agentRailStartingRows";
import type { AgentStartingThread } from "./agentStartingThreads";

export interface AgentRailStartingRowProps {
  readonly thread: AgentStartingThread;
}

export function AgentRailStartingRow({ thread }: AgentRailStartingRowProps) {
  const serverNames = useContext(AgentRowServerNamesContext);
  const label = agentRailStartingRowLabel(thread);
  const rowClass = agentRowClassName({
    grouped: true,
    on: thread.current,
    marked: false,
    recede: !thread.current,
    status: { kind: "working", startedAtEpochMs: thread.sentAtEpochMs },
    unread: false,
  });
  return (
    <li className="cv-sb-item" role="none">
      <div
        aria-busy="true"
        aria-current={thread.current ? "true" : undefined}
        aria-disabled="true"
        aria-label={label}
        aria-selected={false}
        className={`${rowClass} is-starting`}
        data-starting-thread={thread.key}
        role="option"
        title={label}
      >
        <span className="cv-card-row__head">
          <span className="cv-card-row__title">{thread.title}</span>
          <span className="cv-card-row__slot">
            <span className="cv-card-row__status" data-tone="work">
              <CircleDashed aria-hidden="true" size={AGENT_ROW_WORKING_ICON_SIZE} />
              <span className="cv-card-row__status-label">{AGENT_RAIL_STARTING_STATUS_LABEL}</span>
            </span>
          </span>
        </span>
        <span className="cv-card-row__l3">
          <AgentThreadRowRuntimeBadge runtime={agentRailStartingRowRuntime(thread, serverNames)} />
        </span>
      </div>
    </li>
  );
}
