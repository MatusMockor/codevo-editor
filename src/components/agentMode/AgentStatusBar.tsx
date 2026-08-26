import { displayBaseName } from "../../domain/windowTitle";

export interface AgentStatusBarProps {
  readonly liveTaskCount: number;
  readonly maxConcurrentAgentTasks: number;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
  readonly attentionCount?: number;
  readonly launchLabel?: string | null;
  readonly cliVersionLabel?: string | null;
}

export function AgentStatusBar({
  attentionCount = 0,
  cliVersionLabel = null,
  launchLabel = null,
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
      {attentionCount > 0 ? (
        <span className="status-agent-attention">{attentionLabel(attentionCount)}</span>
      ) : null}
      {launchLabel === null ? null : <span className="status-agent-launch">{launchLabel}</span>}
      {cliVersionLabel === null ? null : (
        <span className="status-agent-cli" title="Agent CLI version">
          {cliVersionLabel}
        </span>
      )}
      {workspaceRoot ? <span>{displayBaseName(workspaceRoot)}</span> : null}
      {workspaceRoot ? <span>{workspaceTrusted ? "Trusted" : "Untrusted"}</span> : null}
    </footer>
  );
}

function attentionLabel(count: number): string {
  const verb = count === 1 ? "needs" : "need";
  return `${count} ${verb} attention`;
}
