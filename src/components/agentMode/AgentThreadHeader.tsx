import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { ChevronDown, GitCommitHorizontal, History } from "lucide-react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentThreadScriptsSurface } from "../../application/useAgentThreadScripts";
import type { AgentSurfaceKind, AgentWorkbenchLayout } from "../../domain/agentWorkbenchLayout";
import { runningTurn } from "../../domain/agentThread";
import { Button } from "../../ui/foundation/Button";
import { IconButton } from "../../ui/foundation/IconButton";
import { ProjectFavicon } from "../../ui/shell/ProjectFavicon";
import { TopBar, TopBarSeparator } from "../../ui/shell/TopBar";
import { agentShipBranchLabel, agentThreadDisplayTitle } from "./agentModePresentation";
import { AgentOpenMenu } from "./AgentOpenMenu";
import { AgentPanelLayoutControls } from "./AgentPanelLayoutControls";
import { AgentScriptRunControl } from "./AgentScriptRunControl";
import {
  agentThreadImportedBadgeLabel,
  agentViewCanMarkUnread,
  type AgentThreadMenuCommand,
} from "./agentSidebarPresentation";
import { RemoteThreadIndicator, RenameInput } from "./AgentThreadRowParts";
import { useAgentThreadRowMenu } from "./useAgentThreadRowMenu";
import {
  AGENT_TERMINAL_SESSIONS_LABEL,
  AGENT_OPEN_REMOTE_REASON,
  type AgentPanelLayoutShortcuts,
} from "./agentThreadHeaderPresentation";

export interface AgentThreadHeaderProject {
  readonly projectRootKey: string;
  readonly repositoryRoot: string;
  readonly label: string;
}

export interface AgentThreadHeaderProps {
  readonly thread: AgentThreadView | null;
  readonly project: AgentThreadHeaderProject | null;
  readonly layout: AgentWorkbenchLayout;
  readonly bottomPanelOpen: boolean;
  readonly scripts: AgentThreadScriptsSurface;
  readonly shortcuts: AgentPanelLayoutShortcuts | null;
  readonly gitSurfaceActive?: boolean;
  readonly leading?: ReactNode;
  readonly trailingExtras?: ReactNode;
  onNewThread(projectRootKey: string, repositoryRoot: string): void;
  onRenameThread(threadId: string, title: string): void;
  onThreadMenuCommand(threadId: string, command: AgentThreadMenuCommand): void;
  onOpenSurface(kind: AgentSurfaceKind): void;
  onToggleBottomPanel(): void;
  onToggleRightPanel(): void;
  onOpenScriptsView: (() => void) | null;
  onOpenTerminalSessions: (() => void) | null;
  onRevealPath(path: string): Promise<void>;
  onRevealFailed(error: unknown): void;
}

export const AgentThreadHeader = memo(function AgentThreadHeader(props: AgentThreadHeaderProps) {
  const { layout, onNewThread, onRenameThread, onThreadMenuCommand, project, thread } = props;
  const [renaming, setRenaming] = useState(false);
  const titleRef = useRef<HTMLButtonElement | null>(null);
  const remote = thread?.execution?.kind === "remote";
  const threadId = thread?.thread.threadId ?? null;
  const title = thread === null ? "New thread" : agentThreadDisplayTitle(thread.thread);
  const projectLabel = project?.label ?? thread?.repositoryLabel ?? null;
  const importedLabel = agentThreadImportedBadgeLabel(thread?.thread.externalOrigin ?? null);

  const threadCommand = useCallback(
    (command: AgentThreadMenuCommand) => {
      if (threadId !== null) onThreadMenuCommand(threadId, command);
    },
    [onThreadMenuCommand, threadId],
  );
  const menu = useAgentThreadRowMenu({
    title,
    returnFocusRef: titleRef,
    context: () => ({
      branch: thread === null ? null : agentShipBranchLabel(thread.ship),
      pinned: thread?.thread.pinned ?? false,
      archived: thread?.thread.archived ?? false,
      running: thread !== null && runningTurn(thread.thread) !== null,
      snoozed: (thread?.thread.snoozedUntil ?? 0) > Date.now(),
      settled: thread?.thread.settledAt != null,
      canMarkUnread: thread !== null && agentViewCanMarkUnread(thread),
      claudeSession:
        thread !== null &&
        thread.thread.provider.kind === "claudeCode" &&
        thread.execution?.kind !== "remote",
    }),
    onCommand: threadCommand,
    onRename: () => setRenaming(true),
  });
  const resetMenu = menu.reset;

  useEffect(() => {
    resetMenu();
    setRenaming(false);
  }, [resetMenu, threadId]);

  const openMenuBelowTitle = (): void => {
    const rect = titleRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    menu.openAt({ x: rect.left, y: rect.bottom + 4 });
  };

  const onContextMenu = (event: MouseEvent<HTMLElement>): void => {
    if (thread === null) return;
    menu.openAtPointer(event);
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

  const terminalSessions = (
    <TerminalSessionsButton onOpen={remote ? null : props.onOpenTerminalSessions} remote={remote} />
  );
  const actions =
    thread === null ? (
      terminalSessions
    ) : (
      <>
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
            blockedReason: remote ? AGENT_OPEN_REMOTE_REASON : null,
          }}
        />
        {terminalSessions}
      </>
    );
  const trailing = (
    <>
      {thread === null ? null : (
        <>
          <AgentScriptRunControl
            onOpenScriptsView={props.onOpenScriptsView}
            scripts={props.scripts}
          />
          <Button
            aria-label="Commit"
            aria-pressed={props.gitSurfaceActive === true}
            icon={<GitCommitHorizontal size={14} />}
            onClick={() => props.onOpenSurface("git")}
            size="sm"
            title="Commit changes in the Git panel"
          >
            Commit
          </Button>
          <TopBarSeparator />
        </>
      )}
      {props.trailingExtras ?? null}
      <AgentPanelLayoutControls
        bottomPanelOpen={props.bottomPanelOpen}
        onToggleBottomPanel={props.onToggleBottomPanel}
        onToggleRightPanel={props.onToggleRightPanel}
        rightPanelOpen={layout.rightPanel === "open"}
        shortcuts={props.shortcuts}
      />
    </>
  );

  return (
    <TopBar
      actions={actions}
      className="agent-thread-head"
      data-agent-thread-head=""
      label="Thread"
      leading={props.leading}
      region="main"
      trailing={trailing}
      windowEdge
    >
      <nav
        aria-label="Thread breadcrumb"
        className="agent-crumbs cv-crumb"
        onContextMenu={onContextMenu}
      >
        <button
          aria-label={projectLabel === null ? "New thread" : `New thread in ${projectLabel}`}
          className="agent-crumbs__project cv-crumb__project"
          disabled={project === null}
          onClick={startNewThread}
          title={project?.repositoryRoot ?? undefined}
          type="button"
        >
          <ProjectFavicon label={projectLabel ?? ""} />
          <span className="agent-crumbs__label cv-crumb__label">
            {projectLabel ?? "No project"}
          </span>
        </button>
        <span aria-hidden="true" className="agent-crumbs__sep cv-crumb__sep">
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
            aria-expanded={menu.open}
            aria-haspopup="menu"
            aria-label={`Thread actions for ${title}`}
            className="agent-crumbs__title cv-crumb__here"
            disabled={thread === null}
            onClick={openMenuBelowTitle}
            ref={titleRef}
            title={title}
            type="button"
          >
            <h2 className="agent-crumbs__heading cv-crumb__heading">{title}</h2>
            <ChevronDown
              aria-hidden="true"
              className="agent-crumbs__chevron cv-crumb__chevron"
              size={14}
            />
          </button>
        )}
        {remote && <RemoteThreadIndicator />}
        {importedLabel !== null && (
          <span className="agent-microlabel" title="Imported terminal session">
            {importedLabel}
          </span>
        )}
      </nav>
      {thread !== null && menu.overlays}
    </TopBar>
  );
});

function TerminalSessionsButton({
  onOpen,
  remote,
}: {
  readonly onOpen: (() => void) | null;
  readonly remote: boolean;
}) {
  return (
    <IconButton
      disabled={onOpen === null}
      icon={<History size={16} />}
      label={AGENT_TERMINAL_SESSIONS_LABEL}
      onClick={onOpen ?? undefined}
      title={
        remote
          ? "Importing terminal sessions from this server is not available yet"
          : AGENT_TERMINAL_SESSIONS_LABEL
      }
    />
  );
}
