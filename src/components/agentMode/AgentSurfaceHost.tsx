import { useAgentWorktreeFileChanges } from "../../application/useAgentWorktreeFileChanges";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { agentGitHistoryScope } from "./agentGitHistoryTarget";
import { agentHistoryRepositories } from "./agentHistoryRepositories";
import { memo, useMemo, type ReactNode } from "react";
import type { AgentThreadView, AgentThreadsSurface } from "../../application/agentThreadPorts";
import type { AgentSurfaceKind, AgentWorkbenchLayout } from "../../domain/agentWorkbenchLayout";
import {
  AgentSurfacePanel,
  type AgentSurfaceDiffPanelProps,
  type AgentSurfaceTerminalPanelProps,
} from "./AgentSurfacePanel";
import type { AgentSurfaceScope } from "./agentSurfacePolicy";
import type { AgentWorkbenchChrome } from "./agentWorkbenchChrome";
import { useAgentSurfaceScopeTree } from "./useAgentSurfaceScopeTree";

export type AgentSurfaceHostAgents = Pick<
  AgentThreadsSurface,
  "showChanges" | "showFileDiff" | "hideFileDiff" | "openChangedFile" | "openChangedFileDiff"
>;

export interface AgentSurfaceHostProps {
  readonly chrome: AgentWorkbenchChrome;
  readonly projects?: ReadonlyArray<AgentProjectDescriptor>;
  readonly layout: Pick<AgentWorkbenchLayout, "openSurfaces" | "activeSurface">;
  readonly thread: AgentThreadView | null;
  readonly threadRootPath: string | null;
  readonly scope: AgentSurfaceScope;
  readonly workspaceRoot: string | null;
  readonly agents: AgentSurfaceHostAgents;
  readonly layoutControls: ReactNode;
  readonly hidden: boolean;
  readonly chooserAutoFocus: boolean;
  onOpenSurface(surface: AgentSurfaceKind): void;
  onActivateSurface(surface: AgentSurfaceKind): void;
  onCloseSurfaceTab(surface: AgentSurfaceKind): void;
  onTrustScope(projectRootKey: string): void;
  readonly onSwitchScope: ((rootPath: string) => void) | null;
}

export const AgentSurfaceHost = memo(function AgentSurfaceHost({
  agents,
  chooserAutoFocus,
  chrome,
  hidden,
  layout,
  layoutControls,
  onActivateSurface,
  onCloseSurfaceTab,
  onOpenSurface,
  onSwitchScope,
  onTrustScope,
  projects = [],
  scope,
  thread,
  threadRootPath,
  workspaceRoot,
}: AgentSurfaceHostProps) {
  const fileTree = useAgentSurfaceScopeTree({
    chrome,
    thread,
    threadRootPath,
    scope,
    filesOpen: layout.openSurfaces.includes("files"),
    onSwitchScope,
    onTrustScope,
  });

  const diff = useMemo<AgentSurfaceDiffPanelProps | null>(
    () =>
      thread === null
        ? null
        : {
            ...chrome.diff,
            summary: thread.changeSummary,
            onShowChanges: (threadId) => void agents.showChanges(threadId),
            onRefreshChanges: (threadId) => void agents.showChanges(threadId),
            onShowFileDiff: (threadId, change) => void agents.showFileDiff(threadId, change),
            onHideFileDiff: (threadId) => agents.hideFileDiff(threadId),
            onOpenChangedFile: (threadId, change) => void agents.openChangedFile(threadId, change),
            onOpenChangedFileDiff: (threadId, change) =>
              void agents.openChangedFileDiff(threadId, change),
          },
    [agents, chrome.diff, thread],
  );

  const terminalChrome = chrome.terminal;
  const terminal = useMemo<AgentSurfaceTerminalPanelProps | null>(() => {
    if (terminalChrome === null || chrome.workspaceId === null || thread === null) return null;
    if (workspaceRoot === null) return null;
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
    chrome.onTrustWorkspace,
    chrome.workspaceId,
    chrome.workspaceTrusted,
    terminalChrome,
    thread,
    workspaceRoot,
  ]);

  const historyScope = useMemo(
    () =>
      agentGitHistoryScope(projects, thread, scope, workspaceRoot, chrome.workspaceTrusted, null),
    [projects, thread, scope, workspaceRoot, chrome.workspaceTrusted],
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
    thread: thread?.thread ?? null,
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

  return (
    <div
      aria-hidden={hidden || undefined}
      className="agent-surface-host"
      data-slot="surface"
      hidden={hidden}
    >
      <AgentSurfacePanel
        history={{
          scope: historyScope,
          repositories: historyRepositories,
          gateway: chrome.gitHistoryGateway ?? null,
          checkout,
          fileChanges: chrome.fileTree?.fileChanges ?? null,
          ...chrome.diff,
        }}
        chooserAutoFocus={chooserAutoFocus}
        diff={diff}
        hidden={hidden}
        fileTree={fileTree}
        layout={layout}
        layoutControls={layoutControls}
        onActivateSurface={onActivateSurface}
        onCloseSurfaceTab={onCloseSurfaceTab}
        onOpenSurface={onOpenSurface}
        onResizeStart={chrome.onResizeRightPanelStart}
        onTrustWorkspace={chrome.onTrustWorkspace}
        scope={scope}
        terminal={terminal}
        thread={thread}
        workspaceRoot={workspaceRoot}
        workspaceTrusted={chrome.workspaceTrusted}
      />
    </div>
  );
});

const unavailableWorktreeRefresh = async () => undefined;
const unavailableWorktreeError = () => undefined;
