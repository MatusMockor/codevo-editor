import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import type { GitGateway, GitStashEntry } from "../domain/git";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

/**
 * Collaborators the Git Stash panel needs from the workbench shell. Everything
 * here is owned by the shell (the workspace root ref/value, error reporting, the
 * shared status refresh, the status-bar message setter, and the confirm/prompt
 * prompter); the stash list/diff state and its request tokens are owned by this
 * hook so a switched-away tab's late resolve can never repopulate another tab.
 */
export interface GitStashPanelDependencies {
  gitGateway: GitGateway;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  workspaceRoot: string | null;
  reportError: (source: string, error: unknown) => void;
  refreshGitStatus: () => Promise<void>;
  setMessage: (message: string) => void;
  prompter: WorkbenchPrompter;
}

export interface GitStashPanel {
  gitStashPanelOpen: boolean;
  gitStashEntries: GitStashEntry[];
  gitStashLoading: boolean;
  gitStashMessage: string;
  gitStashSelectedIndex: number | null;
  gitStashDiff: string | null;
  gitStashDiffLoading: boolean;
  openGitStashPanel: () => Promise<void>;
  closeGitStashPanel: () => void;
  selectGitStash: (index: number) => Promise<void>;
  saveGitStash: (message: string) => Promise<void>;
  applyGitStash: (index: number) => Promise<void>;
  popGitStash: (index: number) => Promise<void>;
  dropGitStash: (index: number) => Promise<void>;
  setGitStashMessage: Dispatch<SetStateAction<string>>;
}

/**
 * Git Stash (PhpStorm-style WIP) panel state. Lists the repository's stashes
 * and shows the selected stash's diff. Save/apply/pop are reversible; drop is
 * destructive and is gated behind an explicit confirmation in its handler.
 */
export function useGitStashPanel(
  dependencies: GitStashPanelDependencies,
): GitStashPanel {
  const {
    gitGateway,
    currentWorkspaceRootRef,
    workspaceRoot,
    reportError,
    refreshGitStatus,
    setMessage,
    prompter,
  } = dependencies;

  const [gitStashPanelOpen, setGitStashPanelOpen] = useState(false);
  const [gitStashEntries, setGitStashEntries] = useState<GitStashEntry[]>([]);
  const [gitStashLoading, setGitStashLoading] = useState(false);
  const [gitStashMessage, setGitStashMessage] = useState("");
  const [gitStashSelectedIndex, setGitStashSelectedIndex] = useState<
    number | null
  >(null);
  const [gitStashDiff, setGitStashDiff] = useState<string | null>(null);
  const [gitStashDiffLoading, setGitStashDiffLoading] = useState(false);
  // Per-request tokens for the git stash panel: the list-load request and the
  // selected-stash diff request. Bumped on every (re)load so a stale result
  // from a switched-away tab or a superseded request is dropped (per-tab
  // isolation), exactly like the file-history panel.
  const gitStashRequestTokenRef = useRef(0);
  const gitStashDiffRequestTokenRef = useRef(0);

  const closeGitStashPanel = useCallback(() => {
    // Invalidate any in-flight list/diff requests so a late resolve cannot
    // repopulate a closed panel.
    gitStashRequestTokenRef.current += 1;
    gitStashDiffRequestTokenRef.current += 1;
    setGitStashPanelOpen(false);
    setGitStashEntries([]);
    setGitStashLoading(false);
    setGitStashMessage("");
    setGitStashSelectedIndex(null);
    setGitStashDiff(null);
    setGitStashDiffLoading(false);
  }, []);

  // Reloads the stash list for the active workspace. The requested root is
  // captured up front and re-checked (with the request token) after the await
  // so a stale list from a switched-away tab is dropped (per-tab isolation).
  const refreshGitStashes = useCallback(async () => {
    const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;

    if (!requestedRoot) {
      return;
    }

    const requestToken = (gitStashRequestTokenRef.current += 1);
    setGitStashLoading(true);

    const isCurrentRequest = () =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot) &&
      gitStashRequestTokenRef.current === requestToken;

    try {
      const entries = await gitGateway.stashList(requestedRoot);

      if (!isCurrentRequest()) {
        return;
      }

      setGitStashEntries(entries);
    } catch (error) {
      if (!isCurrentRequest()) {
        return;
      }

      setGitStashEntries([]);
      reportError("Git Stash", error);
    } finally {
      if (isCurrentRequest()) {
        setGitStashLoading(false);
      }
    }
  }, [gitGateway, reportError, workspaceRoot]);

  const openGitStashPanel = useCallback(async () => {
    const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;

    if (!requestedRoot) {
      return;
    }

    // Reset any prior selection/diff before the new list loads.
    gitStashDiffRequestTokenRef.current += 1;
    setGitStashMessage("");
    setGitStashSelectedIndex(null);
    setGitStashDiff(null);
    setGitStashDiffLoading(false);
    setGitStashEntries([]);
    setGitStashPanelOpen(true);

    await refreshGitStashes();
  }, [refreshGitStashes, workspaceRoot]);

  // Loads the diff for a selected stash. The requested root and stash index are
  // captured up front; after the await we re-check the active root and the diff
  // request token so a stale diff from a switched-away tab or a superseded
  // selection is dropped (per-tab, per-selection isolation).
  const selectGitStash = useCallback(
    async (index: number) => {
      const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;

      if (!requestedRoot) {
        return;
      }

      const requestToken = (gitStashDiffRequestTokenRef.current += 1);
      setGitStashSelectedIndex(index);
      setGitStashDiffLoading(true);

      const isCurrentRequest = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot) &&
        gitStashDiffRequestTokenRef.current === requestToken;

      try {
        const diff = await gitGateway.stashShow(requestedRoot, index);

        if (!isCurrentRequest()) {
          return;
        }

        setGitStashDiff(diff);
      } catch (error) {
        if (!isCurrentRequest()) {
          return;
        }

        setGitStashDiff(null);
        reportError("Git Stash", error);
      } finally {
        if (isCurrentRequest()) {
          setGitStashDiffLoading(false);
        }
      }
    },
    [gitGateway, reportError, workspaceRoot],
  );

  const saveGitStash = useCallback(
    async (message: string) => {
      const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;
      const trimmed = message.trim();

      if (!requestedRoot || trimmed.length === 0) {
        return;
      }

      setGitStashLoading(true);

      try {
        await gitGateway.stashSave(requestedRoot, trimmed);

        if (
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return;
        }

        setGitStashMessage("");
        setMessage("Stashed working tree changes");
        // Refresh the panel list and the changes panel (the working tree is now
        // clean), both scoped to the requested root.
        await refreshGitStashes();
        await refreshGitStatus();
      } catch (error) {
        if (
          workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          reportError("Git Stash", error);
        }
      } finally {
        if (
          workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          setGitStashLoading(false);
        }
      }
    },
    [gitGateway, refreshGitStashes, refreshGitStatus, reportError, workspaceRoot],
  );

  const applyGitStash = useCallback(
    async (index: number) => {
      const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;

      if (!requestedRoot) {
        return;
      }

      setGitStashLoading(true);

      try {
        await gitGateway.stashApply(requestedRoot, index);

        if (
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return;
        }

        setMessage("Applied stash to working tree");
        await refreshGitStatus();
      } catch (error) {
        if (
          workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          reportError("Git Stash", error);
        }
      } finally {
        if (
          workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          setGitStashLoading(false);
        }
      }
    },
    [gitGateway, refreshGitStatus, reportError, workspaceRoot],
  );

  const popGitStash = useCallback(
    async (index: number) => {
      const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;

      if (!requestedRoot) {
        return;
      }

      setGitStashLoading(true);

      try {
        await gitGateway.stashPop(requestedRoot, index);

        if (
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return;
        }

        setGitStashSelectedIndex(null);
        setGitStashDiff(null);
        setMessage("Popped stash into working tree");
        await refreshGitStashes();
        await refreshGitStatus();
      } catch (error) {
        if (
          workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          reportError("Git Stash", error);
        }
      } finally {
        if (
          workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          setGitStashLoading(false);
        }
      }
    },
    [gitGateway, refreshGitStashes, refreshGitStatus, reportError, workspaceRoot],
  );

  // Dropping a stash is DESTRUCTIVE and irreversible, so it is gated behind an
  // explicit confirmation. The requested root is captured before the confirm and
  // re-checked after the await so a tab switch during the operation never mutates
  // another workspace's panel (per-tab isolation).
  const dropGitStash = useCallback(
    async (index: number) => {
      const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;

      if (!requestedRoot) {
        return;
      }

      if (
        !prompter.confirm(
          "Drop this stash? This permanently discards the stashed changes.",
        )
      ) {
        return;
      }

      setGitStashLoading(true);

      try {
        await gitGateway.stashDrop(requestedRoot, index);

        if (
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return;
        }

        setGitStashSelectedIndex(null);
        setGitStashDiff(null);
        setMessage("Dropped stash");
        await refreshGitStashes();
      } catch (error) {
        if (
          workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          reportError("Git Stash", error);
        }
      } finally {
        if (
          workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          setGitStashLoading(false);
        }
      }
    },
    [gitGateway, prompter, refreshGitStashes, reportError, workspaceRoot],
  );

  return {
    gitStashPanelOpen,
    gitStashEntries,
    gitStashLoading,
    gitStashMessage,
    gitStashSelectedIndex,
    gitStashDiff,
    gitStashDiffLoading,
    openGitStashPanel,
    closeGitStashPanel,
    selectGitStash,
    saveGitStash,
    applyGitStash,
    popGitStash,
    dropGitStash,
    setGitStashMessage,
  };
}
