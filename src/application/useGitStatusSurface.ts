import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useCommitBailoutState } from "./useCommitBailoutState";
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
  repositoryRootForMapping,
  resolveEffectiveGitRepositoryMappings,
  resolveGitRepositoryForPath,
  WORKSPACE_ROOT_MAPPING,
  type GitRepositoryMapping,
  type GitRepositoryStatus,
} from "../domain/gitRepositoryMapping";
import type { WorkspaceSettings } from "../domain/settings";
import { workspaceRelativePath, type EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { GitDiffDocumentState } from "./useGitDiffWorkspace";
import type { GitOperationCurrency } from "./useGitOperationCurrency";

export interface GitRepositoryTarget {
  repositoryRoot: string;
  relativePath: string;
}

const MAX_EDITOR_GIT_BASELINE_CACHE_ENTRIES = 64;

interface EditorGitBaselineCacheEntry {
  baseline: string | null;
  savedContent: string | null;
}

export function editorGitBaselineCacheKey(repoRoot: string, path: string): string {
  return `${repoRoot}\0${path}`;
}

export function gitStatusesEqual(left: GitStatus, right: GitStatus): boolean {
  if (
    left.branch !== right.branch ||
    left.isRepository !== right.isRepository ||
    left.rootPath !== right.rootPath ||
    left.changes.length !== right.changes.length
  ) {
    return false;
  }

  if (!gitUpstreamTrackingEqual(left.upstream, right.upstream)) {
    return false;
  }

  return left.changes.every((change, index) => gitChangedFilesEqual(change, right.changes[index]));
}

function gitUpstreamTrackingEqual(
  left: GitStatus["upstream"],
  right: GitStatus["upstream"],
): boolean {
  if (!left || !right) {
    return !left && !right;
  }

  return left.ahead === right.ahead && left.behind === right.behind && left.branch === right.branch;
}

function gitChangedFilesEqual(left: GitChangedFile, right: GitChangedFile | undefined): boolean {
  if (!right) {
    return false;
  }

  return (
    left.isStaged === right.isStaged &&
    left.isUnversioned === right.isUnversioned &&
    left.oldPath === right.oldPath &&
    left.oldRelativePath === right.oldRelativePath &&
    left.path === right.path &&
    left.relativePath === right.relativePath &&
    left.status === right.status
  );
}

export interface GitStatusSurfaceDependencies {
  activeDocument: EditorDocument | null;
  activePath: string | null;
  reconcileSelectedGitDiffPreviewForRepository: (
    repositoryRoot: string,
    changes: GitChangedFile[],
  ) => void;
  getSelectedGitDiffDocument: () => GitDiffDocumentState | null;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  editorGitBaselineRequestTokenRef: MutableRefObject<number>;
  gitGateway: GitGateway;
  gitOperationCurrency: GitOperationCurrency;
  gitRepositoryDiscoveryRequestTokenRef: MutableRefObject<number>;
  reportError: (title: string, error: unknown) => void;
  reportErrorForActiveWorkspaceRoot: (rootPath: string, title: string, error: unknown) => void;
  setMessage: (message: null) => void;
  workspaceRoot: string | null;
}

export function useGitStatusSurface({
  activeDocument,
  activePath,
  reconcileSelectedGitDiffPreviewForRepository,
  getSelectedGitDiffDocument,
  currentWorkspaceRootRef,
  editorGitBaselineRequestTokenRef,
  gitGateway,
  gitOperationCurrency,
  gitRepositoryDiscoveryRequestTokenRef,
  reportError,
  reportErrorForActiveWorkspaceRoot,
  setMessage,
  workspaceRoot,
}: GitStatusSurfaceDependencies) {
  const [gitStatus, setGitStatus] = useState<GitStatus>(emptyGitStatus());
  // Effective git repository mappings (manual + auto-detected). Defaults to the
  // single workspace-root repo until discovery runs; a successful discovery
  // that confirms an aggregate non-Git root removes that root while retaining
  // its nested repositories.
  const [gitRepositoryMappings, setGitRepositoryMappings] = useState<GitRepositoryMapping[]>([
    WORKSPACE_ROOT_MAPPING,
  ]);
  // Whole-map status view (one entry per mapping), for the multi-repo Changes
  // panel. `gitStatus` above stays the primary (workspace-root) repo.
  const [gitRepositoryStatuses, setGitRepositoryStatuses] = useState<GitRepositoryStatus[]>([]);
  const [gitLoading, setGitLoading] = useState(false);
  const gitStatusRequestGenerationRef = useRef(0);
  const [editorGitBaselinesByPath, setEditorGitBaselinesByPath] = useCommitBailoutState<
    Record<string, string | null>
  >({});
  const editorGitBaselineCacheRef = useRef(new Map<string, EditorGitBaselineCacheEntry>());
  const editorGitBaselineCacheGenerationRef = useRef(0);

  const invalidateEditorGitBaselineCache = useCallback(() => {
    editorGitBaselineCacheGenerationRef.current += 1;
    editorGitBaselineCacheRef.current.clear();
  }, []);

  const rememberEditorGitBaseline = useCallback(
    (key: string, generation: number, entry: EditorGitBaselineCacheEntry) => {
      if (generation !== editorGitBaselineCacheGenerationRef.current) {
        return;
      }

      const cache = editorGitBaselineCacheRef.current;
      cache.delete(key);
      cache.set(key, entry);

      while (cache.size > MAX_EDITOR_GIT_BASELINE_CACHE_ENTRIES) {
        const oldestKey = cache.keys().next().value;

        if (oldestKey === undefined) {
          return;
        }

        cache.delete(oldestKey);
      }
    },
    [],
  );

  const publishGitStatus = useCallback((next: GitStatus) => {
    setGitStatus((current) => (gitStatusesEqual(current, next) ? current : next));
  }, []);

  const publishEditorGitBaseline = useCallback(
    (path: string, baseline: string | null) => {
      setEditorGitBaselinesByPath((current) =>
        path in current && current[path] === baseline ? current : { ...current, [path]: baseline },
      );
    },
    [setEditorGitBaselinesByPath],
  );

  const resetGitStatusSurface = useCallback(
    (rootPath?: string) => {
      gitStatusRequestGenerationRef.current += 1;
      invalidateEditorGitBaselineCache();
      setGitStatus(rootPath ? emptyGitStatus(rootPath) : emptyGitStatus());
      setGitRepositoryStatuses([]);
      setGitRepositoryMappings([WORKSPACE_ROOT_MAPPING]);
      setGitLoading(false);
      setEditorGitBaselinesByPath({});
    },
    [invalidateEditorGitBaselineCache, setEditorGitBaselinesByPath],
  );

  // Discover nested git repositories (PhpStorm-style directory mappings) for
  // `rootPath` from its settings and publish the effective mappings so every git
  // operation routes into the repository that owns each file. Auto-detection is
  // optional (the gateway may not implement it) and gated on the workspace
  // setting; manual mappings are always honoured. Per-root isolated: captures
  // `rootPath` and, after the (optional) detection await, re-checks BOTH the
  // discovery token (last request wins) and the live workspace root before
  // publishing, dropping any stale or superseded result. On failure or when auto
  // is off it falls back to the manual mappings plus the workspace root
  // (single-repo behaviour). A successful enabled scan is authoritative and
  // omits a root it did not discover. Shared by the open flow and the
  // settings-save flow so both resolve mappings identically.
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

      const mappings = resolveEffectiveGitRepositoryMappings({
        manualMappings: settings.gitDirectoryMappings,
        detectedDirectories: detected,
        auto,
      });
      const allowedRepositoryRoots = new Set(
        mappings.map((mapping) => repositoryRootForMapping(mapping, rootPath)),
      );

      gitStatusRequestGenerationRef.current += 1;
      gitOperationCurrency.reservePublication([rootPath, ...allowedRepositoryRoots]);
      setGitLoading(false);
      setGitRepositoryMappings(mappings);
      setGitRepositoryStatuses((current) =>
        current.filter((status) =>
          [...allowedRepositoryRoots].some((root) => workspaceRootKeysEqual(root, status.root)),
        ),
      );
      if (!mappings.some((mapping) => mapping.rootRelativePath === "")) {
        publishGitStatus(emptyGitStatus(rootPath));
      }
    },
    [
      currentWorkspaceRootRef,
      gitGateway,
      gitOperationCurrency,
      gitRepositoryDiscoveryRequestTokenRef,
      publishGitStatus,
      reportErrorForActiveWorkspaceRoot,
    ],
  );

  // Resolves the git repository (and in-repo path) that owns an absolute file
  // path: a file in a nested repository (directory mapping) routes to that repo
  // root + its repo-relative path, so its gutter diff, blame and file history
  // run against the correct repository. Falls back to the workspace root only
  // while a primary mapping exists. When discovery confirmed an aggregate
  // non-Git root, files outside every nested repository resolve to `null` rather
  // than accidentally running Git against the aggregate folder.
  const resolveGitRepositoryTarget = useCallback(
    (absolutePath: string): GitRepositoryTarget | null => {
      const root = currentWorkspaceRootRef.current ?? workspaceRoot;

      if (!root) {
        return null;
      }

      const resolved = resolveGitRepositoryForPath(gitRepositoryMappings, root, absolutePath);

      if (resolved && resolved.repositoryRelativePath !== "") {
        return {
          repositoryRoot: resolved.repositoryRoot,
          relativePath: resolved.repositoryRelativePath,
        };
      }

      if (!gitRepositoryMappings.some((mapping) => mapping.rootRelativePath === "")) {
        return null;
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
    invalidateEditorGitBaselineCache();

    if (!workspaceRoot) {
      publishGitStatus(emptyGitStatus());
      setGitRepositoryStatuses([]);
      setGitLoading(false);
      return;
    }

    const requestedRoot = workspaceRoot;
    const repositoryRoots = gitRepositoryMappings.map((mapping) =>
      mapping.rootRelativePath
        ? `${requestedRoot.replace(/[\\/]+$/, "")}/${mapping.rootRelativePath}`
        : requestedRoot,
    );
    const reservation = gitOperationCurrency.reservePublication(repositoryRoots);
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

      const currentStatuses = statuses.filter((entry) =>
        gitOperationCurrency.isRepositoryCurrent(reservation, entry.root),
      );

      if (currentStatuses.length === 0) {
        return;
      }

      setGitRepositoryStatuses((current) => mergeGitRepositoryStatuses(current, currentStatuses));
      // The primary (workspace-root) repo drives the existing single-status UI
      // and the diff-preview reconciliation below.
      const primaryStatus = currentStatuses.find((entry) =>
        workspaceRootKeysEqual(entry.root, requestedRoot),
      );
      if (primaryStatus) {
        publishGitStatus(primaryGitStatus(currentStatuses, requestedRoot));
      }
      const selectedDiffDocument = getSelectedGitDiffDocument();
      const selectedRepositoryStatus = selectedDiffDocument
        ? currentStatuses.find((entry) =>
            workspaceRootKeysEqual(entry.root, selectedDiffDocument.repositoryRoot),
          )
        : null;
      if (selectedRepositoryStatus && !selectedRepositoryStatus.failed) {
        reconcileSelectedGitDiffPreviewForRepository(
          selectedRepositoryStatus.root,
          selectedRepositoryStatus.status.changes,
        );
      }
      if (primaryStatus) {
        setMessage(null);
      }
    } catch (error) {
      if (!isCurrentRequest()) {
        return;
      }

      if (!gitOperationCurrency.isRepositoryCurrent(reservation, requestedRoot)) {
        return;
      }

      publishGitStatus(emptyGitStatus(requestedRoot));
      setGitRepositoryStatuses([]);
      reportError("Git", error);
    } finally {
      if (isCurrentRequest()) {
        setGitLoading(false);
      }
    }
  }, [
    currentWorkspaceRootRef,
    gitGateway,
    gitOperationCurrency,
    gitRepositoryMappings,
    getSelectedGitDiffDocument,
    invalidateEditorGitBaselineCache,
    publishGitStatus,
    reportError,
    reconcileSelectedGitDiffPreviewForRepository,
    setMessage,
    workspaceRoot,
  ]);

  const activeDocumentPath = activeDocument?.path ?? null;
  const activeDocumentSavedContent = activeDocument?.savedContent ?? null;

  useEffect(() => {
    if (!workspaceRoot || !activeDocumentPath) {
      return;
    }

    const requestedRoot = workspaceRoot;
    const requestedPath = activeDocumentPath;
    // Route the gutter baseline into the repository that owns the active file: a
    // nested-repo file diffs against its own repository. The primary status is
    // published only for a primary-repo file so a nested file's status never
    // overwrites the primary Changes panel view.
    const baselineTarget = resolveGitRepositoryTarget(requestedPath);
    const baselineRepoRoot = baselineTarget ? baselineTarget.repositoryRoot : requestedRoot;
    const isPrimaryRepo = workspaceRootKeysEqual(baselineRepoRoot, requestedRoot);
    // A warm switch back to a document whose baseline was already resolved under
    // the current git-status generation reuses the cached value instead of
    // paying another status round-trip. Every refresh, git mutation and surface
    // reset bumps the generation, so a real change always reloads.
    const cacheKey = editorGitBaselineCacheKey(baselineRepoRoot, requestedPath);
    const cacheGeneration = editorGitBaselineCacheGenerationRef.current;
    const cached = editorGitBaselineCacheRef.current.get(cacheKey);

    if (cached && cached.savedContent === activeDocumentSavedContent) {
      publishEditorGitBaseline(requestedPath, cached.baseline);
      return;
    }

    const token = (editorGitBaselineRequestTokenRef.current += 1);
    const publication = gitOperationCurrency.reservePublication([baselineRepoRoot]);
    let active = true;

    const loadGitBaseline = async () => {
      try {
        const status = await gitGateway.getStatus(baselineRepoRoot);

        if (
          !active ||
          token !== editorGitBaselineRequestTokenRef.current ||
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot) ||
          !gitOperationCurrency.isRepositoryCurrent(publication, baselineRepoRoot)
        ) {
          return;
        }

        if (isPrimaryRepo) {
          publishGitStatus(status);
        }

        const change = status.changes.find(
          (candidate) => candidate.path === requestedPath || candidate.oldPath === requestedPath,
        );

        if (!status.isRepository || !change) {
          rememberEditorGitBaseline(cacheKey, cacheGeneration, {
            baseline: null,
            savedContent: activeDocumentSavedContent,
          });
          publishEditorGitBaseline(requestedPath, null);
          return;
        }

        const diff = await gitGateway.getDiff(baselineRepoRoot, change);

        if (
          !active ||
          token !== editorGitBaselineRequestTokenRef.current ||
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot) ||
          !gitOperationCurrency.isRepositoryCurrent(publication, baselineRepoRoot)
        ) {
          return;
        }

        rememberEditorGitBaseline(cacheKey, cacheGeneration, {
          baseline: diff.originalContent,
          savedContent: activeDocumentSavedContent,
        });
        publishEditorGitBaseline(requestedPath, diff.originalContent);
      } catch {
        if (
          !active ||
          token !== editorGitBaselineRequestTokenRef.current ||
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot) ||
          !gitOperationCurrency.isRepositoryCurrent(publication, baselineRepoRoot)
        ) {
          return;
        }

        publishEditorGitBaseline(requestedPath, null);
      }
    };

    void loadGitBaseline();

    return () => {
      active = false;
    };
  }, [
    activeDocumentPath,
    activeDocumentSavedContent,
    currentWorkspaceRootRef,
    editorGitBaselineRequestTokenRef,
    gitGateway,
    gitOperationCurrency,
    publishEditorGitBaseline,
    publishGitStatus,
    rememberEditorGitBaseline,
    resolveGitRepositoryTarget,
    workspaceRoot,
  ]);

  const applyGitOperationStatuses = useCallback(
    (statuses: GitRepositoryStatus[]) => {
      const requestedRoot = workspaceRoot;

      if (!requestedRoot) {
        return;
      }

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      invalidateEditorGitBaselineCache();
      const primary = statuses.find((entry) => workspaceRootKeysEqual(entry.root, requestedRoot));

      if (primary && !primary.failed) {
        publishGitStatus(primary.status);
      }

      setGitRepositoryStatuses((current) => mergeGitRepositoryStatuses(current, statuses));

      const selectedDiffDocument = getSelectedGitDiffDocument();

      if (!selectedDiffDocument) {
        return;
      }

      const selectedRepositoryStatus = statuses.find((entry) =>
        workspaceRootKeysEqual(entry.root, selectedDiffDocument.repositoryRoot),
      );

      if (!selectedRepositoryStatus || selectedRepositoryStatus.failed) {
        return;
      }

      reconcileSelectedGitDiffPreviewForRepository(
        selectedRepositoryStatus.root,
        selectedRepositoryStatus.status.changes,
      );
    },
    [
      currentWorkspaceRootRef,
      getSelectedGitDiffDocument,
      invalidateEditorGitBaselineCache,
      publishGitStatus,
      reconcileSelectedGitDiffPreviewForRepository,
      workspaceRoot,
    ],
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
    [activePath, gitRepositoryMappings, gitRepositoryStatuses, gitStatus.branch, workspaceRoot],
  );

  return {
    activeDocumentGitBaseline: activeDocument
      ? (editorGitBaselinesByPath[activeDocument.path] ?? null)
      : null,
    applyGitOperationStatuses,
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
