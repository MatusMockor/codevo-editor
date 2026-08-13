import type { PointerEvent as ReactPointerEvent } from "react";
import type { useWorkbenchController } from "../application/useWorkbenchController";
import type { GitChangeStatus } from "../domain/git";
import { WorkbenchActivityBar } from "./WorkbenchActivityBar";
import { WorkbenchSidebar } from "./WorkbenchSidebar";

interface WorkbenchNavigationChromeProps {
  readonly activeFileRevealSignal: number;
  readonly fileStatusesByPath: Record<string, GitChangeStatus>;
  readonly workbench: ReturnType<typeof useWorkbenchController>;
  onOpenSettings(): void;
  onOpenWorkspace(): void;
  onResizeStart(event: ReactPointerEvent<HTMLDivElement>): void;
  onShowCommands(): void;
  onShowGit(): void;
  onShowGitHistory(): void;
  onShowTodoPanel(): void;
}

export function WorkbenchNavigationChrome({
  activeFileRevealSignal,
  fileStatusesByPath,
  onOpenSettings,
  onOpenWorkspace,
  onResizeStart,
  onShowCommands,
  onShowGit,
  onShowGitHistory,
  onShowTodoPanel,
  workbench,
}: WorkbenchNavigationChromeProps) {
  if (workbench.agentModeActive) return null;

  return (
    <>
      <WorkbenchActivityBar
        hasWorkspace={!!workbench.workspaceRoot}
        onOpenSettings={onOpenSettings}
        onOpenWorkspace={onOpenWorkspace}
        onShowCommands={onShowCommands}
        onShowGitHistory={onShowGitHistory}
        onShowTodoPanel={onShowTodoPanel}
      />
      <WorkbenchSidebar
        activeFileRevealSignal={activeFileRevealSignal}
        fileStatusesByPath={fileStatusesByPath}
        onOpenWorkspace={onOpenWorkspace}
        onResizeStart={onResizeStart}
        onShowGit={onShowGit}
        workbench={workbench}
      />
    </>
  );
}
