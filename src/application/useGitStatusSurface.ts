import { useCallback, useMemo, useRef, useState, type MutableRefObject } from "react";
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
import { workspaceRelativePath } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { GitOperationCurrency } from "./useGitOperationCurrency";

export interface GitRepositoryTarget {
  repositoryRoot: string;
  relativePath: string;
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
  activePath: string | null;
  reconcileSelectedGitDiffPreviewForRepository: (
    repositoryRoot: string,
    changes: GitChangedFile[],
  ) => void;
  getSelectedGitDiffDocument: () => { readonly repositoryRoot: string } | null;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  gitGateway: GitGateway;
  gitOperationCurrency: GitOperationCurrency;
  gitRepositoryDiscoveryRequestTokenRef: MutableRefObject<number>;
  reportError: (title: string, error: unknown) => void;
  reportErrorForActiveWorkspaceRoot: (rootPath: string, title: string, error: unknown) => void;
  setMessage: (message: null) => void;
  workspaceRoot: string | null;
}

export function useGitStatusSurface({
  activePath,
  reconcileSelectedGitDiffPreviewForRepository,
  getSelectedGitDiffDocument,
  currentWorkspaceRootRef,
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
  const [gitRepositoryMappingsRoot, setGitRepositoryMappingsRoot] = useState<string | null>(null);
  // Whole-map status view (one entry per mapping), for the multi-repo Changes
  // panel. `gitStatus` above stays the primary (workspace-root) repo.
  const [gitRepositoryStatuses, setGitRepositoryStatuses] = useState<GitRepositoryStatus[]>([]);
  const [gitStatusLoaded, setGitStatusLoaded] = useState(false);
  const [gitLoading, setGitLoading] = useState(false);
  const gitStatusRequestGenerationRef = useRef(0);
  const publishGitStatus = useCallback((next: GitStatus) => {
    setGitStatus((current) => (gitStatusesEqual(current, next) ? current : next));
  }, []);

  const resetGitStatusSurface = useCallback(
    (rootPath?: string) => {
      gitRepositoryDiscoveryRequestTokenRef.current += 1;
      gitStatusRequestGenerationRef.current += 1;
      setGitStatus(rootPath ? emptyGitStatus(rootPath) : emptyGitStatus());
      setGitRepositoryStatuses([]);
      setGitStatusLoaded(false);
      setGitRepositoryMappings([WORKSPACE_ROOT_MAPPING]);
      setGitRepositoryMappingsRoot(null);
      setGitLoading(false);
    },
    [gitRepositoryDiscoveryRequestTokenRef],
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
      setGitStatusLoaded(false);
      setGitRepositoryMappings(mappings);
      setGitRepositoryMappingsRoot(rootPath);
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
        if (repositoryRoots.length === 0) setGitStatusLoaded(true);
        return;
      }
      setGitStatusLoaded(true);

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
      const failures = gitRepositoryMappings
        .map((mapping) => {
          const root = repositoryRootForMapping(mapping, requestedRoot);
          return { mapping, root, status: emptyGitStatus(root), failed: true };
        })
        .filter((entry) => gitOperationCurrency.isRepositoryCurrent(reservation, entry.root));
      setGitRepositoryStatuses((current) => mergeGitRepositoryStatuses(current, failures));
      if (failures.length > 0 || repositoryRoots.length === 0) setGitStatusLoaded(true);
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
    publishGitStatus,
    reportError,
    reconcileSelectedGitDiffPreviewForRepository,
    setMessage,
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

      const primary = statuses.find((entry) => workspaceRootKeysEqual(entry.root, requestedRoot));

      if (primary && !primary.failed) {
        publishGitStatus(primary.status);
      }

      setGitRepositoryStatuses((current) => mergeGitRepositoryStatuses(current, statuses));
      if (statuses.length > 0) setGitStatusLoaded(true);

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
    applyGitOperationStatuses,
    gitActiveFileBranch,
    gitLoading,
    gitStatusLoaded,
    gitRepositoryMappings,
    gitRepositoryMappingsRoot,
    gitRepositoryStatuses,
    gitStatus,
    refreshGitStatus,
    resetGitStatusSurface,
    resolveGitRepositoryTarget,
    runGitRepositoryDiscovery,
  };
}
