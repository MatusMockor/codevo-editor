import { displayBaseName } from "../../domain/windowTitle";

export interface AgentStatusBarProps {
  readonly liveTaskCount: number;
  readonly maxConcurrentAgentTasks: number;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
}

export function AgentStatusBar({
  liveTaskCount,
  maxConcurrentAgentTasks,
  workspaceRoot,
  workspaceTrusted,
}: AgentStatusBarProps) {
  const live = liveTaskCount > 0;
  const dotClassName = live ? "status-agent-dot status-agent-dot--live" : "status-agent-dot";
  const slotsLabel = live
    ? `${liveTaskCount}/${maxConcurrentAgentTasks} agents running`
    : `Agents idle · ${maxConcurrentAgentTasks} slots`;

  return (
    <footer className="status-bar status-bar--agent">
      <span className="status-agent-slots agent-num">
        <span aria-hidden="true" className={dotClassName} />
        {slotsLabel}
      </span>
      {workspaceRoot ? <span>{displayBaseName(workspaceRoot)}</span> : null}
      {workspaceRoot ? <span>{workspaceTrusted ? "Trusted" : "Untrusted"}</span> : null}
    </footer>
  );
}
