import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { StatusBarItemVisibility } from "../../domain/settings";
import { AgentStatusBarMenu, type AgentStatusBarMenuPosition } from "./AgentStatusBarMenu";
import { displayBaseName } from "../../domain/windowTitle";

export interface AgentStatusBarProps {
  readonly liveTaskCount: number;
  readonly maxConcurrentAgentTasks: number;
  readonly workspaceRoot: string | null;
  readonly attentionCount?: number;
  readonly attentionExplanation?: string;
  readonly statusBar?: StatusBarItemVisibility;
  readonly onChangeVisibility?: (key: keyof StatusBarItemVisibility, visible: boolean) => void;
  readonly launchLabel?: string | null;
  readonly cliVersionLabel?: string | null;
}

export function AgentStatusBar({
  attentionCount = 0,
  attentionExplanation = "Previous runs ended with an error, were stopped, or were interrupted. Open the threads to see what happened. Reading a thread does not clear its run status. Right-click the status bar to hide this indicator.",
  statusBar,
  onChangeVisibility,
  cliVersionLabel = null,
  launchLabel = null,
  liveTaskCount,
  maxConcurrentAgentTasks,
  workspaceRoot,
}: AgentStatusBarProps) {
  const footer = useRef<HTMLElement>(null);
  const [menu, setMenu] = useState<
    (AgentStatusBarMenuPosition & { readonly root: string | null }) | null
  >(null);
  const closeMenu = useCallback((restoreFocus: boolean) => {
    setMenu(null);
    if (restoreFocus) footer.current?.focus();
  }, []);
  useLayoutEffect(() => setMenu(null), [workspaceRoot]);
  const attentionVisible = statusBar?.agentAttention ?? true;
  const live = liveTaskCount > 0;
  const dotClassName = live ? "status-agent-dot status-agent-dot--live" : "status-agent-dot";
  const slotsLabel = live
    ? `${liveTaskCount}/${maxConcurrentAgentTasks} agents running`
    : `Agents idle · ${maxConcurrentAgentTasks} slots`;

  return (
    <footer
      className="status-bar status-bar--agent"
      aria-label="Agent status bar"
      ref={footer}
      tabIndex={0}
      onContextMenu={(event) => {
        if (onChangeVisibility === undefined) return;
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY, root: workspaceRoot });
      }}
      onKeyDown={(event) => {
        if (onChangeVisibility === undefined) return;
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        setMenu({ x: rect.left + 8, y: rect.top, root: workspaceRoot });
      }}
    >
      <span className="status-agent-slots agent-num">
        <span aria-hidden="true" className={dotClassName} />
        {slotsLabel}
      </span>
      {attentionVisible && attentionCount > 0 ? (
        <span
          className="status-agent-attention"
          title={attentionExplanation}
          aria-label={`${attentionLabel(attentionCount)}. ${attentionExplanation}`}
        >
          {attentionLabel(attentionCount)}
        </span>
      ) : null}
      {launchLabel === null ? null : <span className="status-agent-launch">{launchLabel}</span>}
      {cliVersionLabel === null ? null : (
        <span className="status-agent-cli" title="Agent CLI version">
          {cliVersionLabel}
        </span>
      )}
      {workspaceRoot ? <span>{displayBaseName(workspaceRoot)}</span> : null}
      {menu !== null && menu.root === workspaceRoot && onChangeVisibility !== undefined ? (
        <AgentStatusBarMenu
          position={menu}
          visible={attentionVisible}
          disabled={workspaceRoot === null}
          onClose={closeMenu}
          onToggle={() => onChangeVisibility("agentAttention", !attentionVisible)}
        />
      ) : null}
    </footer>
  );
}

function attentionLabel(count: number): string {
  const verb = count === 1 ? "needs" : "need";
  return `${count} ${verb} attention`;
}
