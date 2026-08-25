import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { ChevronDown, Folder } from "lucide-react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentThreadScriptsSurface } from "../../application/useAgentThreadScripts";
import type { AgentSurfaceKind, AgentWorkbenchLayout } from "../../domain/agentWorkbenchLayout";
import { runningTurn } from "../../domain/agentThread";
import { AgentCommitMenu } from "./AgentCommitMenu";
import {
  agentShipBranchLabel,
  agentThreadDisplayTitle,
  agentThreadLifecycleLabel,
  agentThreadTone,
  lastAgentTurnStatus,
} from "./agentModePresentation";
import { AgentOpenMenu } from "./AgentOpenMenu";
import { AgentPanelLayoutControls } from "./AgentPanelLayoutControls";
import { AgentScriptRunControl } from "./AgentScriptRunControl";
import type { AgentShipActions } from "./AgentShipPanel";
import type { AgentThreadMenuCommand } from "./agentSidebarPresentation";
import { AgentThreadRowMenu } from "./AgentThreadRowMenu";
import { RenameInput } from "./AgentThreadRowParts";
import type { AgentPanelLayoutShortcuts } from "./agentThreadHeaderPresentation";

export interface AgentThreadHeaderProject {
  readonly projectRootKey: string;
  readonly repositoryRoot: string;
  readonly label: string;
}

export interface AgentThreadHeaderProps {
  readonly thread: AgentThreadView | null;
  readonly project: AgentThreadHeaderProject | null;
  readonly layout: AgentWorkbenchLayout;
  readonly scripts: AgentThreadScriptsSurface;
  readonly shipActions: AgentShipActions;
  readonly shortcuts: AgentPanelLayoutShortcuts | null;
  readonly rightPanelDisabledReason: string | null;
  onNewThread(projectRootKey: string, repositoryRoot: string): void;
  onRenameThread(threadId: string, title: string): void;
  onThreadMenuCommand(threadId: string, command: AgentThreadMenuCommand): void;
  onOpenSurface(kind: AgentSurfaceKind): void;
  onToggleBottomPanel(): void;
  onToggleRightPanel(): void;
  onExpandEditor(): void;
  onOpenScriptsView: (() => void) | null;
  onRevealPath(path: string): Promise<void>;
  onRevealFailed(error: unknown): void;
}

interface MenuAnchor {
  readonly x: number;
  readonly y: number;
}

export function AgentThreadHeader(props: AgentThreadHeaderProps) {
  const { layout, onNewThread, onRenameThread, onThreadMenuCommand, project, thread } = props;
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [renaming, setRenaming] = useState(false);
  const titleRef = useRef<HTMLButtonElement | null>(null);
  const threadId = thread?.thread.threadId ?? null;
  const title = thread === null ? "New thread" : agentThreadDisplayTitle(thread.thread);
  const projectLabel = project?.label ?? thread?.repositoryLabel ?? null;

  useEffect(() => {
    setMenuAnchor(null);
    setRenaming(false);
  }, [threadId]);

  const closeMenu = useCallback(() => setMenuAnchor(null), []);

  const openMenuBelowTitle = (): void => {
    const rect = titleRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setMenuAnchor({ x: rect.left, y: rect.bottom + 4 });
  };

  const onContextMenu = (event: MouseEvent<HTMLElement>): void => {
    if (thread === null) return;
    event.preventDefault();
    setMenuAnchor({ x: event.clientX, y: event.clientY });
  };

  const commitRename = (next: string): void => {
    setRenaming(false);
    if (threadId === null) return;
    onRenameThread(threadId, next);
  };

  const startNewThread = (): void => {
    if (project === null) return;
    onNewThread(project.projectRootKey, project.repositoryRoot);
  };

  return (
    <header className="agent-thread-head" data-agent-thread-head>
      <nav aria-label="Thread breadcrumb" className="agent-crumbs" onContextMenu={onContextMenu}>
        <button
          aria-label={projectLabel === null ? "New thread" : `New thread in ${projectLabel}`}
          className="agent-crumbs__project"
          disabled={project === null}
          onClick={startNewThread}
          title={project?.repositoryRoot ?? undefined}
          type="button"
        >
          <Folder aria-hidden="true" size={14} />
          <span className="agent-crumbs__label">{projectLabel ?? "No project"}</span>
        </button>
        <span aria-hidden="true" className="agent-crumbs__sep">
          /
        </span>
        {thread !== null && renaming ? (
          <RenameInput
            initial={thread.thread.title}
            onCancel={() => setRenaming(false)}
            onCommit={commitRename}
          />
        ) : (
          <button
            aria-current="page"
            aria-expanded={menuAnchor !== null}
            aria-haspopup="menu"
            aria-label={`Thread actions for ${title}`}
            className="agent-crumbs__title"
            disabled={thread === null}
            onClick={openMenuBelowTitle}
            ref={titleRef}
            title={title}
            type="button"
          >
            <h2 className="agent-crumbs__heading">{title}</h2>
            <ChevronDown aria-hidden="true" className="agent-crumbs__chevron" size={14} />
          </button>
        )}
        {thread !== null && <ThreadStatus thread={thread} />}
      </nav>

      <div className="agent-thread-head__actions">
        {thread !== null && (
          <>
            <AgentScriptRunControl
              onOpenScriptsView={props.onOpenScriptsView}
              scripts={props.scripts}
            />
            <AgentOpenMenu
              onCopyPath={() =>
                onThreadMenuCommand(thread.thread.threadId, { kind: "copy", detail: "path" })
              }
              onOpenSurface={props.onOpenSurface}
              onRevealFailed={props.onRevealFailed}
              onRevealPath={props.onRevealPath}
              target={{
                path: thread.thread.target.worktreePath ?? thread.thread.owner.repositoryRoot,
                missing: thread.worktreeMissing,
              }}
            />
            <AgentCommitMenu actions={props.shipActions} thread={thread} />
          </>
        )}
        {layout.rightSurface === null && (
          <AgentPanelLayoutControls
            bottomPanelOpen={layout.bottomPanel}
            onExpandEditor={null}
            onToggleBottomPanel={props.onToggleBottomPanel}
            onToggleRightPanel={props.onToggleRightPanel}
            rightPanelDisabledReason={props.rightPanelDisabledReason}
            rightPanelOpen={false}
            shortcuts={props.shortcuts}
          />
        )}
      </div>

      {thread !== null && menuAnchor !== null && (
        <AgentThreadRowMenu
          archived={thread.thread.archived}
          branch={agentShipBranchLabel(thread.ship)}
          onClose={closeMenu}
          onCommand={(command) => onThreadMenuCommand(thread.thread.threadId, command)}
          onRename={() => setRenaming(true)}
          pinned={thread.thread.pinned}
          position={menuAnchor}
          running={runningTurn(thread.thread) !== null}
          threadId={thread.thread.threadId}
        />
      )}
    </header>
  );
}

function ThreadStatus({ thread }: { readonly thread: AgentThreadView }) {
  const tone = agentThreadTone(thread.lifecycle, lastAgentTurnStatus(thread.thread));
  return (
    <span className={`agent-thread-head__status agent-thread-head__status--${tone}`}>
      <span aria-hidden="true" className={`agent-dot agent-dot--${tone}`} />
      {agentThreadLifecycleLabel(thread.lifecycle)}
    </span>
  );
}
