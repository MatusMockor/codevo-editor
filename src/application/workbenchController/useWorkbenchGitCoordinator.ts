import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { GitChangedFile } from "../../domain/git";
import type { WorkspaceSettings } from "../../domain/settings";
import type { EditorDocument } from "../../domain/workspace";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import { canRevertGitChangeForDocuments } from "../gitRevertCapability";
import { pushGitCommitMessageHistory } from "../../domain/gitCommitMessageHistory";
import { useFileHistory } from "../useFileHistory";
import { useGitBranchPanel } from "../useGitBranchPanel";
import { useGitDiffPreviewCloseLifecycle } from "../useGitDiffPreviewCloseLifecycle";
import { useGitDiffWorkspace } from "../useGitDiffWorkspace";
import { useGitOperationCurrency } from "../useGitOperationCurrency";
import { useGitStashPanel } from "../useGitStashPanel";
import { useGitStatusSurface } from "../useGitStatusSurface";
import { useGitWorkspace } from "../useGitWorkspace";
import { useWorkbenchGitFileActions } from "../useWorkbenchGitFileActions";

type GitDiffWorkspaceDependencies = Parameters<typeof useGitDiffWorkspace>[0];
type GitStatusSurfaceDependencies = Parameters<typeof useGitStatusSurface>[0];

interface WorkbenchGitDiscoveryCoordinatorDependencies {
  diffWorkspace: Omit<GitDiffWorkspaceDependencies, "onDocumentReplaced">;
  statusSurface: Omit<
    GitStatusSurfaceDependencies,
    | "getSelectedGitDiffDocument"
    | "gitOperationCurrency"
    | "gitRepositoryDiscoveryRequestTokenRef"
    | "reconcileSelectedGitDiffPreviewForRepository"
  >;
}

export function useWorkbenchGitDiscoveryCoordinator({
  diffWorkspace,
  statusSurface,
}: WorkbenchGitDiscoveryCoordinatorDependencies) {
  const closeReplacedGitDiffDocumentRef = useRef<(document: EditorDocument) => void>(() => {});
  const closeReplacedGitDiffDocument = useCallback((document: EditorDocument) => {
    closeReplacedGitDiffDocumentRef.current(document);
  }, []);
  const diff = useGitDiffWorkspace({
    ...diffWorkspace,
    onDocumentReplaced: closeReplacedGitDiffDocument,
  });
  const reconcileSelectedGitDiffPreviewForGitStatusSurfaceRef = useRef<
    (repositoryRoot: string, changes: GitChangedFile[]) => void
  >(() => {});
  const reconcileSelectedGitDiffPreviewForGitStatusSurface = useCallback(
    (repositoryRoot: string, changes: GitChangedFile[]) => {
      reconcileSelectedGitDiffPreviewForGitStatusSurfaceRef.current(repositoryRoot, changes);
    },
    [],
  );
  const gitRepositoryDiscoveryRequestTokenRef = useRef(0);
  const gitOperationCurrency = useGitOperationCurrency(diffWorkspace.workspaceRoot);
  const status = useGitStatusSurface({
    ...statusSurface,
    getSelectedGitDiffDocument: diff.getSelectedGitDiffDocument,
    gitOperationCurrency,
    gitRepositoryDiscoveryRequestTokenRef,
    reconcileSelectedGitDiffPreviewForRepository:
      reconcileSelectedGitDiffPreviewForGitStatusSurface,
  });
  const connectDiffPreviewReconciliation = useCallback(
    (reconcile: (repositoryRoot: string, changes: GitChangedFile[]) => void) => {
      reconcileSelectedGitDiffPreviewForGitStatusSurfaceRef.current = reconcile;
    },
    [],
  );

  return {
    ...diff,
    ...status,
    closeReplacedGitDiffDocumentRef,
    connectDiffPreviewReconciliation,
    gitOperationCurrency,
  };
}

type GitDiffPreviewDependencies = Parameters<typeof useGitDiffPreviewCloseLifecycle>[0];
type GitWorkspaceDependencies = Parameters<typeof useGitWorkspace>[0];

interface WorkbenchGitChangesCoordinatorDependencies {
  connectDiffPreviewReconciliation: (
    reconcile: (repositoryRoot: string, changes: GitChangedFile[]) => void,
  ) => void;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  diffPreview: GitDiffPreviewDependencies;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  gitWorkspace: Omit<
    GitWorkspaceDependencies,
    "canRevertGitChange" | "gitCommitMessageHistory" | "recordGitCommitMessage"
  >;
  persistWorkspaceSettings: (rootPath: string, settings: WorkspaceSettings) => Promise<void>;
  reportErrorForActiveWorkspaceRoot: (rootPath: string, source: string, error: unknown) => void;
  workspaceSettings: WorkspaceSettings;
  workspaceSettingsRef: MutableRefObject<WorkspaceSettings>;
}

export function useWorkbenchGitChangesCoordinator({
  connectDiffPreviewReconciliation,
  currentWorkspaceRootRef,
  diffPreview,
  documentsRef,
  gitWorkspace,
  persistWorkspaceSettings,
  reportErrorForActiveWorkspaceRoot,
  workspaceSettings,
  workspaceSettingsRef,
}: WorkbenchGitChangesCoordinatorDependencies) {
  const { closeGitDiffPreview, reconcileSelectedGitDiffPreviewForRepository } =
    useGitDiffPreviewCloseLifecycle(diffPreview);
  connectDiffPreviewReconciliation(reconcileSelectedGitDiffPreviewForRepository);

  const recordGitCommitMessage = useCallback(
    async (requestedRoot: string, commitMessage: string) => {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      const currentSettings = workspaceSettingsRef.current;
      const gitCommitMessageHistory = pushGitCommitMessageHistory(
        currentSettings.gitCommitMessageHistory,
        commitMessage,
      );

      if (gitCommitMessageHistory === currentSettings.gitCommitMessageHistory) {
        return;
      }

      try {
        await persistWorkspaceSettings(requestedRoot, {
          ...currentSettings,
          gitCommitMessageHistory,
        });
      } catch (error) {
        reportErrorForActiveWorkspaceRoot(requestedRoot, "Settings", error);
      }
    },
    [
      currentWorkspaceRootRef,
      persistWorkspaceSettings,
      reportErrorForActiveWorkspaceRoot,
      workspaceSettingsRef,
    ],
  );
  const canRevertGitChange = useCallback(
    (change: GitChangedFile) => canRevertGitChangeForDocuments(change, documentsRef.current),
    [documentsRef],
  );
  const workspace = useGitWorkspace({
    ...gitWorkspace,
    canRevertGitChange,
    gitCommitMessageHistory: workspaceSettings.gitCommitMessageHistory,
    recordGitCommitMessage,
  });

  return {
    ...workspace,
    canRevertGitChange,
    closeGitDiffPreview,
  };
}

type FileHistoryDependencies = Parameters<typeof useFileHistory>[0];
type GitFileActionsDependencies = Parameters<typeof useWorkbenchGitFileActions>[0];

interface WorkbenchGitHistoryCoordinatorDependencies {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  fileActions: Omit<GitFileActionsDependencies, "openFileHistory">;
  fileHistory: FileHistoryDependencies;
  refreshGitStatus: () => Promise<void>;
  setMessage: (message: string) => void;
  workspaceRequestTokenRef: MutableRefObject<number>;
}

export function useWorkbenchGitHistoryCoordinator({
  currentWorkspaceRootRef,
  fileActions,
  fileHistory,
  refreshGitStatus,
  setMessage,
  workspaceRequestTokenRef,
}: WorkbenchGitHistoryCoordinatorDependencies) {
  const history = useFileHistory(fileHistory);
  const actions = useWorkbenchGitFileActions({
    ...fileActions,
    openFileHistory: history.openFileHistory,
  });
  const { revealCommitInFileHistory } = actions;
  const revertSelectedGitCommit = useCallback(() => {
    window.dispatchEvent(new CustomEvent("mockor-revert-selected-git-commit"));
  }, []);
  const cherryPickSelectedGitCommit = useCallback(() => {
    window.dispatchEvent(new CustomEvent("mockor-cherry-pick-selected-git-commit"));
  }, []);
  const rewordSelectedGitCommit = useCallback(() => {
    window.dispatchEvent(new CustomEvent("mockor-reword-selected-git-commit"));
  }, []);
  const canRewordSelectedGitCommit = useCallback(() => {
    const detail = { enabled: false };
    window.dispatchEvent(new CustomEvent("mockor-query-reword-selected-git-commit", { detail }));
    return detail.enabled;
  }, []);

  useGitCommitRefresh("mockor-git-commit-reverted", "Reverted", {
    currentWorkspaceRootRef,
    refreshGitStatus,
    setMessage,
    workspaceRequestTokenRef,
  });
  useGitCommitRefresh("mockor-git-commit-cherry-picked", "Cherry-picked", {
    currentWorkspaceRootRef,
    refreshGitStatus,
    setMessage,
    workspaceRequestTokenRef,
  });
  useGitCommitRefresh("mockor-git-commit-reworded", "Reworded", {
    currentWorkspaceRootRef,
    refreshGitStatus,
    setMessage,
    workspaceRequestTokenRef,
  });

  useEffect(() => {
    const reveal = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: unknown; sha?: unknown }>).detail;

      if (typeof detail?.path !== "string" || typeof detail.sha !== "string") {
        return;
      }

      void revealCommitInFileHistory(detail.path, detail.sha);
    };

    window.addEventListener("mockor-reveal-git-blame-commit", reveal);

    return () => {
      window.removeEventListener("mockor-reveal-git-blame-commit", reveal);
    };
  }, [revealCommitInFileHistory]);

  return {
    ...history,
    ...actions,
    canRewordSelectedGitCommit,
    cherryPickSelectedGitCommit,
    revertSelectedGitCommit,
    rewordSelectedGitCommit,
  };
}

interface GitCommitRefreshDependencies {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  refreshGitStatus: () => Promise<void>;
  setMessage: (message: string) => void;
  workspaceRequestTokenRef: MutableRefObject<number>;
}

function useGitCommitRefresh(
  eventName: string,
  verb: string,
  {
    currentWorkspaceRootRef,
    refreshGitStatus,
    setMessage,
    workspaceRequestTokenRef,
  }: GitCommitRefreshDependencies,
) {
  useEffect(() => {
    const listener = (event: Event) => {
      void refreshGitStatusAfterCommitEvent(event, verb, {
        currentWorkspaceRootRef,
        refreshGitStatus,
        setMessage,
        workspaceRequestTokenRef,
      });
    };

    window.addEventListener(eventName, listener);

    return () => {
      window.removeEventListener(eventName, listener);
    };
  }, [
    currentWorkspaceRootRef,
    eventName,
    refreshGitStatus,
    setMessage,
    verb,
    workspaceRequestTokenRef,
  ]);
}

export async function refreshGitStatusAfterCommitEvent(
  event: Event,
  verb: string,
  {
    currentWorkspaceRootRef,
    refreshGitStatus,
    setMessage,
    workspaceRequestTokenRef,
  }: GitCommitRefreshDependencies,
): Promise<void> {
  const detail = (event as CustomEvent<{ rootPath?: unknown; subject?: unknown }>).detail;

  if (
    typeof detail?.rootPath !== "string" ||
    typeof detail.subject !== "string" ||
    !workspaceRootKeysEqual(currentWorkspaceRootRef.current, detail.rootPath)
  ) {
    return;
  }

  const requestedRoot = detail.rootPath;
  const requestedWorkspaceToken = workspaceRequestTokenRef.current;
  await refreshGitStatus();

  if (
    !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot) ||
    workspaceRequestTokenRef.current !== requestedWorkspaceToken
  ) {
    return;
  }

  setMessage(`${verb} commit: ${detail.subject}`);
}

type GitStashPanelDependencies = Parameters<typeof useGitStashPanel>[0];
type GitBranchPanelDependencies = Parameters<typeof useGitBranchPanel>[0];

interface WorkbenchGitPanelsCoordinatorDependencies {
  branchPanel: GitBranchPanelDependencies;
  stashPanel: GitStashPanelDependencies;
}

export function useWorkbenchGitPanelsCoordinator({
  branchPanel,
  stashPanel,
}: WorkbenchGitPanelsCoordinatorDependencies) {
  const stash = useGitStashPanel(stashPanel);
  const branch = useGitBranchPanel(branchPanel);

  return { ...stash, ...branch };
}
