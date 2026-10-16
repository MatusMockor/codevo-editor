import {
  repositoryRootForMapping,
  type GitRepositoryMapping,
  type GitRepositoryStatus,
  type ResolvedGitRepository,
} from "../../domain/gitRepositoryMapping";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";

export interface ActiveWorkspaceGitRepositorySnapshot {
  readonly workspaceRoot: string | null;
  readonly discoveredRoot: string | null;
  readonly mappings: ReadonlyArray<GitRepositoryMapping>;
  readonly statuses: ReadonlyArray<GitRepositoryStatus>;
}

export function activeWorkspaceRepositories(
  snapshot: ActiveWorkspaceGitRepositorySnapshot,
): ReadonlyArray<ResolvedGitRepository> | null {
  const { workspaceRoot, discoveredRoot } = snapshot;
  if (!workspaceRoot || !discoveredRoot) return null;
  if (!workspaceRootKeysEqual(discoveredRoot, workspaceRoot)) return null;
  return snapshot.mappings
    .map((mapping) => ({
      mapping,
      repositoryRoot: repositoryRootForMapping(mapping, workspaceRoot),
      repositoryRelativePath: "",
    }))
    .filter((repository) => {
      const status = snapshot.statuses.find(
        (candidate) => candidate.root === repository.repositoryRoot,
      );
      return status === undefined || status.failed || status.status.isRepository;
    });
}
