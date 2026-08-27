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
import { AgentComposerController } from "./AgentComposerController";
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
import { useAgentComposerControllerState } from "./useAgentComposerState";
import { useAgentShipActions } from "./useAgentShipActions";
import { useAgentSurfaceLayout } from "./useAgentSurfaceLayout";
import { REVEAL_FAILED_NOTICE, useAgentThreadMenuCommands } from "./useAgentThreadMenuCommands";
import { useAgentThreadNavigation } from "./useAgentThreadNavigation";
import { useAgentViewCommands } from "./useAgentViewCommands";
import {
  useAgentLatestCallback,
  useAgentSurfacePresentationView,
  useAgentThreadScriptPresentation,
  useAgentThreadPresentationViews,
} from "./useAgentThreadPresentationViews";

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

  const presentationThreads = useAgentThreadPresentationViews(agents.threads);
  const groups = useMemo(
    () => agentProjectGroups(projects, presentationThreads, agents.orphanedWorktrees),
    [projects, agents.orphanedWorktrees, presentationThreads],
  );

  const navigation = useAgentThreadNavigation({
    agents,
    groups,
    presentationThreads,
    projects,
  });
  const { selectedThread: sessionThread, selectedThreadId, railScope, find } = navigation;
  const selectedThread =
    selectedThreadId === null
      ? null
      : (presentationThreads.find((view) => view.thread.threadId === selectedThreadId) ?? null);
  const surfaceThread = useAgentSurfacePresentationView(selectedThread);

  const composer = useAgentComposerControllerState({
    agents,
    groups,
    projects,
    railScope: navigation.composerScope,
    selectedThread,
    onClearSelectedThread: navigation.clearSelectedThread,
    onThreadStarted: navigation.selectStartedThread,
  });
  const submitComposer = useAgentLatestCallback(composer.submit);
  const changeDangerousConfirmed = useAgentLatestCallback(
    composer.composerProps.onDangerousConfirmedChange,
  );
  const changeIsolation = useAgentLatestCallback(composer.composerProps.onIsolationChange);
  const changeLaunch = useAgentLatestCallback(composer.composerProps.onLaunchChange);
  const clearComposer = useAgentLatestCallback(composer.composerProps.onNewThread);
  const selectComposerRepository = useAgentLatestCallback(
    composer.composerProps.onSelectRepository,
  );
  const changeUnsafeConfirmed = useAgentLatestCallback(
    composer.composerProps.onUnsafeConfirmedChange,
  );
  const composerProps = {
    ...composer.composerProps,
    onDangerousConfirmedChange: changeDangerousConfirmed,
    onIsolationChange: changeIsolation,
    onLaunchChange: changeLaunch,
    onNewThread: clearComposer,
    onSelectRepository: selectComposerRepository,
    onUnsafeConfirmedChange: changeUnsafeConfirmed,
  };
  const startNewThread = composer.startNewThread;

  const shipActions = useAgentShipActions({ agents, selectedThread });
  const surface = useAgentSurfaceLayout({ chrome, selectedThread, workspaceRoot });
  const { layout, openSurface, toggleRail, toggleRightPanel } = surface;
  const onShowTerminalPanel = chrome.onShowTerminalPanel;
  const scriptsTarget = useMemo(
    () => (selectedThread === null ? null : scriptTarget(selectedThread)),
    [selectedThread],
  );
  const scripts = useAgentThreadScripts({
    target: scriptsTarget,
    workspaceRoot,
    runner: chrome.scripts,
    onBeforeRun: onShowTerminalPanel,
  });
  const headerScripts = useAgentThreadScriptPresentation(scripts);
  const showChanges = agents.showChanges;
  const trustProject = useAgentLatestCallback(onTrustProject);
  const releaseProject = useAgentLatestCallback(onReleaseProject);
  const reviewInDiff = useCallback(
    (threadId: string) => {
      void showChanges(threadId);
      openSurface("diff");
    },
    [openSurface, showChanges],
  );

  const menu = useAgentThreadMenuCommands({
    agents,
    groups,
    revealPath: chrome.revealPath,
    reportNotice: setLocalNotice,
    onTrustProject: trustProject,
    onReleaseProject: releaseProject,
    onFilterScope: navigation.setRailScope,
    onThreadRemoved: navigation.forgetThread,
    startNewThread,
  });
  const renameThread = useAgentLatestCallback(agents.renameThread);
  const togglePin = useAgentLatestCallback(agents.togglePin);
  const threadMenuCommand = useAgentLatestCallback(menu.handleThreadMenuCommand);
  const projectMenuCommand = useAgentLatestCallback(menu.handleProjectCommand);
  const newThread = useAgentLatestCallback(startNewThread);
  const activateSurface = useAgentLatestCallback(surface.activateSurface);
  const closeSurfaceTab = useAgentLatestCallback(surface.closeSurfaceTab);
  const expandEditor = useAgentLatestCallback(surface.expandEditor);
  const openSurfaceCommand = useAgentLatestCallback(openSurface);
  const toggleRightPanelCommand = useAgentLatestCallback(toggleRightPanel);
  const revealFailed = useCallback(() => setLocalNotice(REVEAL_FAILED_NOTICE), []);

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

  const composerTargetProjectRootKey = composer.target?.projectRootKey ?? null;
  const composerTargetRepositoryRoot = composer.target?.repositoryRoot ?? null;
  const headerFallback = useMemo(
    () =>
      composerTargetProjectRootKey === null || composerTargetRepositoryRoot === null
        ? null
        : {
            projectRootKey: composerTargetProjectRootKey,
            repositoryRoot: composerTargetRepositoryRoot,
          },
    [composerTargetProjectRootKey, composerTargetRepositoryRoot],
  );
  const headerProject = useMemo(
    () => agentThreadHeaderProject(selectedThread, groups, projects, headerFallback),
    [groups, headerFallback, projects, selectedThread],
  );
  const layoutControls = useMemo(
    () => (
      <AgentPanelLayoutControls
        bottomPanelOpen={chrome.bottomPanelVisible}
        maximize={{ maximized: layout.rightPanelMaximized, onToggle: surface.toggleMaximized }}
        onExpandEditor={null}
        onToggleBottomPanel={chrome.onToggleBottomPanel}
        onToggleRightPanel={toggleRightPanel}
        rightPanelOpen
        shortcuts={chrome.shortcuts}
      />
    ),
    [
      chrome.bottomPanelVisible,
      chrome.onToggleBottomPanel,
      chrome.shortcuts,
      layout.rightPanelMaximized,
      surface.toggleMaximized,
      toggleRightPanel,
    ],
  );
  const surfaceAgents = useMemo(
    () => ({
      showChanges: agents.showChanges,
      showFileDiff: agents.showFileDiff,
      hideFileDiff: agents.hideFileDiff,
      openChangedFile: agents.openChangedFile,
      openChangedFileDiff: agents.openChangedFileDiff,
    }),
    [
      agents.hideFileDiff,
      agents.openChangedFile,
      agents.openChangedFileDiff,
      agents.showChanges,
      agents.showFileDiff,
    ],
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
                onNewThread={newThread}
                onProjectCommand={projectMenuCommand}
                onReleaseProject={releaseProject}
                onSelectThread={navigation.selectThread}
                onThreadMenuCommand={threadMenuCommand}
                onTogglePin={togglePin}
                onTrustProject={trustProject}
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
                onExpandEditor={expandEditor}
                onNewThread={newThread}
                onOpenScriptsView={chrome.onOpenScriptsView}
                onOpenSurface={openSurfaceCommand}
                onRenameThread={renameThread}
                onRevealFailed={revealFailed}
                onRevealPath={chrome.revealPath}
                onThreadMenuCommand={threadMenuCommand}
                onToggleBottomPanel={chrome.onToggleBottomPanel}
                onToggleRightPanel={toggleRightPanelCommand}
                project={headerProject}
                scripts={headerScripts}
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
                thread={sessionThread}
              />
              <AgentComposerController
                composerProps={composerProps}
                modelFavoritesPersistence={modelFavoritesPersistence}
                submissionBlocked={composer.submissionBlocked}
                submit={submitComposer}
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
          agents={surfaceAgents}
          chooserAutoFocus={surface.chooserRequested}
          chrome={chrome}
          hidden={surface.surfaceHost.hidden}
          layout={layout}
          layoutControls={layoutControls}
          onActivateSurface={activateSurface}
          onClosePanel={toggleRightPanelCommand}
          onCloseSurfaceTab={closeSurfaceTab}
          onOpenSurface={openSurfaceCommand}
          thread={surfaceThread}
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
