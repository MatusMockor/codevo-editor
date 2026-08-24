import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from "react";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import {
  defaultAgentTaskIsolation,
  inPlaceDispatchGuard,
  type AgentIsolationDefault,
  type AgentTaskIsolationContext,
  type InPlaceDispatchUnsafeReason,
} from "../domain/agentTask";
import { normalizeAgentIsolationPolicy } from "../domain/agentSettings";
import type { GitGateway, GitStatus } from "../domain/git";
import {
  AGENT_TASKS_SOURCE,
  attempt,
  isCurrentProjectOwner,
  owningProjectForRepository,
  projectAuthority,
  sameOptionalProjectAuthority,
  sameProjectAuthority,
  type AgentProjectAuthority,
} from "./agentProjectAuthority";
import type { AgentIsolationPreview, AgentRepositoryStatusSnapshot } from "./agentThreadPorts";

export interface AgentIsolationPreviewDependencies {
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly gitGateway: Pick<GitGateway, "getStatus">;
  readonly getRepositoryStatus: (repositoryRoot: string) => AgentRepositoryStatusSnapshot;
  readonly getDirtyEditorDocumentCount: (repositoryRoot: string) => number;
  readonly liveAgentTasksInRepository: (repositoryRoot: string) => number;
  readonly reportError: (source: string, error: unknown) => void;
}

export type InPlacePreflight =
  | { readonly kind: "ok" }
  | { readonly kind: "owner-lost" }
  | { readonly kind: "superseded" }
  | { readonly kind: "status-failed"; readonly error: unknown }
  | { readonly kind: "unsafe"; readonly label: string };

export interface AgentIsolationPreviewSurface {
  isolationContext(repositoryRoot: string): AgentTaskIsolationContext;
  isolationPreview(repositoryRoot: string): AgentIsolationPreview;
  refreshIsolationStatus(repositoryRoot: string): Promise<void>;
  preflightInPlace(
    repositoryRoot: string,
    authority: AgentProjectAuthority,
    unsafeInPlaceConfirmationKey: string | null,
  ): Promise<InPlacePreflight>;
}

interface FreshIsolationStatus {
  readonly authority: AgentProjectAuthority;
  readonly snapshot: AgentRepositoryStatusSnapshot;
}

export function useAgentIsolationPreview(
  dependencies: AgentIsolationPreviewDependencies,
): AgentIsolationPreviewSurface {
  const dependenciesRef = useRef(dependencies);
  const mountedRef = useRef(true);
  const statusesRef = useRef<ReadonlyMap<string, FreshIsolationStatus>>(new Map());
  const requestGenerationsRef = useRef<ReadonlyMap<string, number>>(new Map());
  const [, publishGeneration] = useReducer((generation: number) => generation + 1, 0);

  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isolationContext = useCallback((repositoryRoot: string): AgentTaskIsolationContext => {
    const deps = dependenciesRef.current;
    const project = owningProjectForRepository(deps.projects, repositoryRoot);
    const authority = project === undefined ? null : projectAuthority(project);
    const fresh = statusesRef.current.get(repositoryRoot);
    const status =
      fresh !== undefined && authority !== null && sameProjectAuthority(fresh.authority, authority)
        ? fresh.snapshot
        : deps.getRepositoryStatus(repositoryRoot);
    return {
      workspacePolicy: normalizeAgentIsolationPolicy(project?.isolationPolicy ?? "auto"),
      repositoryStatusKnown: status.known,
      repositoryDirty: status.dirty,
      dirtyEditorDocumentsInRepository:
        project?.origin === "active-tab"
          ? Math.max(0, Math.trunc(deps.getDirtyEditorDocumentCount(repositoryRoot)))
          : 0,
      liveAgentTasksInRepository: deps.liveAgentTasksInRepository(repositoryRoot),
      plannedParallelDispatch: false,
    };
  }, []);

  const nextRequestGeneration = useCallback((repositoryRoot: string): number => {
    const generation = (requestGenerationsRef.current.get(repositoryRoot) ?? 0) + 1;
    requestGenerationsRef.current = new Map(requestGenerationsRef.current).set(
      repositoryRoot,
      generation,
    );
    return generation;
  }, []);

  const storeStatus = useCallback((repositoryRoot: string, status: FreshIsolationStatus): void => {
    statusesRef.current = new Map(statusesRef.current).set(repositoryRoot, status);
    if (mountedRef.current) publishGeneration();
  }, []);

  const refreshIsolationStatus = useCallback(
    async (repositoryRoot: string): Promise<void> => {
      const deps = dependenciesRef.current;
      const project = owningProjectForRepository(deps.projects, repositoryRoot);
      if (project === undefined) return;
      const authority = projectAuthority(project);
      const requestGeneration = nextRequestGeneration(repositoryRoot);
      if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) return;
      const result = await attempt(() => deps.gitGateway.getStatus(repositoryRoot));
      if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) return;
      if (requestGenerationsRef.current.get(repositoryRoot) !== requestGeneration) return;
      if (!result.ok) deps.reportError(AGENT_TASKS_SOURCE, result.error);
      storeStatus(
        repositoryRoot,
        result.ok
          ? freshIsolationStatus(authority, repositoryRoot, result.value)
          : unknownIsolationStatus(authority),
      );
    },
    [nextRequestGeneration, storeStatus],
  );

  const isolationPreview = useCallback(
    (repositoryRoot: string): AgentIsolationPreview => {
      const deps = dependenciesRef.current;
      const project = owningProjectForRepository(deps.projects, repositoryRoot);
      const inPlaceAllowed = project?.origin === "active-tab";
      const context = isolationContext(repositoryRoot);
      const authority = project === undefined ? null : projectAuthority(project);
      const confirmationKey =
        authority !== null &&
        sameOptionalProjectAuthority(statusesRef.current.get(repositoryRoot)?.authority, authority)
          ? isolationConfirmationKey(repositoryRoot, context, authority)
          : null;
      return {
        repositoryRoot,
        recommended: inPlaceAllowed
          ? defaultAgentTaskIsolation(context)
          : { kind: "worktree", reason: "policy" },
        inPlaceGuard: inPlaceDispatchGuard(context),
        inPlaceAllowed,
        confirmationKey,
      };
    },
    [isolationContext],
  );

  const preflightInPlace = useCallback(
    async (
      repositoryRoot: string,
      authority: AgentProjectAuthority,
      unsafeInPlaceConfirmationKey: string | null,
    ): Promise<InPlacePreflight> => {
      const deps = dependenciesRef.current;
      const requestGeneration = nextRequestGeneration(repositoryRoot);
      if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) {
        return { kind: "owner-lost" };
      }
      const status = await attempt(() => deps.gitGateway.getStatus(repositoryRoot));
      if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) {
        return { kind: "owner-lost" };
      }
      if (requestGenerationsRef.current.get(repositoryRoot) !== requestGeneration) {
        return { kind: "superseded" };
      }
      if (!status.ok) return { kind: "status-failed", error: status.error };
      storeStatus(repositoryRoot, freshIsolationStatus(authority, repositoryRoot, status.value));
      const context = isolationContext(repositoryRoot);
      const guard = inPlaceDispatchGuard(context);
      const confirmationKey = isolationConfirmationKey(repositoryRoot, context, authority);
      if (
        guard.kind === "unsafe" &&
        (confirmationKey === null || unsafeInPlaceConfirmationKey !== confirmationKey)
      ) {
        return { kind: "unsafe", label: guardReasonsLabel(guard.reasons) };
      }
      if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) {
        return { kind: "owner-lost" };
      }
      return { kind: "ok" };
    },
    [isolationContext, nextRequestGeneration, storeStatus],
  );

  return { isolationContext, isolationPreview, refreshIsolationStatus, preflightInPlace };
}

function freshIsolationStatus(
  authority: AgentProjectAuthority,
  repositoryRoot: string,
  status: GitStatus,
): FreshIsolationStatus {
  if (!status.isRepository || status.rootPath !== repositoryRoot) {
    return unknownIsolationStatus(authority);
  }
  return { authority, snapshot: { known: true, dirty: status.changes.length > 0 } };
}

function unknownIsolationStatus(authority: AgentProjectAuthority): FreshIsolationStatus {
  return { authority, snapshot: { known: false, dirty: false } };
}

function isolationConfirmationKey(
  repositoryRoot: string,
  context: AgentTaskIsolationContext,
  authority: AgentProjectAuthority,
): string | null {
  if (!context.repositoryStatusKnown) return null;
  return JSON.stringify({ authority, repositoryRoot, ...context });
}

function guardReasonsLabel(reasons: ReadonlyArray<InPlaceDispatchUnsafeReason>): string {
  return reasons.map(inPlaceGuardReasonLabel).join(", ");
}

export function inPlaceGuardReasonLabel(reason: InPlaceDispatchUnsafeReason): string {
  switch (reason) {
    case "agent-active":
      return "another agent is already running in this repository";
    case "dirty-tree":
      return "the working tree has uncommitted changes";
    case "dirty-editors":
      return "unsaved editors belong to this repository";
    case "status-unknown":
      return "the repository status is unknown";
    default:
      return unsupportedGuardReason(reason);
  }
}

export function agentIsolationReasonLabel(recommended: AgentIsolationDefault): string {
  if (recommended.kind === "in-place") {
    return "The repository is clean, so the agent can work directly in it.";
  }
  switch (recommended.reason) {
    case "policy":
      return "This workspace always isolates agents in a worktree.";
    case "agent-active":
      return "Another agent is already running in this repository.";
    case "parallel-dispatch":
      return "Several agents are being started at once.";
    case "status-unknown":
      return "The repository status is unknown.";
    case "dirty-tree":
      return "The working tree has uncommitted changes.";
    case "dirty-editors":
      return "This repository has unsaved editors.";
    default:
      return unsupportedIsolationReason(recommended.reason);
  }
}

function unsupportedGuardReason(reason: never): never {
  throw new TypeError(`Unsupported in-place guard reason: ${String(reason)}.`);
}

function unsupportedIsolationReason(reason: never): never {
  throw new TypeError(`Unsupported agent isolation reason: ${String(reason)}.`);
}
