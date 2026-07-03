import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
} from "react";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import {
  gitChangeKey,
  type GitChangedFile,
  type GitDiffHunk,
  type GitGateway,
  type GitStatus,
} from "../domain/git";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

/**
 * Git staging / commit / hunk operations for the active workspace's Changes
 * panel. This hook owns the commit-panel-local state (the commit message, the
 * set of included change keys, and the operation-in-flight flag) and the
 * staging/unstaging/hunk/revert/commit/push handlers plus the two reconciling
 * effects that keep the included set and the commit panel consistent as the
 * status and the active workspace change. Every handler captures the requested
 * root up front and re-checks the active root after each await so a switched-away
 * tab's late resolve can never mutate another tab's panel (per-tab isolation).
 *
 * The git STATUS/DIFF-PREVIEW surface (refreshGitStatus, previewGitChange,
 * closeGitDiffPreview, the editor gutter baselines, and the shared gitStatus /
 * selectedGitChange / gitDiffPreview state) stays in the workbench shell: it
 * drives the editor tab lifecycle (documents/openPaths/previewPath/activePath)
 * and is consumed by non-git editor flows, so it is not cleanly git-owned.
 * `applyGitOperationStatus` is the seam the shell exposes so a completed git
 * operation can publish its fresh status and close a now-stale diff preview.
 *
 * TODO(multi-repo, G4): today every operation targets the single `workspaceRoot`.
 * When directory mappings land, the repository root will be resolved per change
 * / per relativePath through `gitRepositoryMapping.ts`, and `gitStatus` will
 * become a per-repo map. The `requestedRoot` derivations, the per-hunk
 * relativePath routing, and `runGitCommit`'s change grouping are the sites that
 * will switch from the flat root to the resolver. They are marked inline below.
 */
export interface GitWorkspaceDependencies {
  gitGateway: GitGateway;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  workspaceRoot: string | null;
  // Read by runGitCommit (to pick the included changes) and by the reconciling
  // effect (to prune stale included keys). Owned by the shell; the diff-preview
  // surface writes it. TODO(multi-repo, G4): becomes a per-repo status map.
  gitStatus: GitStatus;
  // Publishes a fresh status after an operation and closes a now-stale diff
  // preview. Lives in the shell because it touches the editor tab lifecycle.
  applyGitOperationStatus: (status: GitStatus) => void;
  reportError: (source: string, error: unknown) => void;
  setMessage: (message: string | null) => void;
  prompter: WorkbenchPrompter;
}

export interface GitWorkspace {
  gitCommitMessage: string;
  includedGitChangePaths: Set<string>;
  gitOperationLoading: boolean;
  setGitCommitMessage: Dispatch<SetStateAction<string>>;
  toggleGitChangeIncluded: (change: GitChangedFile) => void;
  stageGitChanges: (changes: GitChangedFile[]) => Promise<void>;
  unstageGitChanges: (changes: GitChangedFile[]) => Promise<void>;
  loadGitFileHunks: (
    relativePath: string,
    staged: boolean,
  ) => Promise<GitDiffHunk[]>;
  stageGitHunk: (relativePath: string, hunkIndex: number) => Promise<void>;
  unstageGitHunk: (relativePath: string, hunkIndex: number) => Promise<void>;
  revertGitChanges: (changes: GitChangedFile[]) => Promise<void>;
  runGitCommit: (options: { pushAfterCommit: boolean }) => Promise<void>;
  commitGitChanges: () => Promise<void>;
  commitAndPushGitChanges: () => Promise<void>;
}

export function useGitWorkspace(
  dependencies: GitWorkspaceDependencies,
): GitWorkspace {
  const {
    gitGateway,
    currentWorkspaceRootRef,
    workspaceRoot,
    gitStatus,
    applyGitOperationStatus,
    reportError,
    setMessage,
    prompter,
  } = dependencies;

  const [gitOperationLoading, setGitOperationLoading] = useState(false);
  const [gitCommitMessage, setGitCommitMessage] = useState("");
  const [includedGitChangePaths, setIncludedGitChangePaths] = useState<
    Set<string>
  >(new Set());

  const toggleGitChangeIncluded = useCallback((change: GitChangedFile) => {
    setIncludedGitChangePaths((current) => {
      const next = new Set(current);

      const changeKey = gitChangeKey(change);

      if (next.has(changeKey)) {
        next.delete(changeKey);
      } else {
        next.add(changeKey);
      }

      return next;
    });
  }, []);

  const stageGitChanges = useCallback(
    async (changes: GitChangedFile[]) => {
      if (!workspaceRoot || changes.length === 0) {
        return;
      }

      // TODO(multi-repo, G4): resolve the repo root per change via the mapping
      // resolver instead of the flat workspaceRoot.
      const requestedRoot = workspaceRoot;
      setGitOperationLoading(true);

      try {
        const status = await gitGateway.stageFiles(requestedRoot, changes);

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        applyGitOperationStatus(status);
        setMessage(null);
      } catch (error) {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          reportError("Git", error);
        }
      } finally {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          setGitOperationLoading(false);
        }
      }
    },
    [applyGitOperationStatus, gitGateway, reportError, workspaceRoot],
  );

  const unstageGitChanges = useCallback(
    async (changes: GitChangedFile[]) => {
      if (!workspaceRoot || changes.length === 0) {
        return;
      }

      // TODO(multi-repo, G4): resolve the repo root per change via the mapping
      // resolver instead of the flat workspaceRoot.
      const requestedRoot = workspaceRoot;
      setGitOperationLoading(true);

      try {
        const status = await gitGateway.unstageFiles(requestedRoot, changes);

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        applyGitOperationStatus(status);
        setMessage(null);
      } catch (error) {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          reportError("Git", error);
        }
      } finally {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          setGitOperationLoading(false);
        }
      }
    },
    [applyGitOperationStatus, gitGateway, reportError, workspaceRoot],
  );

  const loadGitFileHunks = useCallback(
    async (relativePath: string, staged: boolean): Promise<GitDiffHunk[]> => {
      if (!workspaceRoot) {
        return [];
      }

      // TODO(multi-repo, G4): resolve the repo root from relativePath via the
      // mapping resolver instead of the flat workspaceRoot.
      const requestedRoot = workspaceRoot;

      try {
        const hunks = await gitGateway.getFileHunks(
          requestedRoot,
          relativePath,
          staged,
        );

        // Drop stale results: the active workspace may have changed while the
        // diff resolved (per-tab isolation).
        if (
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return [];
        }

        return hunks;
      } catch (error) {
        if (
          workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          reportError("Git", error);
        }

        return [];
      }
    },
    [gitGateway, reportError, workspaceRoot],
  );

  const stageGitHunk = useCallback(
    async (relativePath: string, hunkIndex: number) => {
      if (!workspaceRoot) {
        return;
      }

      // TODO(multi-repo, G4): resolve the repo root from relativePath via the
      // mapping resolver instead of the flat workspaceRoot.
      const requestedRoot = workspaceRoot;
      setGitOperationLoading(true);

      try {
        const status = await gitGateway.stageHunk(
          requestedRoot,
          relativePath,
          hunkIndex,
        );

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        applyGitOperationStatus(status);
        setMessage(`Staged hunk in ${relativePath}`);
      } catch (error) {
        // A rejected patch (stale hunk / already staged) fails atomically on
        // the Rust side - the index is untouched, so this is a safe no-op.
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          reportError("Git", error);
        }
      } finally {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          setGitOperationLoading(false);
        }
      }
    },
    [applyGitOperationStatus, gitGateway, reportError, workspaceRoot],
  );

  const unstageGitHunk = useCallback(
    async (relativePath: string, hunkIndex: number) => {
      if (!workspaceRoot) {
        return;
      }

      // TODO(multi-repo, G4): resolve the repo root from relativePath via the
      // mapping resolver instead of the flat workspaceRoot.
      const requestedRoot = workspaceRoot;
      setGitOperationLoading(true);

      try {
        const status = await gitGateway.unstageHunk(
          requestedRoot,
          relativePath,
          hunkIndex,
        );

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        applyGitOperationStatus(status);
        setMessage(`Unstaged hunk in ${relativePath}`);
      } catch (error) {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          reportError("Git", error);
        }
      } finally {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          setGitOperationLoading(false);
        }
      }
    },
    [applyGitOperationStatus, gitGateway, reportError, workspaceRoot],
  );

  const revertGitChanges = useCallback(
    async (changes: GitChangedFile[]) => {
      if (!workspaceRoot || changes.length === 0) {
        return;
      }

      if (!prompter.confirm("Revert selected Git changes? This discards local changes.")) {
        return;
      }

      // TODO(multi-repo, G4): resolve the repo root per change via the mapping
      // resolver instead of the flat workspaceRoot.
      const requestedRoot = workspaceRoot;
      setGitOperationLoading(true);

      try {
        const status = await gitGateway.revertFiles(requestedRoot, changes);

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        applyGitOperationStatus(status);
        setMessage(null);
      } catch (error) {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          reportError("Git", error);
        }
      } finally {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          setGitOperationLoading(false);
        }
      }
    },
    [applyGitOperationStatus, gitGateway, prompter, reportError, workspaceRoot],
  );

  const runGitCommit = useCallback(
    async ({ pushAfterCommit }: { pushAfterCommit: boolean }) => {
      if (!workspaceRoot) {
        return;
      }

      const message = gitCommitMessage.trim();
      // TODO(multi-repo, G4): the included changes may span multiple repos;
      // group by resolved repo root and commit each group instead of one root.
      const changesToCommit = gitStatus.changes.filter((change) =>
        includedGitChangePaths.has(gitChangeKey(change)),
      );

      if (!message || changesToCommit.length === 0) {
        return;
      }

      const requestedRoot = workspaceRoot;
      setGitOperationLoading(true);

      try {
        if (changesToCommit.some((change) => !change.isStaged)) {
          await gitGateway.stageFiles(requestedRoot, changesToCommit);

          if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
            return;
          }
        }

        const commitStatus = await gitGateway.commit(
          requestedRoot,
          message,
          changesToCommit,
        );

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          return;
        }

        applyGitOperationStatus(commitStatus);
        setIncludedGitChangePaths(new Set());
        setGitCommitMessage("");
        setMessage(pushAfterCommit ? "Commit created. Pushing..." : null);

        if (!pushAfterCommit) {
          return;
        }

        try {
          const pushStatus = await gitGateway.push(requestedRoot);

          if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
            return;
          }

          applyGitOperationStatus(pushStatus);
          setMessage("Pushed current branch");
        } catch (error) {
          if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
            reportError("Git Push", error);
          }
        }
      } catch (error) {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          reportError("Git", error);
        }
      } finally {
        if (workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
          setGitOperationLoading(false);
        }
      }
    },
    [
      applyGitOperationStatus,
      gitCommitMessage,
      gitGateway,
      gitStatus.changes,
      includedGitChangePaths,
      reportError,
      workspaceRoot,
    ],
  );

  const commitGitChanges = useCallback(
    async () => runGitCommit({ pushAfterCommit: false }),
    [runGitCommit],
  );

  const commitAndPushGitChanges = useCallback(
    async () => runGitCommit({ pushAfterCommit: true }),
    [runGitCommit],
  );

  // Reconcile the included set whenever the status changes: keep every staged
  // change auto-included and drop keys whose change no longer exists. Bails out
  // (returns the same Set) when nothing changed so it never triggers a needless
  // re-render.
  useEffect(() => {
    setIncludedGitChangePaths((current) => {
      const validKeys = new Set(gitStatus.changes.map(gitChangeKey));
      const next = new Set<string>();

      gitStatus.changes.forEach((change) => {
        const changeKey = gitChangeKey(change);

        if (change.isStaged || current.has(changeKey)) {
          next.add(changeKey);
        }
      });

      current.forEach((changeKey) => {
        if (validKeys.has(changeKey)) {
          next.add(changeKey);
        }
      });

      if (
        next.size === current.size &&
        [...next].every((path) => current.has(path))
      ) {
        return current;
      }

      return next;
    });
  }, [gitStatus.changes]);

  // On workspace switch, reset the commit panel so a switched-to tab never
  // inherits another workspace's draft message / selection / in-flight flag.
  useEffect(() => {
    setGitOperationLoading(false);
    setGitCommitMessage("");
    setIncludedGitChangePaths(new Set());
  }, [workspaceRoot]);

  return {
    gitCommitMessage,
    includedGitChangePaths,
    gitOperationLoading,
    setGitCommitMessage,
    toggleGitChangeIncluded,
    stageGitChanges,
    unstageGitChanges,
    loadGitFileHunks,
    stageGitHunk,
    unstageGitHunk,
    revertGitChanges,
    runGitCommit,
    commitGitChanges,
    commitAndPushGitChanges,
  };
}
