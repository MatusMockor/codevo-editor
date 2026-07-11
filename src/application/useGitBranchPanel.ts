import { useCallback, useRef, useState, type MutableRefObject } from "react";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import type { GitBranch, GitGateway } from "../domain/git";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

/**
 * Collaborators the Git branch switcher panel needs from the workbench shell.
 * The shell owns the workspace root ref/value, error reporting, the shared
 * status refresh, the status-bar message setter, and the confirm/prompt
 * prompter; the branch list state and its request token are owned by this hook
 * so a switched-away tab's late resolve can never repopulate another tab.
 */
export interface GitBranchPanelDependencies {
  gitGateway: GitGateway;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  workspaceRoot: string | null;
  reportError: (source: string, error: unknown) => void;
  refreshGitStatus: () => Promise<void>;
  setMessage: (message: string) => void;
  prompter: WorkbenchPrompter;
}

export interface GitBranchPanel {
  gitBranchPanelOpen: boolean;
  gitBranchEntries: GitBranch[];
  gitBranchLoading: boolean;
  openGitBranchPanel: () => Promise<void>;
  closeGitBranchPanel: () => void;
  switchGitBranch: (name: string) => Promise<void>;
  createGitBranch: () => Promise<void>;
  deleteGitBranch: (
    name: string,
    options: { force: boolean },
  ) => Promise<void>;
  renameGitBranch: (oldName: string, newName: string) => Promise<void>;
  refreshGitBranches: () => Promise<void>;
}

/**
 * Git branch switcher (PhpStorm-style) panel state. Per-tab isolated like the
 * stash panel: a switched-away tab's late list resolve must never repopulate.
 */
export function useGitBranchPanel(
  dependencies: GitBranchPanelDependencies,
): GitBranchPanel {
  const {
    gitGateway,
    currentWorkspaceRootRef,
    workspaceRoot,
    reportError,
    refreshGitStatus,
    setMessage,
    prompter,
  } = dependencies;

  const [gitBranchPanelOpen, setGitBranchPanelOpen] = useState(false);
  const [gitBranchEntries, setGitBranchEntries] = useState<GitBranch[]>([]);
  const [gitBranchLoading, setGitBranchLoading] = useState(false);
  // Invalidates an in-flight branch list request so a late resolve from a
  // switched-away tab (or a superseded refresh) cannot repopulate the panel.
  const gitBranchRequestTokenRef = useRef(0);
  const gitBranchMutationInFlightRef = useRef(false);

  const closeGitBranchPanel = useCallback(() => {
    // Invalidate any in-flight list request so a late resolve cannot repopulate
    // a closed panel.
    gitBranchRequestTokenRef.current += 1;
    setGitBranchPanelOpen(false);
    setGitBranchEntries([]);
    setGitBranchLoading(false);
  }, []);

  const refreshGitBranches = useCallback(async () => {
    const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;

    if (!requestedRoot) {
      return;
    }

    const requestToken = (gitBranchRequestTokenRef.current += 1);
    setGitBranchLoading(true);

    const isCurrentRequest = () =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot) &&
      gitBranchRequestTokenRef.current === requestToken;

    try {
      const branches = await gitGateway.branchList(requestedRoot);

      if (!isCurrentRequest()) {
        return;
      }

      setGitBranchEntries(branches);
    } catch (error) {
      if (!isCurrentRequest()) {
        return;
      }

      setGitBranchEntries([]);
      reportError("Git Branch", error);
    } finally {
      if (isCurrentRequest()) {
        setGitBranchLoading(false);
      }
    }
  }, [gitGateway, reportError, workspaceRoot]);

  const openGitBranchPanel = useCallback(async () => {
    const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;

    if (!requestedRoot) {
      return;
    }

    setGitBranchEntries([]);
    setGitBranchPanelOpen(true);

    await refreshGitBranches();
  }, [refreshGitBranches, workspaceRoot]);

  const switchGitBranch = useCallback(
    async (name: string) => {
      const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;
      const trimmed = name.trim();

      if (
        !requestedRoot ||
        trimmed.length === 0 ||
        gitBranchMutationInFlightRef.current
      ) {
        return;
      }

      gitBranchMutationInFlightRef.current = true;
      setGitBranchLoading(true);

      try {
        await gitGateway.switchBranch(requestedRoot, trimmed);

        if (
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return;
        }

        setMessage(`Switched to branch ${trimmed}`);
        closeGitBranchPanel();
        // The status-bar branch indicator and the changes panel both read the
        // refreshed status, scoped to the requested root.
        await refreshGitStatus();
      } catch (error) {
        if (
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return;
        }

        // `git switch` (no `-f`/`--discard`) refuses rather than discard local
        // changes. Surface a clear, actionable notice that points the user at
        // the stash workflow; no work was lost.
        reportError(
          "Git Branch",
          new Error(
            "Cannot switch branches with uncommitted changes. Commit or stash your changes first (Git: Stash Changes).",
          ),
        );
      } finally {
        gitBranchMutationInFlightRef.current = false;
        if (
          workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          setGitBranchLoading(false);
        }
      }
    },
    [
      closeGitBranchPanel,
      gitGateway,
      refreshGitStatus,
      reportError,
      workspaceRoot,
    ],
  );

  const createGitBranch = useCallback(async () => {
    const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;

    if (!requestedRoot || gitBranchMutationInFlightRef.current) {
      return;
    }

    const name = prompter.prompt("New branch name", "feature/");

    if (name === null) {
      return;
    }

    const trimmed = name.trim();

    if (trimmed.length === 0) {
      return;
    }

    gitBranchMutationInFlightRef.current = true;
    setGitBranchLoading(true);

    try {
      // `create_branch` validates the name against git's ref grammar and creates
      // the branch WITHOUT switching, so uncommitted work is never touched.
      await gitGateway.createBranch(requestedRoot, trimmed);

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return;
      }

      setMessage(`Created branch ${trimmed}`);
      await refreshGitBranches();
    } catch (error) {
      if (
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        reportError("Git Branch", error);
      }
    } finally {
      gitBranchMutationInFlightRef.current = false;
      if (
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        setGitBranchLoading(false);
      }
    }
  }, [gitGateway, prompter, refreshGitBranches, reportError, workspaceRoot]);

  const deleteGitBranch = useCallback(
    async (name: string, options: { force: boolean }) => {
      const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;
      const trimmed = name.trim();
      const deleteBranch = gitGateway.deleteBranch?.bind(gitGateway);

      if (
        !requestedRoot ||
        trimmed.length === 0 ||
        !deleteBranch ||
        gitBranchMutationInFlightRef.current
      ) {
        return;
      }

      gitBranchMutationInFlightRef.current = true;
      setGitBranchLoading(true);

      try {
        await deleteBranch(requestedRoot, trimmed, options);

        if (
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return;
        }

        setMessage(`Deleted branch ${trimmed}`);
        await refreshGitBranches();
      } catch (error) {
        if (
          workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          reportError("Git Branch", error);
        }
      } finally {
        gitBranchMutationInFlightRef.current = false;
        if (
          workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          setGitBranchLoading(false);
        }
      }
    },
    [gitGateway, refreshGitBranches, reportError, setMessage, workspaceRoot],
  );

  const renameGitBranch = useCallback(
    async (oldName: string, newName: string) => {
      const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;
      const trimmedOldName = oldName.trim();
      const trimmedNewName = newName.trim();
      const renameBranch = gitGateway.renameBranch?.bind(gitGateway);

      if (
        !requestedRoot ||
        trimmedOldName.length === 0 ||
        trimmedNewName.length === 0 ||
        !renameBranch ||
        gitBranchMutationInFlightRef.current
      ) {
        return;
      }

      gitBranchMutationInFlightRef.current = true;
      setGitBranchLoading(true);

      try {
        await renameBranch(requestedRoot, trimmedOldName, trimmedNewName);

        if (
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return;
        }

        setMessage(`Renamed branch ${trimmedOldName} to ${trimmedNewName}`);
        await refreshGitBranches();
        await refreshGitStatus();
      } catch (error) {
        if (
          workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          reportError("Git Branch", error);
        }
      } finally {
        gitBranchMutationInFlightRef.current = false;
        if (
          workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          setGitBranchLoading(false);
        }
      }
    },
    [
      gitGateway,
      refreshGitBranches,
      refreshGitStatus,
      reportError,
      setMessage,
      workspaceRoot,
    ],
  );

  return {
    gitBranchPanelOpen,
    gitBranchEntries,
    gitBranchLoading,
    openGitBranchPanel,
    closeGitBranchPanel,
    switchGitBranch,
    createGitBranch,
    deleteGitBranch,
    renameGitBranch,
    refreshGitBranches,
  };
}
