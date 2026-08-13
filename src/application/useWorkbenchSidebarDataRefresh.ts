import { useEffect } from "react";
import type { IndexProgressState } from "../domain/indexProgress";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export interface WorkbenchSidebarDataRefreshOptions {
  readonly sidebarView: string;
  readonly indexProgress: IndexProgressState;
  readonly workspaceRoot: string | null;
  refreshPhpTree(): Promise<unknown> | void;
  refreshGitStatus(): Promise<unknown> | void;
}

export function useWorkbenchSidebarDataRefresh(options: WorkbenchSidebarDataRefreshOptions): void {
  const { indexProgress, refreshGitStatus, refreshPhpTree, sidebarView, workspaceRoot } = options;

  useEffect(() => {
    if (sidebarView !== "php") {
      return;
    }

    if (indexProgress.rootPath && !workspaceRootKeysEqual(indexProgress.rootPath, workspaceRoot)) {
      return;
    }

    void refreshPhpTree();
  }, [
    indexProgress.indexedFiles,
    indexProgress.rootPath,
    indexProgress.status,
    refreshPhpTree,
    sidebarView,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (sidebarView !== "git") {
      return;
    }

    void refreshGitStatus();
  }, [refreshGitStatus, sidebarView, workspaceRoot]);
}
