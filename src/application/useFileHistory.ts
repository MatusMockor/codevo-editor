import {
  useCallback,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type {
  GitFileDiff,
  GitFileHistoryEntry,
  GitGateway,
} from "../domain/git";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

/**
 * Resolves the git repository (and in-repo path) that owns an absolute file
 * path. Shared with the editor gutter-diff baseline and git-blame, so it stays
 * shell-owned rather than being duplicated here; this hook only consumes it.
 */
export type ResolveGitRepositoryTarget = (
  absolutePath: string,
) => { repositoryRoot: string; relativePath: string } | null;

/**
 * Collaborators the git File History panel needs from the workbench shell.
 * The workspace root ref/value, the active document ref, error reporting, and
 * the shared repository-target resolver are all shell-owned (the resolver is
 * shared with the gutter-diff baseline and git-blame); every piece of
 * file-history-panel-local state (the panel state, its request tokens, and the
 * per-file repository-root tracking) is owned by this hook.
 */
export interface FileHistoryDependencies {
  gitGateway: GitGateway;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  workspaceRoot: string | null;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  resolveGitRepositoryTarget: ResolveGitRepositoryTarget;
  reportError: (source: string, error: unknown) => void;
}

export interface FileHistoryPanel {
  fileHistoryPanelOpen: boolean;
  fileHistoryRelativePath: string | null;
  fileHistoryCommits: GitFileHistoryEntry[];
  fileHistoryLoading: boolean;
  fileHistorySelectedSha: string | null;
  fileHistoryDiff: GitFileDiff | null;
  fileHistoryDiffLoading: boolean;
  openFileHistory: () => Promise<void>;
  selectFileHistoryCommit: (sha: string) => Promise<void>;
  closeFileHistory: () => void;
}

/**
 * Git File History (PhpStorm-style) panel: lists the commits that touched the
 * active file and shows the diff for a selected commit. Routed into the
 * repository that owns the file (its nested repo for a directory-mapping
 * file), so both the history list and per-commit diffs run against the
 * correct repository. Per-tab isolated: a switched-away tab's late resolve
 * (list or commit diff) can never repopulate another tab's panel.
 */
export function useFileHistory(
  dependencies: FileHistoryDependencies,
): FileHistoryPanel {
  const {
    gitGateway,
    currentWorkspaceRootRef,
    workspaceRoot,
    activeDocumentRef,
    resolveGitRepositoryTarget,
    reportError,
  } = dependencies;

  const [fileHistoryPanelOpen, setFileHistoryPanelOpen] = useState(false);
  const [fileHistoryRelativePath, setFileHistoryRelativePath] = useState<
    string | null
  >(null);
  const [fileHistoryCommits, setFileHistoryCommits] = useState<
    GitFileHistoryEntry[]
  >([]);
  const [fileHistoryLoading, setFileHistoryLoading] = useState(false);
  const [fileHistorySelectedSha, setFileHistorySelectedSha] = useState<
    string | null
  >(null);
  const [fileHistoryDiff, setFileHistoryDiff] = useState<GitFileDiff | null>(
    null,
  );
  const [fileHistoryDiffLoading, setFileHistoryDiffLoading] = useState(false);
  const fileHistoryRequestTokenRef = useRef(0);
  const fileHistoryDiffRequestTokenRef = useRef(0);
  // Mirrors the file currently shown in the history panel. Read by
  // selectFileHistoryCommit so a commit click always targets the panel's live
  // file (not a stale state closure), keeping the diff request per-file isolated.
  const fileHistoryRelativePathRef = useRef<string | null>(null);
  // The git repository root that owns the history panel's file (its nested repo
  // for a directory-mapping file, else the workspace root). Read by
  // selectFileHistoryCommit so a commit diff runs against the file's own repo.
  const fileHistoryRepositoryRootRef = useRef<string | null>(null);

  // Closes the file history panel and invalidates any in-flight history/diff
  // requests so their results are dropped instead of repopulating a closed
  // panel (or a different tab's panel after a fast reopen).
  const closeFileHistory = useCallback(() => {
    fileHistoryRequestTokenRef.current += 1;
    fileHistoryDiffRequestTokenRef.current += 1;
    fileHistoryRelativePathRef.current = null;
    fileHistoryRepositoryRootRef.current = null;
    setFileHistoryPanelOpen(false);
    setFileHistoryCommits([]);
    setFileHistoryLoading(false);
    setFileHistorySelectedSha(null);
    setFileHistoryDiff(null);
    setFileHistoryDiffLoading(false);
    setFileHistoryRelativePath(null);
  }, []);

  // Loads the diff for a single commit in the file history panel. The requested
  // root, relative path, and request token are captured up front; after the
  // await we re-check both the active workspace root and the token so a stale
  // result from a switched-away tab or a superseded click is dropped.
  const selectFileHistoryCommit = useCallback(
    async (sha: string) => {
      const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;
      const relativePath = fileHistoryRelativePathRef.current;

      if (!requestedRoot || !relativePath) {
        return;
      }

      const requestToken = fileHistoryDiffRequestTokenRef.current + 1;
      fileHistoryDiffRequestTokenRef.current = requestToken;
      setFileHistorySelectedSha(sha);
      setFileHistoryDiffLoading(true);

      try {
        // Run the commit diff against the file's owning repository (its nested
        // repo for a directory-mapping file); the workspace-root re-checks below
        // keep per-tab isolation intact.
        const diff = await gitGateway.fileCommitDiff(
          fileHistoryRepositoryRootRef.current ?? requestedRoot,
          relativePath,
          sha,
        );

        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            requestedRoot,
          ) ||
          fileHistoryDiffRequestTokenRef.current !== requestToken
        ) {
          return;
        }

        setFileHistoryDiff(diff);
      } catch (error) {
        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            requestedRoot,
          ) ||
          fileHistoryDiffRequestTokenRef.current !== requestToken
        ) {
          return;
        }

        setFileHistoryDiff(null);
        reportError("File History", error);
      } finally {
        if (
          workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            requestedRoot,
          ) &&
          fileHistoryDiffRequestTokenRef.current === requestToken
        ) {
          setFileHistoryDiffLoading(false);
        }
      }
    },
    [gitGateway, reportError, workspaceRoot],
  );

  // Opens the file history panel for the active document. The requested root and
  // the active document's relative path are captured up front; after the await
  // we re-check the active workspace root and the request token so a stale
  // history list from a switched-away tab is dropped (per-tab isolation).
  const openFileHistory = useCallback(async () => {
    const requestedRoot = currentWorkspaceRootRef.current ?? workspaceRoot;
    const document = activeDocumentRef.current;

    if (!requestedRoot || !document) {
      return;
    }

    const requestedDocumentPath = document.path;
    // Route file history into the repository that owns the file (its nested repo
    // for a directory-mapping file), so both the history list and per-commit
    // diffs run against the correct repository.
    const target = resolveGitRepositoryTarget(requestedDocumentPath);

    if (!target) {
      return;
    }

    const relativePath = target.relativePath;
    const repositoryRoot = target.repositoryRoot;

    const requestToken = fileHistoryRequestTokenRef.current + 1;
    fileHistoryRequestTokenRef.current = requestToken;
    // Reset any previously selected commit/diff for the new file.
    fileHistoryDiffRequestTokenRef.current += 1;
    fileHistoryRelativePathRef.current = relativePath;
    fileHistoryRepositoryRootRef.current = repositoryRoot;
    setFileHistoryRelativePath(relativePath);
    setFileHistorySelectedSha(null);
    setFileHistoryDiff(null);
    setFileHistoryDiffLoading(false);
    setFileHistoryCommits([]);
    setFileHistoryPanelOpen(true);
    setFileHistoryLoading(true);

    // Re-checks that, after the history await, the request still belongs to the
    // active workspace root, the active document, and the latest open request.
    // A switched-away tab or a superseded reopen drops the stale result.
    const isCurrentRequest = () =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot) &&
      activeDocumentRef.current?.path === requestedDocumentPath &&
      fileHistoryRequestTokenRef.current === requestToken;

    try {
      const commits = await gitGateway.fileHistory(repositoryRoot, relativePath);

      if (!isCurrentRequest()) {
        return;
      }

      setFileHistoryCommits(commits);
    } catch (error) {
      if (!isCurrentRequest()) {
        return;
      }

      setFileHistoryCommits([]);
      reportError("File History", error);
    } finally {
      if (isCurrentRequest()) {
        setFileHistoryLoading(false);
      }
    }
  }, [gitGateway, reportError, resolveGitRepositoryTarget, workspaceRoot]);

  return {
    fileHistoryPanelOpen,
    fileHistoryRelativePath,
    fileHistoryCommits,
    fileHistoryLoading,
    fileHistorySelectedSha,
    fileHistoryDiff,
    fileHistoryDiffLoading,
    openFileHistory,
    selectFileHistoryCommit,
    closeFileHistory,
  };
}
