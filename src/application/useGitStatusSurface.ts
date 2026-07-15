import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  emptyGitStatus,
  type GitChangedFile,
  type GitGateway,
  type GitStatus,
} from "../domain/git";
import {
  activeFileGitBranchInfo,
  fanOutGitRepositoryStatuses,
  mergeGitRepositoryStatuses,
  primaryGitStatus,
  resolveEffectiveGitRepositoryMappings,
  resolveGitRepositoryForPath,
  WORKSPACE_ROOT_MAPPING,
  type GitRepositoryMapping,
  type GitRepositoryStatus,
} from "../domain/gitRepositoryMapping";
import type { WorkspaceSettings } from "../domain/settings";
import {
  workspaceRelativePath,
  type EditorDocument,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { gitChangesReferToSameDiff } from "./useGitDiffWorkspace";
import type { GitDiffDocumentState } from "./useGitDiffWorkspace";

export interface GitRepositoryTarget {
  repositoryRoot: string;
  relativePath: string;
}

export interface GitStatusSurfaceDependencies {
  activeDocument: EditorDocument | null;
  activePath: string | null;
  closeGitDiffPreview: () => void;
  closeSelectedGitDiffPreviewForChanges: (changes: GitChangedFile[]) => void;
  getSelectedGitDiffDocument: () => GitDiffDocumentState | null;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  editorGitBaselineRequestTokenRef: MutableRefObject<number>;
  gitGateway: GitGateway;
  gitRepositoryDiscoveryRequestTokenRef: MutableRefObject<number>;
  reportError: (title: string, error: unknown) => void;
  reportErrorForActiveWorkspaceRoot: (
    rootPath: string,
    title: string,
    error: unknown,
  ) => void;
  selectedGitChange: GitChangedFile | null;
  setMessage: (message: null) => void;
  workspaceRoot: string | null;
}

export function useGitStatusSurface({
  activeDocument,
  activePath,
  closeGitDiffPreview,
  closeSelectedGitDiffPreviewForChanges,
  getSelectedGitDiffDocument,
  currentWorkspaceRootRef,
  editorGitBaselineRequestTokenRef,
  gitGateway,
  gitRepositoryDiscoveryRequestTokenRef,
  reportError,
  reportErrorForActiveWorkspaceRoot,
  selectedGitChange,
  setMessage,
  workspaceRoot,
}: GitStatusSurfaceDependencies) {
  const [gitStatus, setGitStatus] = useState<GitStatus>(emptyGitStatus());
  // Effective git repository mappings (manual + auto-detected, always incl. the
  // workspace root). Defaults to the single workspace-root repo so behaviour is
  // identical to the pre-multi-repo world until discovery runs.
  const [gitRepositoryMappings, setGitRepositoryMappings] = useState<
    GitRepositoryMapping[]
  >([WORKSPACE_ROOT_MAPPING]);
  // Whole-map status view (one entry per mapping), for the multi-repo Changes
  // panel. `gitStatus` above stays the primary (workspace-root) repo.
  const [gitRepositoryStatuses, setGitRepositoryStatuses] = useState<
    GitRepositoryStatus[]
  >([]);
  const [gitLoading, setGitLoading] = useState(false);
  const gitStatusRequestGenerationRef = useRef(0);
  const [editorGitBaselinesByPath, setEditorGitBaselinesByPath] = useState<
    Record<string, string | null>
  >({});

  const resetGitStatusSurface = useCallback((rootPath?: string) => {
    gitStatusRequestGenerationRef.current += 1;
    setGitStatus(rootPath ? emptyGitStatus(rootPath) : emptyGitStatus());
    setGitRepositoryStatuses([]);
    setGitRepositoryMappings([WORKSPACE_ROOT_MAPPING]);
    setGitLoading(false);
    setEditorGitBaselinesByPath({});
  }, []);

  // Discover nested git repositories (PhpStorm-style directory mappings) for
  // `rootPath` from its settings and publish the effective mappings so every git
  // operation routes into the repository that owns each file. Auto-detection is
  // optional (the gateway may not implement it) and gated on the workspace
  // setting; manual mappings are always honoured. Per-root isolated: captures
  // `rootPath` and, after the (optional) detection await, re-checks BOTH the
  // discovery token (last request wins) and the live workspace root before
  // publishing, dropping any stale or superseded result. On failure or when auto
  // is off it falls back to the manual mappings plus the workspace root
  // (single-repo behaviour). Shared by the open flow and the settings-save flow
  // so both resolve mappings identically.
  const runGitRepositoryDiscovery = useCallback(
    async (rootPath: string, settings: WorkspaceSettings): Promise<void> => {
      const requestToken = gitRepositoryDiscoveryRequestTokenRef.current + 1;
      gitRepositoryDiscoveryRequestTokenRef.current = requestToken;

      const auto = settings.gitDirectoryMappingsAuto;
      let detected: string[] | null = null;

      try {
        if (auto && gitGateway.detectRepositories) {
          detected = await gitGateway.detectRepositories(rootPath);
        }
      } catch (error) {
        reportErrorForActiveWorkspaceRoot(rootPath, "Git", error);
      }

      if (gitRepositoryDiscoveryRequestTokenRef.current !== requestToken) {
        return;
      }

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return;
      }

      setGitRepositoryMappings(
        resolveEffectiveGitRepositoryMappings({
          manualMappings: settings.gitDirectoryMappings,
          detectedDirectories: detected,
          auto,
        }),
      );
    },
    [
      currentWorkspaceRootRef,
      gitGateway,
      gitRepositoryDiscoveryRequestTokenRef,
      reportErrorForActiveWorkspaceRoot,
    ],
  );

  // Resolves the git repository (and in-repo path) that owns an absolute file
  // path: a file in a nested repository (directory mapping) routes to that repo
  // root + its repo-relative path, so its gutter diff, blame and file history
  // run against the correct repository. Falls back to the workspace root (the
  // pre-multi-repo behaviour) for primary-repo files and any path the resolver
  // declines. `null` only when there is no workspace or the path is outside it.
  const resolveGitRepositoryTarget = useCallback(
    (absolutePath: string): GitRepositoryTarget | null => {
      const root = currentWorkspaceRootRef.current ?? workspaceRoot;

      if (!root) {
        return null;
      }

      const resolved = resolveGitRepositoryForPath(
        gitRepositoryMappings,
        root,
        absolutePath,
      );

      if (resolved && resolved.repositoryRelativePath !== "") {
        return {
          repositoryRoot: resolved.repositoryRoot,
          relativePath: resolved.repositoryRelativePath,
        };
      }

      const relativePath = workspaceRelativePath(root, absolutePath);

      if (!relativePath) {
        return null;
      }

      return { repositoryRoot: root, relativePath };
    },
    [currentWorkspaceRootRef, gitRepositoryMappings, workspaceRoot],
  );

  const refreshGitStatus = useCallback(async () => {
    const requestGeneration = gitStatusRequestGenerationRef.current + 1;
    gitStatusRequestGenerationRef.current = requestGeneration;

    if (!workspaceRoot) {
      setGitStatus(emptyGitStatus());
      setGitRepositoryStatuses([]);
      setGitLoading(false);
      return;
    }

    const requestedRoot = workspaceRoot;
    const isCurrentRequest = () =>
      gitStatusRequestGenerationRef.current === requestGeneration &&
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
    setGitLoading(true);

    try {
      // Fan out one status request per mapped repository; a single repo's
      // failure is isolated and never breaks the others. With the default
      // single (workspace-root) mapping this is exactly one getStatus call.
      const statuses = await fanOutGitRepositoryStatuses(
        gitRepositoryMappings,
        requestedRoot,
        (root) => gitGateway.getStatus(root),
      );

      if (!isCurrentRequest()) {
        return;
      }

      setGitRepositoryStatuses(statuses);
      // The primary (workspace-root) repo drives the existing single-status UI
      // and the diff-preview reconciliation below.
      const status = primaryGitStatus(statuses, requestedRoot);
      setGitStatus(status);
      const selectedDiffDocument = getSelectedGitDiffDocument();
      const selectedRepositoryStatus = selectedDiffDocument
        ? statuses.find((entry) =>
            workspaceRootKeysEqual(
              entry.root,
              selectedDiffDocument.repositoryRoot,
            )
          )
        : null;
      if (selectedRepositoryStatus && !selectedRepositoryStatus.failed) {
        closeSelectedGitDiffPreviewForChanges(
          selectedRepositoryStatus.status.changes,
        );
      }
      setMessage(null);
    } catch (error) {
      if (!isCurrentRequest()) {
        return;
      }

      setGitStatus(emptyGitStatus(requestedRoot));
      setGitRepositoryStatuses([]);
      reportError("Git", error);
    } finally {
      if (!isCurrentRequest()) {
        return;
      }

      setGitLoading(false);
    }
  }, [
    closeSelectedGitDiffPreviewForChanges,
    currentWorkspaceRootRef,
    gitGateway,
    gitRepositoryMappings,
    getSelectedGitDiffDocument,
    reportError,
    setMessage,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!workspaceRoot || !activeDocument) {
      return;
    }

    const requestedRoot = workspaceRoot;
    const requestedPath = activeDocument.path;
    // Route the gutter baseline into the repository that owns the active file: a
    // nested-repo file diffs against its own repository. The primary status is
    // published only for a primary-repo file so a nested file's status never
    // overwrites the primary Changes panel view.
    const baselineTarget = resolveGitRepositoryTarget(requestedPath);
    const baselineRepoRoot = baselineTarget
      ? baselineTarget.repositoryRoot
      : requestedRoot;
    const isPrimaryRepo = workspaceRootKeysEqual(
      baselineRepoRoot,
      requestedRoot,
    );
    const token = (editorGitBaselineRequestTokenRef.current += 1);
    let active = true;

    const loadGitBaseline = async () => {
      try {
        const status = await gitGateway.getStatus(baselineRepoRoot);

        if (
          !active ||
          token !== editorGitBaselineRequestTokenRef.current ||
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return;
        }

        if (isPrimaryRepo) {
          setGitStatus(status);
        }

        const change = status.changes.find(
          (candidate) =>
            candidate.path === requestedPath ||
            candidate.oldPath === requestedPath,
        );

        if (!status.isRepository || !change) {
          setEditorGitBaselinesByPath((current) => ({
            ...current,
            [requestedPath]: null,
          }));
          return;
        }

        const diff = await gitGateway.getDiff(baselineRepoRoot, change);

        if (
          !active ||
          token !== editorGitBaselineRequestTokenRef.current ||
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return;
        }

        setEditorGitBaselinesByPath((current) => ({
          ...current,
          [requestedPath]: diff.originalContent,
        }));
      } catch {
        if (
          !active ||
          token !== editorGitBaselineRequestTokenRef.current ||
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
        ) {
          return;
        }

        setEditorGitBaselinesByPath((current) => ({
          ...current,
          [requestedPath]: null,
        }));
      }
    };

    void loadGitBaseline();

    return () => {
      active = false;
    };
  }, [
    activeDocument?.path,
    activeDocument?.savedContent,
    currentWorkspaceRootRef,
    editorGitBaselineRequestTokenRef,
    gitGateway,
    resolveGitRepositoryTarget,
    workspaceRoot,
  ]);

  const applyGitOperationStatus = useCallback(
    (status: GitStatus) => {
      setGitStatus(status);

      if (
        selectedGitChange &&
        !status.changes.some((change) =>
          gitChangesReferToSameDiff(change, selectedGitChange),
        )
      ) {
        closeGitDiffPreview();
      }
    },
    [closeGitDiffPreview, selectedGitChange],
  );

  // Publishes fresh per-repository statuses after a multi-repo git operation:
  // merges them into the whole-map view so the multi-repo panel stays current.
  // The primary repo's status is applied separately via applyGitOperationStatus.
  const applyRepositoryOperationStatuses = useCallback(
    (statuses: GitRepositoryStatus[]) => {
      setGitRepositoryStatuses((current) =>
        mergeGitRepositoryStatuses(current, statuses),
      );
    },
    [],
  );

  // The status-bar git branch follows the active file: a file in a nested
  // repository (directory mapping) shows that repository's branch plus a compact
  // repo label; a file in the primary/single repository keeps the pre-multi-repo
  // behaviour (primary branch, no label). Non-file active paths (e.g. a git diff
  // pseudo-path) resolve to no repository and fall back to the primary branch.
  const gitActiveFileBranch = useMemo(
    () =>
      activeFileGitBranchInfo({
        mappings: gitRepositoryMappings,
        workspaceRoot,
        activeFilePath: activePath,
        repositoryStatuses: gitRepositoryStatuses,
        primaryBranch: gitStatus.branch,
      }),
    [
      activePath,
      gitRepositoryMappings,
      gitRepositoryStatuses,
      gitStatus.branch,
      workspaceRoot,
    ],
  );

  return {
    activeDocumentGitBaseline: activeDocument
      ? editorGitBaselinesByPath[activeDocument.path] ?? null
      : null,
    applyGitOperationStatus,
    applyRepositoryOperationStatuses,
    editorGitBaselinesByPath,
    gitActiveFileBranch,
    gitLoading,
    gitRepositoryMappings,
    gitRepositoryStatuses,
    gitStatus,
    refreshGitStatus,
    resetGitStatusSurface,
    resolveGitRepositoryTarget,
    runGitRepositoryDiscovery,
  };
}
