import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { PanelLeftOpen } from "lucide-react";
import {
  useAgentThreadScripts,
  type AgentThreadScriptTarget,
} from "../../application/useAgentThreadScripts";
import type { AgentModelFavoritesPersistence } from "../../application/useAgentModelFavorites";
import type {
  AgentProviderManagementSurface,
  AgentProviderManagementToast,
} from "../../application/useAgentProviderManagement";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentCliKind } from "../../domain/agentTask";
import type { AgentAccountUsageLoadState } from "../../domain/agentAccountUsage";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { agentContextCompactionOffer } from "../../domain/agentContextCompaction";
import type {
  AgentTasksNotice,
  AgentThreadsSurface,
  AgentThreadView,
  ExternalSessionsSurface,
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
import { AgentTerminalSessionsPalette } from "./AgentTerminalSessionsPalette";
import { AgentThreadSearchPalette } from "./AgentThreadSearchPalette";
import { AgentThreadSession } from "./AgentThreadSession";
import { AgentThreadsSidebar } from "./AgentThreadsSidebar";
import { agentThreadHeaderProject, type AgentWorkbenchChrome } from "./agentWorkbenchChrome";
import { AgentClockProvider } from "./agentClock";
import { agentProjectGroups } from "./agentModePresentation";
import { agentProjectTerminalSessionsTarget } from "./agentSidebarPresentation";
import { useAgentAddProject } from "./useAgentAddProject";
import { useAgentComposerControllerState } from "./useAgentComposerState";
import { useAgentShipActions } from "./useAgentShipActions";
import { useAgentSurfaceLayout } from "./useAgentSurfaceLayout";
import { REVEAL_FAILED_NOTICE, useAgentThreadMenuCommands } from "./useAgentThreadMenuCommands";
import { useAgentThreadNavigation } from "./useAgentThreadNavigation";
import { useAgentViewCommands } from "./useAgentViewCommands";
import { useWorkbenchFrameResponsiveRestore } from "../useWorkbenchFrameResponsiveRestore";
import { AgentProviderUpdateToast } from "../AgentProviderUpdateToast";
import { createAgentProviderUpdateToastView } from "../agentProviderUpdateToastRenderer";
import {
  useAgentLatestCallback,
  useAgentSurfacePresentationView,
  useAgentThreadScriptPresentation,
  useAgentThreadPresentationViews,
} from "./useAgentThreadPresentationViews";

export interface AgentModeViewProps {
  readonly agents: AgentThreadsSurface & {
    readonly accountUsage?: Readonly<Record<"claudeCode" | "codex", AgentAccountUsageLoadState>>;
    readonly providerManagement: AgentProviderManagementSurface;
    readonly externalSessions?: ExternalSessionsSurface;
  };
  readonly modelFavoritesPersistence?: AgentModelFavoritesPersistence | null;
  readonly workspaceRoot: string | null;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly overflowRootPaths: ReadonlyArray<string>;
  readonly providerEnabled: Readonly<Record<AgentCliKind, boolean>>;
  readonly nowTickMs?: number;
  readonly viewCommands?: AgentViewCommandBridge | null;
  readonly chrome: AgentWorkbenchChrome;
  readonly textClipboard?: TextClipboardGateway | null;
  onOpenSourceControl?(): void;
  onTrustProject(projectRootKey: string): void;
  onCloseProject?(rootPath: string): void;
  onReleaseProject(projectRootKey: string): void;
}

const DEFAULT_NOW_TICK_MS = 30_000;
const IDLE_ACCOUNT_USAGE = {
  claudeCode: { kind: "idle" },
  codex: { kind: "idle" },
} as const;
const FIND_BAR_ROWS: CSSProperties = { gridTemplateRows: "auto auto minmax(0, 1fr) auto" };
const NOOP_OPEN_SOURCE_CONTROL = () => undefined;
const NOOP_CLOSE_PROJECT = () => undefined;

const TERMINAL_SESSIONS_UNAVAILABLE_NOTICE: AgentTasksNotice = {
  kind: "warning",
  message: "Terminal sessions are not available in this workbench.",
  action: null,
};

export function AgentModeView({
  agents,
  chrome,
  modelFavoritesPersistence = null,
  nowTickMs = DEFAULT_NOW_TICK_MS,
  onOpenSourceControl = NOOP_OPEN_SOURCE_CONTROL,
  onCloseProject = NOOP_CLOSE_PROJECT,
  onReleaseProject,
  onTrustProject,
  overflowRootPaths,
  providerEnabled,
  projects,
  textClipboard = null,
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

  const externalSessions = agents.externalSessions ?? null;
  const navigation = useAgentThreadNavigation({
    agents,
    externalSessions,
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
    providerEnabled,
    railScope: navigation.composerScope,
    selectedThread,
    onClearSelectedThread: navigation.clearSelectedThread,
    onThreadStarted: navigation.selectStartedThread,
  });
  const submitComposer = useAgentLatestCallback(composer.submit);
  const changeIsolation = useAgentLatestCallback(composer.composerProps.onIsolationChange);
  const changeLaunch = useAgentLatestCallback(composer.composerProps.onLaunchChange);
  const clearComposer = useAgentLatestCallback(composer.composerProps.onNewThread);
  const selectComposerRepository = useAgentLatestCallback(
    composer.composerProps.onSelectRepository,
  );
  const composerProps = {
    ...composer.composerProps,
    onIsolationChange: changeIsolation,
    onLaunchChange: changeLaunch,
    onNewThread: clearComposer,
    onSelectRepository: selectComposerRepository,
  };
  const startNewThread = composer.startNewThread;

  const shipActions = useAgentShipActions({ agents, selectedThread });
  const surface = useAgentSurfaceLayout({ chrome, selectedThread, workspaceRoot });
  const { layout, openSurface, toggleMaximized, toggleRail, toggleRightPanel } = surface;
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

  const terminalSessionsPalette = navigation.terminalSessions;
  const terminalSessionsTarget = terminalSessionsPalette.target;
  const selectThread = navigation.selectThread;
  const openTerminalSessions = useCallback(
    (projectRootKey: string, repositoryRoot: string) => {
      if (externalSessions === null) {
        setLocalNotice(TERMINAL_SESSIONS_UNAVAILABLE_NOTICE);
        return;
      }
      if (!terminalSessionsPalette.openFor(projectRootKey, repositoryRoot)) return;
      void externalSessions.open({ rootKey: projectRootKey, repositoryRoot });
    },
    [externalSessions, terminalSessionsPalette],
  );
  const closeTerminalSessions = useCallback(() => {
    terminalSessionsPalette.close();
    externalSessions?.close();
  }, [externalSessions, terminalSessionsPalette]);
  const selectImportedThread = useCallback(
    (threadId: string) => {
      selectThread(threadId);
      closeTerminalSessions();
    },
    [closeTerminalSessions, selectThread],
  );
  const importExternalSessionAction = agents.importExternalSession;
  const importTerminalSession = useCallback(
    (sessionId: string, provider: AgentCliKind) => {
      if (externalSessions === null) return;
      if (terminalSessionsTarget === null) return;
      const session =
        externalSessions.sessions.find(
          (candidate) => candidate.sessionId === sessionId && candidate.provider === provider,
        ) ?? null;
      if (session === null) return;
      if (session.alreadyImportedThreadId !== null) {
        selectImportedThread(session.alreadyImportedThreadId);
        return;
      }
      void importExternalSessionAction({
        projectRootKey: terminalSessionsTarget.projectRootKey,
        repositoryRoot: session.cwd,
        provider,
        sessionId,
        title: session.title,
        firstPrompt: session.firstPrompt,
      }).then((result) => {
        if (result === null) return;
        selectImportedThread(result.threadId);
      });
    },
    [externalSessions, importExternalSessionAction, selectImportedThread, terminalSessionsTarget],
  );
  const newThreadTargetForRail = navigation.newThreadTarget;
  const railTerminalSessionsTarget = useMemo(
    () => newThreadTargetForRail(),
    [newThreadTargetForRail],
  );
  const terminalSessionsProjectLabel = useMemo(() => {
    if (terminalSessionsTarget === null) return null;
    return (
      groups.find((group) => group.projectRootKey === terminalSessionsTarget.projectRootKey)
        ?.label ?? null
    );
  }, [groups, terminalSessionsTarget]);

  const menu = useAgentThreadMenuCommands({
    agents,
    groups,
    revealPath: chrome.revealPath,
    reportNotice: setLocalNotice,
    onTrustProject: trustProject,
    onReleaseProject: releaseProject,
    onCloseProject,
    onThreadRemoved: navigation.forgetThread,
    onOpenTerminalSessions: openTerminalSessions,
    startNewThread,
  });
  const renameThread = useAgentLatestCallback(agents.renameThread);
  const togglePin = useAgentLatestCallback(agents.togglePin);
  const threadMenuCommand = useAgentLatestCallback(menu.handleThreadMenuCommand);
  const projectMenuCommand = useAgentLatestCallback(menu.handleProjectCommand);
  const newThread = useAgentLatestCallback(startNewThread);
  const activateSurface = useAgentLatestCallback(surface.activateSurface);
  const closeSurfaceTab = useAgentLatestCallback(surface.closeSurfaceTab);
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

  const managementNotice = providerNotice(agents.providerManagement.toast);
  const notice = localNotice ?? agents.notice ?? managementNotice;
  const dismissNotice = useCallback(() => {
    if (localNotice !== null) {
      setLocalNotice(null);
      return;
    }
    if (agents.notice !== null) {
      agents.dismissNotice();
      return;
    }
    agents.providerManagement.dismissToast();
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
  const scopeEntries = navigation.scopeEntries;
  const headerTerminalSessionsTarget = useMemo(() => {
    if (headerProject === null) return railTerminalSessionsTarget;
    return agentProjectTerminalSessionsTarget(headerProject, scopeEntries);
  }, [headerProject, railTerminalSessionsTarget, scopeEntries]);
  const openHeaderTerminalSessions = useMemo(() => {
    const target = headerTerminalSessionsTarget;
    if (target === null) return null;
    return () => openTerminalSessions(target.projectRootKey, target.repositoryRoot);
  }, [headerTerminalSessionsTarget, openTerminalSessions]);
  const responsivePanelRestore = useWorkbenchFrameResponsiveRestore();
  const toggleResponsivePanel = useCallback(() => {
    switch (responsivePanelRestore) {
      case "none":
        toggleMaximized();
        return;
      case "collapseRail":
        if (layout.rightPanelMaximized) toggleMaximized();
        toggleRail();
        return;
      case "closePanel":
        if (layout.rightPanelMaximized) toggleMaximized();
        toggleRightPanel();
        return;
      default:
        responsivePanelRestore satisfies never;
    }
  }, [
    layout.rightPanelMaximized,
    responsivePanelRestore,
    toggleMaximized,
    toggleRail,
    toggleRightPanel,
  ]);
  const layoutControls = useMemo(
    () => (
      <AgentPanelLayoutControls
        bottomPanelOpen={chrome.bottomPanelVisible}
        maximize={{
          maximized: layout.rightPanelMaximized || responsivePanelRestore !== "none",
          onToggle: toggleResponsivePanel,
        }}
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
      responsivePanelRestore,
      toggleResponsivePanel,
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
  const updateToast = agents.providerManagement.toast;
  const updateToastView =
    updateToast?.kind === "updateAvailable"
      ? createAgentProviderUpdateToastView(updateToast.provider, updateToast.version)
      : null;

  return (
    <>
      {updateToastView === null ? null : (
        <AgentProviderUpdateToast
          onDismiss={() => {
            void agents.providerManagement.dismissUpdate(
              updateToastView.provider,
              updateToastView.availableVersion,
            );
          }}
          onOpenSettings={() => {
            agents.providerManagement.dismissToast();
            agents.configureAgentCli();
          }}
          onUpdate={() => {
            void agents.providerManagement.update(
              updateToastView.provider,
              updateToastView.availableVersion,
            );
          }}
          view={updateToastView}
        />
      )}
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
                accountUsage={agents.accountUsage ?? IDLE_ACCOUNT_USAGE}
                groups={groups}
                onAddProject={addProject.openDialog}
                onChangeScope={navigation.setRailScope}
                onCollapseSidebar={toggleRail}
                onNewThread={newThread}
                onOpenProviderSettings={agents.configureAgentCli}
                onOpenSourceControl={onOpenSourceControl}
                onProjectCommand={projectMenuCommand}
                onReleaseProject={releaseProject}
                onSelectThread={navigation.selectThread}
                onThreadMenuCommand={threadMenuCommand}
                onTogglePin={togglePin}
                onTrustProject={trustProject}
                overflowRootPaths={overflowRootPaths}
                providerEnabled={providerEnabled}
                providerManagement={agents.providerManagement}
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
                onNewThread={newThread}
                onOpenScriptsView={chrome.onOpenScriptsView}
                onOpenSurface={openSurfaceCommand}
                onOpenTerminalSessions={openHeaderTerminalSessions}
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
                externalHistoryState={
                  sessionThread === null
                    ? undefined
                    : agents.externalHistory?.states.get(sessionThread.thread.threadId)
                }
                onRetryExternalHistory={
                  sessionThread === null || agents.externalHistory === undefined
                    ? undefined
                    : () => {
                        void agents.externalHistory?.load(sessionThread.thread.threadId);
                      }
                }
                composerRepositoryLabel={composer.composerLabel}
                findHitIndex={navigation.findHitIndex}
                findHits={find.open ? find.hits : undefined}
                findQuery={find.open ? find.query : undefined}
                onReviewInDiff={reviewInDiff}
                reveal={find.reveal}
                textClipboard={textClipboard}
                thread={sessionThread}
              />
              <AgentComposerController
                compactionOffer={agentContextCompactionOffer(
                  sessionThread?.thread ?? null,
                  Date.now(),
                )}
                composerProps={composerProps}
                modelFavoritesPersistence={modelFavoritesPersistence}
                onOpenProviderSettings={agents.configureAgentCli}
                providerManagement={agents.providerManagement}
                providerEnabled={providerEnabled}
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
        {externalSessions !== null && (
          <AgentTerminalSessionsPalette
            isOpen={terminalSessionsPalette.open}
            onClose={closeTerminalSessions}
            onImport={importTerminalSession}
            onSelectImported={selectImportedThread}
            projectLabel={terminalSessionsProjectLabel}
            surface={externalSessions}
          />
        )}
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
          onCloseSurfaceTab={closeSurfaceTab}
          onOpenSurface={openSurfaceCommand}
          thread={surfaceThread}
          workspaceRoot={workspaceRoot}
        />
      )}
    </>
  );
}

function providerNotice(toast: AgentProviderManagementToast | null): AgentTasksNotice | null {
  if (toast === null) return null;
  switch (toast.kind) {
    case "updateAvailable":
      return null;
    case "updateSucceeded":
      return {
        kind: "info",
        message: `${providerLabel(toast.provider)} updated to v${toast.version}.`,
        action: null,
      };
    case "updateFailed":
      return {
        kind: "error",
        message: `${providerLabel(toast.provider)} update failed. Open Settings for details.`,
        action: null,
      };
    default:
      return unsupportedProviderManagementToast(toast);
  }
}

function providerLabel(provider: "claudeCode" | "codex"): string {
  switch (provider) {
    case "claudeCode":
      return "Claude Code";
    case "codex":
      return "Codex";
    default:
      return unsupportedProvider(provider);
  }
}

function unsupportedProviderManagementToast(toast: never): never {
  throw new TypeError(`Unsupported provider management toast: ${String(toast)}`);
}

function unsupportedProvider(provider: never): never {
  throw new TypeError(`Unsupported provider: ${String(provider)}`);
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
