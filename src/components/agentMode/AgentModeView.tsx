import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { PanelLeftOpen } from "lucide-react";
import {
  useAgentThreadScripts,
  type AgentThreadScriptTarget,
} from "../../application/useAgentThreadScripts";
import type { AgentModelFavoritesPersistence } from "../../application/useAgentModelFavorites";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type {
  AgentTasksNotice,
  AgentThreadsSurface,
  AgentThreadView,
} from "../../application/agentThreadPorts";
import type {
  AgentViewCommandBridge,
  AgentViewCommandHandlers,
} from "../../application/agentViewCommandBridge";
import { AgentComposer } from "./AgentComposer";
import { AgentPanelLayoutControls } from "./AgentPanelLayoutControls";
import { AgentSurfaceHost } from "./AgentSurfaceHost";
import { AgentAddProjectDialog } from "./AgentAddProjectDialog";
import { AgentNoticeBar } from "./AgentNoticeBar";
import { AgentThreadFindBar } from "./AgentThreadFindBar";
import { AgentThreadHeader } from "./AgentThreadHeader";
import { AgentThreadSearchPalette } from "./AgentThreadSearchPalette";
import { AgentThreadSession } from "./AgentThreadSession";
import { AgentThreadsSidebar } from "./AgentThreadsSidebar";
import { agentThreadHeaderProject, type AgentWorkbenchChrome } from "./agentWorkbenchChrome";
import { AgentClockProvider } from "./agentClock";
import { agentProjectGroups } from "./agentModePresentation";
import { useAgentAddProject } from "./useAgentAddProject";
import { useAgentComposerState } from "./useAgentComposerState";
import { useAgentShipActions } from "./useAgentShipActions";
import { useAgentSurfaceLayout } from "./useAgentSurfaceLayout";
import { REVEAL_FAILED_NOTICE, useAgentThreadMenuCommands } from "./useAgentThreadMenuCommands";
import { useAgentThreadNavigation } from "./useAgentThreadNavigation";
import { useAgentViewCommands } from "./useAgentViewCommands";

export interface AgentModeViewProps {
  readonly agents: AgentThreadsSurface;
  readonly modelFavoritesPersistence?: AgentModelFavoritesPersistence | null;
  readonly workspaceRoot: string | null;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly overflowRootPaths: ReadonlyArray<string>;
  readonly nowTickMs?: number;
  readonly viewCommands?: AgentViewCommandBridge | null;
  readonly chrome: AgentWorkbenchChrome;
  onTrustProject(projectRootKey: string): void;
  onReleaseProject(projectRootKey: string): void;
}

const DEFAULT_NOW_TICK_MS = 30_000;
const FIND_BAR_ROWS: CSSProperties = { gridTemplateRows: "auto auto minmax(0, 1fr) auto" };

export function AgentModeView({
  agents,
  chrome,
  modelFavoritesPersistence = null,
  nowTickMs = DEFAULT_NOW_TICK_MS,
  onReleaseProject,
  onTrustProject,
  overflowRootPaths,
  projects,
  viewCommands = null,
  workspaceRoot,
}: AgentModeViewProps) {
  const [localNotice, setLocalNotice] = useState<AgentTasksNotice | null>(null);
  const [commitMenuOpenSignal, setCommitMenuOpenSignal] = useState(0);

  const groups = useMemo(
    () => agentProjectGroups(projects, agents.threads, agents.orphanedWorktrees),
    [projects, agents.orphanedWorktrees, agents.threads],
  );

  const navigation = useAgentThreadNavigation({ agents, groups, projects });
  const { selectedThread, selectedThreadId, railScope, find } = navigation;

  const composer = useAgentComposerState({
    agents,
    groups,
    projects,
    railScope: navigation.composerScope,
    selectedThread,
    onClearSelectedThread: navigation.clearSelectedThread,
    onThreadStarted: navigation.selectStartedThread,
  });
  const startNewThread = composer.startNewThread;

  const shipActions = useAgentShipActions({ agents, selectedThread });
  const surface = useAgentSurfaceLayout({ chrome, selectedThread, workspaceRoot });
  const { layout, openSurface, toggleRail, toggleRightPanel } = surface;
  const onShowTerminalPanel = chrome.onShowTerminalPanel;
  const scripts = useAgentThreadScripts({
    target: selectedThread === null ? null : scriptTarget(selectedThread),
    workspaceRoot,
    runner: chrome.scripts,
    onBeforeRun: onShowTerminalPanel,
  });
  const reviewInDiff = useCallback(
    (threadId: string) => {
      void agents.showChanges(threadId);
      openSurface("diff");
    },
    [agents, openSurface],
  );

  const menu = useAgentThreadMenuCommands({
    agents,
    groups,
    revealPath: chrome.revealPath,
    reportNotice: setLocalNotice,
    onTrustProject,
    onReleaseProject,
    onFilterScope: navigation.setRailScope,
    onThreadRemoved: navigation.forgetThread,
    startNewThread,
  });

  const navigationCommands = navigation.commands;
  const newThreadTarget = navigation.newThreadTarget;
  const surfaceBlocked = surface.surfaceBlocked;
  const commandHandlers = useMemo<AgentViewCommandHandlers>(
    () => ({
      ...navigationCommands,
      newThread: () => {
        const next = newThreadTarget();
        if (next === null) return;
        startNewThread(next.projectRootKey, next.repositoryRoot);
      },
      runPreferredScript: () => {
        if (scripts.preferred === null) return;
        scripts.runScript(scripts.preferred.key);
      },
      openCommitMenu: () => {
        if (selectedThreadId === null) return;
        setCommitMenuOpenSignal((current) => current + 1);
      },
      surfaceBlocked,
    }),
    [
      navigationCommands,
      newThreadTarget,
      scripts,
      selectedThreadId,
      startNewThread,
      surfaceBlocked,
    ],
  );
  useAgentViewCommands(viewCommands, commandHandlers);

  const notice = localNotice ?? agents.notice;
  const dismissNotice = useCallback(() => {
    if (localNotice !== null) {
      setLocalNotice(null);
      return;
    }
    agents.dismissNotice();
  }, [agents, localNotice]);

  const addProject = useAgentAddProject({
    chrome: chrome.addProject,
    projects,
    reportNotice: setLocalNotice,
    workspaceRoot,
  });

  const headerProject = agentThreadHeaderProject(selectedThread, groups, projects, composer.target);
  const layoutControls = (
    <AgentPanelLayoutControls
      bottomPanelOpen={chrome.bottomPanelVisible}
      maximize={{ maximized: layout.rightPanelMaximized, onToggle: surface.toggleMaximized }}
      onExpandEditor={null}
      onToggleBottomPanel={chrome.onToggleBottomPanel}
      onToggleRightPanel={toggleRightPanel}
      rightPanelOpen
      shortcuts={chrome.shortcuts}
    />
  );

  return (
    <>
      <section aria-label="Agent mode" className="agent-mode" data-slot="agent">
        {notice && (
          <AgentNoticeBar
            notice={notice}
            onConfigure={() => agents.configureAgentCli()}
            onDismiss={dismissNotice}
          />
        )}
        <AgentClockProvider nowTickMs={nowTickMs}>
          <div className="agent-mode__grid">
            {layout.rail === "collapsed" ? (
              <div className="agent-rail__chrome">
                <button
                  aria-expanded="false"
                  aria-label="Expand sidebar"
                  className="agent-iconbutton"
                  onClick={toggleRail}
                  title="Expand sidebar"
                  type="button"
                >
                  <PanelLeftOpen aria-hidden="true" size={16} />
                </button>
              </div>
            ) : (
              <AgentThreadsSidebar
                addProjectAvailable={chrome.addProject !== null}
                groups={groups}
                onAddProject={addProject.openDialog}
                onChangeScope={navigation.setRailScope}
                onCollapseSidebar={toggleRail}
                onNewThread={startNewThread}
                onProjectCommand={menu.handleProjectCommand}
                onReleaseProject={onReleaseProject}
                onSelectThread={navigation.selectThread}
                onThreadMenuCommand={menu.handleThreadMenuCommand}
                onTogglePin={(threadId) => agents.togglePin(threadId)}
                onTrustProject={onTrustProject}
                overflowRootPaths={overflowRootPaths}
                scope={railScope}
                scopeEntries={navigation.scopeEntries}
                search={navigation.search}
                selectedThreadId={selectedThread?.thread.threadId ?? null}
              />
            )}

            <div
              className="agent-mode__center"
              ref={navigation.centerRef}
              style={find.open ? FIND_BAR_ROWS : undefined}
            >
              <AgentThreadHeader
                bottomPanelOpen={chrome.bottomPanelVisible}
                commitMenuOpenSignal={commitMenuOpenSignal}
                layout={layout}
                onExpandEditor={surface.expandEditor}
                onNewThread={startNewThread}
                onOpenScriptsView={chrome.onOpenScriptsView}
                onOpenSurface={openSurface}
                onRenameThread={(threadId, title) => agents.renameThread(threadId, title)}
                onRevealFailed={() => setLocalNotice(REVEAL_FAILED_NOTICE)}
                onRevealPath={chrome.revealPath}
                onThreadMenuCommand={menu.handleThreadMenuCommand}
                onToggleBottomPanel={chrome.onToggleBottomPanel}
                onToggleRightPanel={toggleRightPanel}
                project={headerProject}
                scripts={scripts}
                shipActions={shipActions}
                shortcuts={chrome.shortcuts}
                thread={selectedThread}
              />
              {find.open && (
                <AgentThreadFindBar
                  currentIndex={find.hitIndex}
                  hitCount={find.hits.length}
                  onChangeQuery={find.setQuery}
                  onClose={navigation.closeFindBar}
                  onNavigate={find.navigate}
                  query={find.query}
                />
              )}
              <AgentThreadSession
                composerRepositoryLabel={composer.composerLabel}
                findHitIndex={navigation.findHitIndex}
                findHits={find.open ? find.hits : undefined}
                findQuery={find.open ? find.query : undefined}
                onReviewInDiff={reviewInDiff}
                reveal={find.reveal}
                thread={selectedThread}
              />
              <AgentComposer
                {...composer.composerProps}
                modelFavoritesPersistence={modelFavoritesPersistence}
              />
            </div>
          </div>
        </AgentClockProvider>
        {addProject.open && chrome.addProject !== null && (
          <AgentAddProjectDialog
            gateway={chrome.addProject.gateway}
            onAdd={addProject.addProject}
            onClose={addProject.closeDialog}
            onNotice={addProject.reportNotice}
            projectRootPaths={addProject.projectRootPaths}
          />
        )}
        <AgentThreadSearchPalette
          archivedThreadIds={navigation.palette.archivedThreadIds}
          isOpen={navigation.palette.open}
          onActivate={navigation.palette.activate}
          onChangeQuery={navigation.search.setQuery}
          onClose={navigation.palette.close}
          pending={navigation.search.pending}
          query={navigation.search.query}
          result={navigation.search.result}
          titles={navigation.palette.titles}
        />
      </section>
      {surface.surfaceHost.mounted && (
        <AgentSurfaceHost
          agents={agents}
          chooserAutoFocus={surface.chooserRequested}
          chrome={chrome}
          hidden={surface.surfaceHost.hidden}
          layout={layout}
          layoutControls={layoutControls}
          onActivateSurface={surface.activateSurface}
          onClosePanel={toggleRightPanel}
          onCloseSurfaceTab={surface.closeSurfaceTab}
          onOpenSurface={openSurface}
          thread={selectedThread}
          workspaceRoot={workspaceRoot}
        />
      )}
    </>
  );
}

function scriptTarget(view: AgentThreadView): AgentThreadScriptTarget {
  const record = view.thread;
  return {
    threadId: record.threadId,
    repositoryRoot: record.owner.repositoryRoot,
    isolation: record.target.isolation,
    worktreePath: record.target.worktreePath,
    worktreeMissing: view.worktreeMissing,
  };
}
