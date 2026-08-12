import { RefreshCw } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { useWorkbenchController } from "../application/useWorkbenchController";
import type { GitChangeStatus } from "../domain/git";
import { AgentsPanel } from "./AgentsPanel";
import { FileTree } from "./FileTree";
import { GitChangesPanel } from "./GitChangesPanel";
import { PhpTreePanel } from "./PhpTreePanel";
import { WorkbenchScriptsTasksPanel } from "./WorkbenchScriptsTasksPanel";

interface WorkbenchSidebarProps {
  readonly activeFileRevealSignal: number;
  readonly fileStatusesByPath: Record<string, GitChangeStatus>;
  readonly workbench: ReturnType<typeof useWorkbenchController>;
  onOpenWorkspace(): void;
  onResizeStart(event: ReactPointerEvent<HTMLDivElement>): void;
  onShowGit(): void;
}

export function WorkbenchSidebar({
  activeFileRevealSignal,
  fileStatusesByPath,
  onOpenWorkspace,
  onResizeStart,
  onShowGit,
  workbench,
}: WorkbenchSidebarProps) {
  return (
    <section className="sidebar">
      <header className="sidebar-header">
        <div className="sidebar-tabs" role="tablist" aria-label="Sidebar views">
          {(["files", "git", "php", "scripts", "agents"] as const).map((view) => (
            <button
              aria-selected={workbench.sidebarView === view}
              className={workbench.sidebarView === view ? "sidebar-tab active" : "sidebar-tab"}
              disabled={view !== "files" && !workbench.workspaceRoot}
              key={view}
              onClick={view === "git" ? onShowGit : () => workbench.setSidebarView(view)}
              role="tab"
              type="button"
            >
              {view === "php" ? "PHP" : `${view[0]?.toUpperCase()}${view.slice(1)}`}
            </button>
          ))}
        </div>
        {workbench.sidebarView === "php" ? (
          <button
            disabled={!workbench.workspaceRoot || workbench.phpTreeLoading}
            onClick={workbench.refreshPhpTree}
            title="Refresh PHP tree"
            type="button"
          >
            <RefreshCw aria-hidden="true" size={14} />
          </button>
        ) : workbench.sidebarView === "files" ? (
          <button onClick={onOpenWorkspace} type="button">
            Open
          </button>
        ) : null}
      </header>
      {workbench.sidebarView === "scripts" ? (
        <WorkbenchScriptsTasksPanel
          nodePackageScripts={{
            available: workbench.nodePackageScripts.available,
            error: workbench.nodePackageScripts.error,
            loading: workbench.nodePackageScripts.loading,
            onOpen: (script) => void workbench.openNodePackageScript(script),
            onRefresh: () => void workbench.nodePackageScripts.refresh(),
            onRun: workbench.nodePackageScripts.run,
            onStop: workbench.nodePackageScripts.stop,
            pending: workbench.nodePackageScripts.pending,
            scripts: workbench.nodePackageScripts.scripts,
            task: workbench.nodePackageScripts.task,
            total: workbench.nodePackageScripts.total,
            truncated: workbench.nodePackageScripts.truncated,
          }}
          vscodeProcessTasks={workbench.vscodeProcessTasks}
        />
      ) : workbench.sidebarView === "git" ? (
        <GitChangesPanel
          activeChange={workbench.selectedGitChange}
          amendEnabled={workbench.gitAmendEnabled}
          commitMessage={workbench.gitCommitMessage}
          commitMessageHistory={workbench.gitCommitMessageHistory}
          gitOperationLoading={workbench.gitOperationLoading}
          includedChangePaths={workbench.includedGitChangePaths}
          isLoading={workbench.gitLoading}
          onCommit={workbench.commitGitChanges}
          onAmend={workbench.amendGitChanges}
          onAmendEnabledChange={workbench.setGitAmendEnabled}
          onCommitAndPush={workbench.commitAndPushGitChanges}
          onCommitMessageChange={workbench.setGitCommitMessage}
          onOpenChange={workbench.openGitChange}
          onPreviewChange={(change, repositoryRoot) =>
            workbench.previewGitChange(change, { repositoryRoot })
          }
          onRefresh={workbench.refreshGitStatus}
          onRevertChanges={workbench.revertGitChanges}
          onStageChanges={workbench.stageGitChanges}
          onToggleChangeIncluded={workbench.toggleGitChangeIncluded}
          onUnstageChanges={workbench.unstageGitChanges}
          repositoryStatuses={workbench.gitRepositoryStatuses}
          rootPath={workbench.workspaceRoot}
          status={workbench.gitStatus}
          workspaceRoot={workbench.workspaceRoot}
        />
      ) : workbench.sidebarView === "agents" ? (
        <AgentsPanel
          agents={workbench.agents}
          repositories={workbench.agents.repositories}
          workspaceRoot={workbench.workspaceRoot}
        />
      ) : workbench.sidebarView === "php" ? (
        <PhpTreePanel
          activePath={workbench.activePath}
          expandedNodeIds={workbench.phpTreeExpandedNodeIds}
          isLoading={workbench.phpTreeLoading}
          onOpenNode={workbench.openPhpTreeNode}
          onToggleNode={workbench.togglePhpTreeNode}
          rootPath={workbench.workspaceRoot}
          tree={workbench.phpTree}
        />
      ) : (
        <FileTree
          activePath={workbench.activePath}
          fileStatusesByPath={fileStatusesByPath}
          entriesByDirectory={workbench.entriesByDirectory}
          expandedDirectories={workbench.expandedDirectories}
          failedDirectories={workbench.failedDirectories}
          loadingDirectories={workbench.loadingDirectories}
          onOpenFile={workbench.openPinnedFile}
          onPreviewFile={workbench.previewFile}
          onOpenEntryInTerminal={workbench.openEntryInTerminal}
          onRenameEntry={workbench.renameEntry}
          onRevealEntry={workbench.revealEntry}
          onRetryDirectory={workbench.retryDirectory}
          onToggleDirectory={workbench.toggleDirectory}
          onPrefetchFile={workbench.prefetchFile}
          onCancelPrefetchFile={workbench.cancelFilePrefetch}
          revealActivePath={workbench.workspaceSettings.revealActiveFileInTree}
          revealActivePathSignal={activeFileRevealSignal}
          rootPath={workbench.workspaceRoot}
        />
      )}
      <div
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        className="sidebar-resize-handle"
        onPointerDown={onResizeStart}
        role="separator"
      />
    </section>
  );
}
