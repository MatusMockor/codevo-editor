import { useAgentWorktreeFileChanges } from "../../application/useAgentWorktreeFileChanges";
import { useSurfaceEnterClass } from "../workbenchFrameBootContext";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentTaskIsolation } from "../../domain/agentTask";
import { agentGitHistoryScope } from "./agentGitHistoryTarget";
import { agentHistoryRepositories } from "./agentHistoryRepositories";
import { memo, useContext, useMemo, type ReactNode } from "react";
import type { AgentThreadView, AgentThreadsSurface } from "../../application/agentThreadPorts";
import type { RemoteFileRevealRequest } from "../../application/remoteFileRevealRequest";
import type { AgentSurfaceKind } from "../../domain/agentWorkbenchLayout";
import { isAgentRemoteSurfaceKind } from "../../domain/agentSurfaceActivation";
import type { AgentDiffScope } from "../../domain/diffView/agentDiffScope";
import type { AgentShipActions } from "./useAgentShipActions";
import type { AgentThreadScripts } from "../../application/useAgentThreadScripts";
import { AgentRightPanelContext } from "./rightPanel/agentRightPanelContext";
import { useAgentRightPanelContextValue } from "./rightPanel/useAgentRightPanelContextValue";
import { useStableAgentRightPanelThread } from "./rightPanel/agentRightPanelThread";
import {
  AgentSurfacePanel,
  type AgentSurfaceDiffPanelProps,
  type AgentSurfacePanelLayout,
  type AgentSurfaceTerminalPanelProps,
} from "./AgentSurfacePanel";
import {
  agentSurfaceActivationNotice,
  agentSurfaceLocalAvailable,
  isRemoteAgentSurfaceThread,
  isRemoteGitShipThread,
  SURFACE_REMOTE_UNAVAILABLE_REASON,
  SURFACE_REMOTE_NO_THREAD_DESCRIPTION,
  type AgentSurfaceScope,
} from "./agentSurfacePolicy";
import type { AgentWorkbenchChrome } from "./agentWorkbenchChrome";
import { remoteSurfaceSupports, type AgentRemoteSurface } from "./agentRemoteSurface";
import { useAgentSurfaceScopeTree } from "./useAgentSurfaceScopeTree";
import { EditorPanelDocumentsContext } from "../editorPanel/EditorPanelDocumentsContext";
import type { AgentComposerPreviousWorktree } from "./agentComposerPreviousWorktree";

export type AgentSurfaceHostAgents = Pick<
  AgentThreadsSurface,
  | "showChanges"
  | "showFileDiff"
  | "hideFileDiff"
  | "openChangedFile"
  | "openChangedFileDiff"
  | "getTurnChanges"
  | "getTurnFileDiff"
  | "turnChangesRevision"
  | "getTurnChangesRevision"
>;

export interface AgentSurfaceHostProps {
  readonly chrome: AgentWorkbenchChrome;
  readonly projects?: ReadonlyArray<AgentProjectDescriptor>;
  readonly layout: AgentSurfacePanelLayout;
  readonly thread: AgentThreadView | null;
  readonly remoteDraft?: boolean;
  readonly draftIsolation?: AgentTaskIsolation;
  readonly draftPreviousWorktree?: AgentComposerPreviousWorktree | null;
  readonly remoteSurface?: AgentRemoteSurface | null;
  readonly remoteFileReveal?: RemoteFileRevealRequest | null;
  readonly threadRootPath: string | null;
  readonly scope: AgentSurfaceScope;
  readonly workspaceRoot: string | null;
  readonly agents: AgentSurfaceHostAgents;
  readonly layoutControls: ReactNode;
  readonly leadingControls?: ReactNode;
  readonly hidden: boolean;
  readonly chooserAutoFocus: boolean;
  readonly agentsPanel?: ReactNode;
  readonly diffScope?: AgentDiffScope;
  readonly shipActions?: AgentShipActions | null;
  readonly scripts?: AgentThreadScripts | null;
  onDiffScopeChange?(scope: AgentDiffScope): void;
  onOpenSurface(surface: AgentSurfaceKind): void;
  onActivateSurface(surface: AgentSurfaceKind): void;
  onCloseSurfaceTab(surface: AgentSurfaceKind): void;
  onTrustScope(projectRootKey: string): void;
  readonly onSwitchScope: ((rootPath: string) => void) | null;
  readonly onResizeWidth?: (width: number) => void;
}

export const AgentSurfaceHost = memo(function AgentSurfaceHost({
  agents,
  agentsPanel = null,
  chooserAutoFocus,
  diffScope,
  onDiffScopeChange = ignoreDiffScope,
  shipActions = null,
  scripts = null,
  chrome,
  hidden,
  layout,
  layoutControls,
  leadingControls = null,
  onActivateSurface,
  onCloseSurfaceTab,
  onOpenSurface,
  onResizeWidth,
  onSwitchScope,
  onTrustScope,
  projects = [],
  remoteDraft = false,
  remoteFileReveal = null,
  remoteSurface = null,
  scope,
  thread,
  threadRootPath,
  workspaceRoot,
}: AgentSurfaceHostProps) {
  const surfaceEnterClass = useSurfaceEnterClass();
  const activation = chrome.workspaceActivation;
  const remote =
    (thread === null && remoteDraft) ||
    isRemoteAgentSurfaceThread(thread) ||
    (scope.kind !== "none" && scope.projectRootKey.startsWith("remote:"));
  const remoteContext =
    remote &&
    remoteSurface !== null &&
    (thread === null
      ? remoteDraft && remoteSurface.scope.taskId === undefined
      : thread.execution !== undefined &&
        thread.execution.serverId === remoteSurface.scope.serverId &&
        thread.execution.runnerId === remoteSurface.scope.runnerId &&
        thread.execution.projectId === remoteSurface.scope.projectId &&
        thread.execution.latestTaskId === remoteSurface.scope.taskId)
      ? remoteSurface
      : null;
  const editorDocumentsValue = useContext(EditorPanelDocumentsContext);
  const editorSurfaceActive = layout.activeSurface === "editor";
  const editorDocuments = useMemo(
    () =>
      editorDocumentsValue === null || remote
        ? null
        : { ...editorDocumentsValue, surfaceActive: editorSurfaceActive },
    [editorDocumentsValue, editorSurfaceActive, remote],
  );
  const remoteActiveAvailable =
    layout.activeSurface !== null &&
    isAgentRemoteSurfaceKind(layout.activeSurface) &&
    remoteSurfaceSupports(remoteContext, layout.activeSurface);
  const available = agentSurfaceLocalAvailable({
    remote,
    scope,
    workspaceRoot,
    thread,
    activation: activation?.state,
  });
  const activationNotice = agentSurfaceActivationNotice(activation?.state, scope);
  const unavailable =
    available ||
    remoteActiveAvailable ||
    (remote &&
      (layout.activeSurface === null ||
        (layout.activeSurface === "diff" && thread !== null) ||
        (layout.activeSurface === "git" && isRemoteGitShipThread(thread)))) ? null : (
      <div className="agent-note" role="status">
        {remote
          ? thread === null && layout.activeSurface === "diff"
            ? SURFACE_REMOTE_NO_THREAD_DESCRIPTION
            : SURFACE_REMOTE_UNAVAILABLE_REASON
          : activationNotice.kind === "failed"
            ? activationNotice.message
            : activationNotice.kind === "opening"
              ? "Opening project…"
              : "Select an available project to use this panel."}
        {!remote && activation !== undefined && activationNotice.kind === "failed" && (
          <button className="agent-linkbutton" onClick={activation.retry} type="button">
            Retry
          </button>
        )}
      </div>
    );
  const stableThread = useStableAgentRightPanelThread(thread);
  const fileTree = useAgentSurfaceScopeTree({
    chrome,
    thread: remote ? null : stableThread,
    threadRootPath: remote ? null : threadRootPath,
    scope: remote ? { kind: "none" } : scope,
    filesOpen: available && layout.openSurfaces.includes("files"),
    onSwitchScope,
    onTrustScope,
  });

  const changeSummary = thread?.changeSummary ?? null;
  const hasThread = thread !== null;
  const legacyWorkingTreeDiff = useMemo<AgentSurfaceDiffPanelProps | null>(
    () =>
      !remote || !hasThread
        ? null
        : {
            ...chrome.diff,
            summary: changeSummary,
            onShowChanges: (threadId) => void agents.showChanges(threadId),
            onRefreshChanges: (threadId) => void agents.showChanges(threadId),
            onShowFileDiff: (threadId, change) => void agents.showFileDiff(threadId, change),
            onHideFileDiff: (threadId) => agents.hideFileDiff(threadId),
            onOpenChangedFile: (threadId, change) => void agents.openChangedFile(threadId, change),
            onOpenChangedFileDiff: (threadId, change) =>
              void agents.openChangedFileDiff(threadId, change),
          },
    [agents, changeSummary, chrome.diff, hasThread, remote],
  );

  const terminalChrome = chrome.terminal;
  const terminal = useMemo<AgentSurfaceTerminalPanelProps | null>(() => {
    if (!available) return null;
    if (terminalChrome === null || chrome.workspaceId === null) return null;
    if (workspaceRoot === null) return null;
    if (thread === null && (scope.kind !== "repository" || scope.rootPath !== workspaceRoot))
      return null;
    return {
      workspaceId: chrome.workspaceId,
      workspaceRoot,
      workspaceTrusted: chrome.workspaceTrusted,
      terminalGateway: terminalChrome.terminalGateway,
      terminalTheme: terminalChrome.terminalTheme,
      profileId: null,
      profileLabel: null,
      shellIntegrationEnabled: terminalChrome.shellIntegrationEnabled,
      onTrustWorkspace: chrome.onTrustWorkspace,
      onOpenLink: terminalChrome.onOpenLink,
    };
  }, [
    available,
    chrome.onTrustWorkspace,
    chrome.workspaceId,
    chrome.workspaceTrusted,
    terminalChrome,
    scope,
    thread,
    workspaceRoot,
  ]);

  const historyScope = useMemo(
    () =>
      agentGitHistoryScope(
        projects,
        available ? thread : null,
        available ? scope : { kind: "none" },
        workspaceRoot,
        chrome.workspaceTrusted,
        null,
      ),
    [available, projects, thread, scope, workspaceRoot, chrome.workspaceTrusted],
  );
  const historyRepositories = useMemo(
    () => agentHistoryRepositories(projects, thread, scope, historyScope),
    [projects, thread, scope, historyScope],
  );

  useAgentWorktreeFileChanges({
    project:
      historyScope.kind === "available" && thread !== null
        ? (projects.find((candidate) => candidate.rootKey === thread.thread.owner.rootKey) ?? null)
        : null,
    thread: available ? (thread?.thread ?? null) : null,
    workspaceOwnerKey: chrome.worktreeSync?.workspaceOwnerKey ?? null,
    openWorkspaceRoots: chrome.worktreeSync?.openWorkspaceRoots ?? [],
    gateway: chrome.worktreeSync?.gateway ?? null,
    handleChange: chrome.worktreeSync?.control.refreshDocuments ?? unavailableWorktreeRefresh,
    reportError: chrome.worktreeSync?.control.reportError ?? unavailableWorktreeError,
  });
  const checkout = useMemo(() => {
    const control = chrome.branchCheckout;
    if (control === undefined || control === null) return null;
    return {
      gateway: control.gateway,
      guard: (target: { readonly rootPath: string; readonly ownerKey: string }) => {
        const current = { historyScope, historyRepositories };
        const scopes = [
          current.historyScope,
          ...(current.historyRepositories?.options.map((item) => item.scope) ?? []),
        ];
        if (
          !scopes.some(
            (candidate) =>
              candidate.kind === "available" &&
              candidate.target.rootPath === target.rootPath &&
              candidate.target.ownerKey === target.ownerKey,
          )
        )
          return "This checkout is no longer available. Select it again.";
        return control.guard(target);
      },
    };
  }, [chrome.branchCheckout, historyScope, historyRepositories]);

  const rightPanelContext = useAgentRightPanelContextValue({
    available,
    hidden,
    thread,
    threadRootPath,
    scope,
    workspaceRoot,
    chrome,
    agents,
    openSurfaces: layout.openSurfaces,
    diffScope,
    shipActions,
    checkout,
    historyTarget: historyScope.kind === "available" ? historyScope.target : null,
    scripts,
    legacyWorkingTreeDiff,
    onDiffScopeChange,
    onOpenSurface,
    onCloseSurfaceTab,
  });

  return (
    <div
      aria-hidden={hidden || undefined}
      className={["agent-surface-host", surfaceEnterClass].filter(Boolean).join(" ")}
      data-slot="surface"
      hidden={hidden}
    >
      <AgentRightPanelContext.Provider value={rightPanelContext}>
        <AgentSurfacePanel
          agentsPanel={agentsPanel}
          unavailable={unavailable}
          remote={remote}
          remoteSurface={remoteContext}
          remoteFileReveal={remoteContext === null ? null : remoteFileReveal}
          remoteTerminalTheme={chrome.terminal?.terminalTheme}
          history={{
            scope: historyScope,
            repositories: historyRepositories,
            gateway: chrome.gitHistoryGateway ?? null,
            checkout,
            fileChanges: chrome.fileTree?.fileChanges ?? null,
            ...chrome.diff,
          }}
          chooserAutoFocus={chooserAutoFocus}
          editorDocuments={editorDocuments}
          remoteMonacoTheme={chrome.diff.monacoTheme}
          hidden={hidden}
          fileTree={fileTree}
          layout={layout}
          layoutControls={layoutControls}
          leadingControls={leadingControls}
          onActivateSurface={onActivateSurface}
          onCloseSurfaceTab={onCloseSurfaceTab}
          onOpenSurface={onOpenSurface}
          onResizeStart={chrome.onResizeRightPanelStart}
          onResizeWidth={onResizeWidth}
          onTrustWorkspace={chrome.onTrustWorkspace}
          scope={scope}
          terminal={terminal}
          thread={thread}
          workspaceRoot={workspaceRoot}
          workspaceTrusted={chrome.workspaceTrusted}
        />
      </AgentRightPanelContext.Provider>
    </div>
  );
});

const ignoreDiffScope = (): void => undefined;

const unavailableWorktreeRefresh = async () => undefined;
const unavailableWorktreeError = () => undefined;
