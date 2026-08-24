import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import { runningTurn, type AgentThread } from "../domain/agentThread";
import type { GitGateway } from "../domain/git";
import {
  WORKTREE_BASE_DIR_NAME,
  type GitWorktreeDescriptor,
  type GitWorktreeGateway,
} from "../domain/gitWorktree";
import {
  AGENT_TASKS_SOURCE,
  failure,
  info,
  isCurrentProjectOwner,
  projectAuthority,
  projectByOwnerId,
  owningProjectForRepository,
  tryOrReport,
  warning,
} from "./agentProjectAuthority";
import type { AgentTasksNotice, OrphanedWorktreeView } from "./agentThreadPorts";
import type { WorkbenchPrompter } from "./workbenchPrompter";

export interface AgentWorktreeLifecycleDependencies {
  readonly gitWorktreeGateway: GitWorktreeGateway;
  readonly gitGateway: Pick<GitGateway, "getStatus">;
  readonly prompter: WorkbenchPrompter;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly threads: ReadonlyMap<string, AgentThread>;
  readonly loadedRootKeys: ReadonlySet<string>;
  readonly reportError: (source: string, error: unknown) => void;
  readonly setNotice: (notice: AgentTasksNotice | null) => void;
  readonly onWorktreeRemovalChanged: (threadId: string, removing: boolean) => void;
  readonly onWorktreeRemoved: (threadId: string) => void;
}

export interface AgentWorktreeLifecycleSurface {
  readonly orphanedWorktrees: ReadonlyArray<OrphanedWorktreeView>;
  readonly missingWorktreeThreadIds: ReadonlySet<string>;
  readonly removedWorktreeThreadIds: ReadonlySet<string>;
  refreshOrphanedWorktrees(): Promise<void>;
  retainUncertainWorktree(worktreePath: string): void;
  removeWorktree(threadId: string): Promise<void>;
  removeOrphanedWorktree(worktreePath: string): Promise<void>;
  pruneOrphanedWorktrees(repositoryRoot: string): Promise<void>;
}

interface OrphanedWorktreeCandidate {
  readonly repositoryRoot: string;
  readonly worktreePath: string;
  readonly branch: string | null;
  readonly prunable: boolean;
}

interface RepositoryWorktreeListing {
  readonly worktreePaths: ReadonlySet<string>;
  readonly prunablePaths: ReadonlySet<string>;
  readonly candidates: ReadonlyArray<OrphanedWorktreeCandidate>;
}

const DIRTY_WORKTREE_CONFIRMATION =
  "This worktree has uncommitted changes. Remove it and discard them?";

export function useAgentWorktreeLifecycle(
  dependencies: AgentWorktreeLifecycleDependencies,
): AgentWorktreeLifecycleSurface {
  const [listings, setListings] = useState<ReadonlyMap<string, RepositoryWorktreeListing>>(
    () => new Map(),
  );
  const [removingOrphans, setRemovingOrphans] = useState<ReadonlySet<string>>(() => new Set());
  const [removedWorktreeThreadIds, setRemovedWorktreeThreadIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const dependenciesRef = useRef(dependencies);
  const listingsRef = useRef(listings);
  listingsRef.current = listings;
  const uncertainWorktreePathsRef = useRef<ReadonlySet<string>>(new Set());
  const mountedRef = useRef(true);

  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshOrphanedWorktrees = useCallback(async (): Promise<void> => {
    const projects = dependenciesRef.current.projects;
    if (projects.length === 0) {
      if (mountedRef.current) setListings(new Map());
      return;
    }
    const collected = new Map<string, RepositoryWorktreeListing>();
    for (const project of projects) {
      if (project.trust !== "trusted") continue;
      if (!dependenciesRef.current.loadedRootKeys.has(project.rootKey)) continue;
      const authority = projectAuthority(project);
      for (const repository of project.repositories) {
        const repositoryRoot = repository.repositoryRoot;
        if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) break;
        const listed = await tryOrReport(
          () => dependenciesRef.current.gitWorktreeGateway.listWorktrees(repositoryRoot),
          dependenciesRef,
        );
        if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) break;
        if (!listed.ok) continue;
        collected.set(repositoryRoot, repositoryListing(repositoryRoot, listed.value));
      }
    }
    if (!mountedRef.current) return;
    setListings(collected);
  }, []);

  const projectsSignature = useMemo(
    () =>
      dependencies.projects
        .map((project) =>
          [
            project.rootKey,
            project.generation,
            project.ownerId,
            project.trust,
            dependencies.loadedRootKeys.has(project.rootKey) ? "loaded" : "pending",
            project.repositories.map((repository) => repository.repositoryRoot).join(","),
          ].join("#"),
        )
        .join(";"),
    [dependencies.loadedRootKeys, dependencies.projects],
  );

  useEffect(() => {
    void refreshOrphanedWorktrees();
  }, [projectsSignature, refreshOrphanedWorktrees]);

  const retainUncertainWorktree = useCallback((worktreePath: string): void => {
    uncertainWorktreePathsRef.current = new Set(uncertainWorktreePathsRef.current).add(
      worktreePath,
    );
  }, []);

  const removeWorktree = useCallback(
    async (threadId: string): Promise<void> => {
      const deps = dependenciesRef.current;
      const thread = deps.threads.get(threadId);
      if (thread === undefined) return;
      const worktreePath = thread.target.worktreePath;
      if (worktreePath === null) return;
      if (runningTurn(thread) !== null) {
        deps.setNotice(warning("Stop the agent before removing its worktree."));
        return;
      }
      const project = projectByOwnerId(deps.projects, thread.owner.ownerId);
      if (project === undefined) return;
      const authority = projectAuthority(project);
      const repositoryRoot = thread.owner.repositoryRoot;
      deps.onWorktreeRemovalChanged(threadId, true);

      try {
        const status = await deps.gitGateway.getStatus(worktreePath);
        if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) return;
        const dirty = status.changes.length > 0;
        if (dirty && !dependenciesRef.current.prompter.confirm(DIRTY_WORKTREE_CONFIRMATION)) {
          dependenciesRef.current.onWorktreeRemovalChanged(threadId, false);
          return;
        }
        await dependenciesRef.current.gitWorktreeGateway.removeWorktree(
          repositoryRoot,
          worktreePath,
          dirty,
        );
        if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) return;
        dependenciesRef.current.onWorktreeRemoved(threadId);
        setRemovedWorktreeThreadIds((current) => new Set(current).add(threadId));
        dependenciesRef.current.setNotice(info("The worktree was removed. Its branch was kept."));
        void refreshOrphanedWorktrees();
      } catch (error) {
        dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, error);
        if (!mountedRef.current) return;
        dependenciesRef.current.onWorktreeRemovalChanged(threadId, false);
        dependenciesRef.current.setNotice(failure("The worktree could not be removed."));
      }
    },
    [refreshOrphanedWorktrees],
  );

  const removeOrphanedWorktree = useCallback(
    async (worktreePath: string): Promise<void> => {
      const deps = dependenciesRef.current;
      const candidate = candidateFor(listingsRef.current, worktreePath);
      if (candidate === null) return;
      const project = owningProjectForRepository(deps.projects, candidate.repositoryRoot);
      if (project === undefined) return;
      const authority = projectAuthority(project);
      setRemovingOrphans((current) => new Set(current).add(worktreePath));

      try {
        const status = await deps.gitGateway.getStatus(worktreePath);
        if (
          !isCurrentProjectOwner(dependenciesRef, mountedRef, authority, candidate.repositoryRoot)
        ) {
          return;
        }
        const dirty = status.changes.length > 0;
        if (dirty && !dependenciesRef.current.prompter.confirm(DIRTY_WORKTREE_CONFIRMATION)) return;
        await dependenciesRef.current.gitWorktreeGateway.removeWorktree(
          candidate.repositoryRoot,
          worktreePath,
          dirty,
        );
        if (!mountedRef.current) return;
        dependenciesRef.current.setNotice(
          info("The orphaned worktree was removed. Its branch was kept."),
        );
      } catch (error) {
        dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, error);
        if (!mountedRef.current) return;
        dependenciesRef.current.setNotice(failure("The orphaned worktree could not be removed."));
      } finally {
        if (mountedRef.current) {
          setRemovingOrphans((current) => withoutPath(current, worktreePath));
          void refreshOrphanedWorktrees();
        }
      }
    },
    [refreshOrphanedWorktrees],
  );

  const pruneOrphanedWorktrees = useCallback(
    async (repositoryRoot: string): Promise<void> => {
      if (
        [...uncertainWorktreePathsRef.current].some((path) =>
          isAgentWorktreePath(repositoryRoot, path),
        )
      ) {
        dependenciesRef.current.setNotice(
          warning(
            "Worktrees with uncertain live agents cannot be pruned until terminal cleanup is proven.",
          ),
        );
        return;
      }
      const pruned = await tryOrReport(
        () => dependenciesRef.current.gitWorktreeGateway.pruneWorktrees(repositoryRoot),
        dependenciesRef,
      );
      if (!mountedRef.current) return;
      if (!pruned.ok) {
        dependenciesRef.current.setNotice(failure("The stale worktrees could not be pruned."));
        return;
      }
      dependenciesRef.current.setNotice(info("Stale worktree registrations were pruned."));
      void refreshOrphanedWorktrees();
    },
    [refreshOrphanedWorktrees],
  );

  const orphanedWorktrees = useMemo(
    () =>
      orphanedWorktreeViews(
        listings,
        dependencies.threads,
        removingOrphans,
        uncertainWorktreePathsRef.current,
      ),
    [dependencies.threads, listings, removingOrphans],
  );

  const missingWorktreeThreadIds = useMemo(
    () => missingWorktrees(listings, dependencies.threads),
    [dependencies.threads, listings],
  );

  return {
    orphanedWorktrees,
    missingWorktreeThreadIds,
    removedWorktreeThreadIds,
    refreshOrphanedWorktrees,
    retainUncertainWorktree,
    removeWorktree,
    removeOrphanedWorktree,
    pruneOrphanedWorktrees,
  };
}

function repositoryListing(
  repositoryRoot: string,
  descriptors: ReadonlyArray<GitWorktreeDescriptor>,
): RepositoryWorktreeListing {
  const worktreePaths = new Set<string>();
  const prunablePaths = new Set<string>();
  const candidates: OrphanedWorktreeCandidate[] = [];
  for (const descriptor of descriptors) {
    if (descriptor.isPrimary) continue;
    worktreePaths.add(descriptor.worktreePath);
    if (descriptor.prunable) prunablePaths.add(descriptor.worktreePath);
    if (!isAgentWorktreePath(repositoryRoot, descriptor.worktreePath)) continue;
    candidates.push({
      repositoryRoot,
      worktreePath: descriptor.worktreePath,
      branch: descriptor.branch,
      prunable: descriptor.prunable,
    });
  }
  return { worktreePaths, prunablePaths, candidates };
}

function candidateFor(
  listings: ReadonlyMap<string, RepositoryWorktreeListing>,
  worktreePath: string,
): OrphanedWorktreeCandidate | null {
  for (const listing of listings.values()) {
    const candidate = listing.candidates.find((entry) => entry.worktreePath === worktreePath);
    if (candidate !== undefined) return candidate;
  }
  return null;
}

function orphanedWorktreeViews(
  listings: ReadonlyMap<string, RepositoryWorktreeListing>,
  threads: ReadonlyMap<string, AgentThread>,
  removing: ReadonlySet<string>,
  uncertainWorktreePaths: ReadonlySet<string>,
): ReadonlyArray<OrphanedWorktreeView> {
  const owned = ownedWorktreePaths(threads);
  const views: OrphanedWorktreeView[] = [];
  for (const listing of listings.values()) {
    for (const candidate of listing.candidates) {
      if (owned.has(candidate.worktreePath)) continue;
      if (uncertainWorktreePaths.has(candidate.worktreePath)) continue;
      views.push({ ...candidate, removing: removing.has(candidate.worktreePath) });
    }
  }
  return views.sort((left, right) => left.worktreePath.localeCompare(right.worktreePath));
}

function missingWorktrees(
  listings: ReadonlyMap<string, RepositoryWorktreeListing>,
  threads: ReadonlyMap<string, AgentThread>,
): ReadonlySet<string> {
  const missing = new Set<string>();
  for (const thread of threads.values()) {
    const worktreePath = thread.target.worktreePath;
    if (worktreePath === null) continue;
    const listing = listings.get(thread.owner.repositoryRoot);
    if (listing === undefined) continue;
    if (listing.prunablePaths.has(worktreePath) || !listing.worktreePaths.has(worktreePath)) {
      missing.add(thread.threadId);
    }
  }
  return missing;
}

function ownedWorktreePaths(threads: ReadonlyMap<string, AgentThread>): ReadonlySet<string> {
  const owned = new Set<string>();
  for (const thread of threads.values()) {
    if (thread.target.worktreePath === null) continue;
    owned.add(thread.target.worktreePath);
  }
  return owned;
}

function withoutPath(current: ReadonlySet<string>, worktreePath: string): ReadonlySet<string> {
  if (!current.has(worktreePath)) return current;
  const next = new Set(current);
  next.delete(worktreePath);
  return next;
}

function isAgentWorktreePath(repositoryRoot: string, worktreePath: string): boolean {
  return worktreePath.startsWith(`${repositoryRoot}/${WORKTREE_BASE_DIR_NAME}/`);
}
