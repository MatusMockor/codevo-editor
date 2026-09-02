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
  errorMessageOf,
  isCurrentProjectOwner,
  owningProjectForRepository,
  projectAuthority,
  sameOptionalProjectAuthority,
  sameProjectAuthority,
  type AgentProjectAuthority,
} from "./agentProjectAuthority";
import type {
  AgentIsolationPreview,
  AgentRepositoryProbeOutcome,
  AgentRepositoryProbeState,
  AgentRepositoryStatusSnapshot,
} from "./agentThreadPorts";

const MAX_REPOSITORY_STATUS_ERROR_LENGTH = 512;
const UTF8_ENCODER = new TextEncoder();

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
  refreshIsolationStatus(repositoryRoot: string): Promise<AgentRepositoryProbeOutcome>;
  preflightInPlace(
    repositoryRoot: string,
    authority: AgentProjectAuthority,
    unsafeInPlaceConfirmationKey: string | null,
  ): Promise<InPlacePreflight>;
}

interface FreshIsolationStatus {
  readonly authority: AgentProjectAuthority;
  readonly snapshot: AgentRepositoryStatusSnapshot;
  readonly state: AgentRepositoryProbeState;
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
    async (repositoryRoot: string): Promise<AgentRepositoryProbeOutcome> => {
      const deps = dependenciesRef.current;
      const project = owningProjectForRepository(deps.projects, repositoryRoot);
      if (project === undefined || project.trust !== "trusted") return { kind: "unavailable" };
      const authority = projectAuthority(project);
      const requestGeneration = nextRequestGeneration(repositoryRoot);
      if (!isCurrentTrustedProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) {
        return { kind: "stale" };
      }
      storeStatus(repositoryRoot, checkingIsolationStatus(authority));
      const result = await attempt(() => deps.gitGateway.getStatus(repositoryRoot));
      if (!isCurrentTrustedProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) {
        return { kind: "stale" };
      }
      if (requestGenerationsRef.current.get(repositoryRoot) !== requestGeneration) {
        return { kind: "stale" };
      }
      if (!result.ok) {
        deps.reportError(AGENT_TASKS_SOURCE, result.error);
        storeStatus(repositoryRoot, failedIsolationStatus(authority, result.error));
        return { kind: "failed" };
      }
      const status = freshIsolationStatus(authority, repositoryRoot, result.value);
      storeStatus(repositoryRoot, status);
      return status.state.kind === "ready" ? { kind: "ready", authority } : { kind: "failed" };
    },
    [nextRequestGeneration, storeStatus],
  );

  const isolationPreview = useCallback(
    (repositoryRoot: string): AgentIsolationPreview => {
      const deps = dependenciesRef.current;
      const project = owningProjectForRepository(deps.projects, repositoryRoot);
      const inPlaceAllowed = project?.origin === "active-tab" && project.trust === "trusted";
      const context = isolationContext(repositoryRoot);
      const authority = project === undefined ? null : projectAuthority(project);
      const repositoryStatus = repositoryProbeState(
        project,
        authority,
        statusesRef.current.get(repositoryRoot),
        context,
      );
      const confirmationKey =
        authority !== null &&
        sameOptionalProjectAuthority(statusesRef.current.get(repositoryRoot)?.authority, authority)
          ? isolationConfirmationKey(repositoryRoot, context, authority)
          : null;
      return {
        repositoryRoot,
        repositoryStatus,
        recommended: inPlaceAllowed
          ? recommendedIsolation(context)
          : { kind: "worktree", reason: "policy" },
        inPlaceGuard:
          repositoryStatus.kind === "ready" ? inPlaceDispatchGuard(context) : { kind: "safe" },
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
      if (!isCurrentTrustedProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) {
        return { kind: "owner-lost" };
      }
      const status = await attempt(() => deps.gitGateway.getStatus(repositoryRoot));
      if (!isCurrentTrustedProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) {
        return { kind: "owner-lost" };
      }
      if (requestGenerationsRef.current.get(repositoryRoot) !== requestGeneration) {
        return { kind: "superseded" };
      }
      if (!status.ok) {
        storeStatus(repositoryRoot, failedIsolationStatus(authority, status.error));
        return { kind: "status-failed", error: status.error };
      }
      const fresh = freshIsolationStatus(authority, repositoryRoot, status.value);
      storeStatus(repositoryRoot, fresh);
      if (fresh.state.kind === "failed") {
        return { kind: "status-failed", error: new Error(fresh.state.message) };
      }
      const context = isolationContext(repositoryRoot);
      const guard = inPlaceDispatchGuard(context);
      const confirmationKey = isolationConfirmationKey(repositoryRoot, context, authority);
      if (
        guard.kind === "unsafe" &&
        (confirmationKey === null || unsafeInPlaceConfirmationKey !== confirmationKey)
      ) {
        return { kind: "unsafe", label: guardReasonsLabel(guard.reasons) };
      }
      if (!isCurrentTrustedProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) {
        return { kind: "owner-lost" };
      }
      return { kind: "ok" };
    },
    [isolationContext, nextRequestGeneration, storeStatus],
  );

  return { isolationContext, isolationPreview, refreshIsolationStatus, preflightInPlace };
}

function isCurrentTrustedProjectOwner(
  dependenciesRef: {
    readonly current: Pick<AgentIsolationPreviewDependencies, "projects">;
  },
  mountedRef: { readonly current: boolean },
  authority: AgentProjectAuthority,
  repositoryRoot: string,
): boolean {
  if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) return false;
  const project = owningProjectForRepository(dependenciesRef.current.projects, repositoryRoot);
  return (
    project !== undefined &&
    project.trust === "trusted" &&
    sameProjectAuthority(projectAuthority(project), authority)
  );
}

function freshIsolationStatus(
  authority: AgentProjectAuthority,
  repositoryRoot: string,
  status: GitStatus,
): FreshIsolationStatus {
  if (!status.isRepository || status.rootPath !== repositoryRoot) {
    return failedIsolationStatus(
      authority,
      new Error("Git did not return status for the selected repository."),
    );
  }
  return {
    authority,
    snapshot: { known: true, dirty: status.changes.length > 0 },
    state: { kind: "ready" },
  };
}

function checkingIsolationStatus(authority: AgentProjectAuthority): FreshIsolationStatus {
  return { authority, snapshot: { known: false, dirty: false }, state: { kind: "checking" } };
}

function failedIsolationStatus(
  authority: AgentProjectAuthority,
  error: unknown,
): FreshIsolationStatus {
  const message = boundedStatusError(error);
  return {
    authority,
    snapshot: { known: false, dirty: false },
    state: {
      kind: "failed",
      message,
    },
  };
}

function boundedStatusError(error: unknown): string {
  const detail = errorMessageOf(error).trim();
  const message = `Repository status check failed${detail === "" ? "." : `: ${detail}`}`;
  if (UTF8_ENCODER.encode(message).byteLength <= MAX_REPOSITORY_STATUS_ERROR_LENGTH) return message;
  let bounded = "";
  for (const character of message) {
    const next = `${bounded}${character}`;
    if (UTF8_ENCODER.encode(next).byteLength > MAX_REPOSITORY_STATUS_ERROR_LENGTH) break;
    bounded = next;
  }
  return bounded;
}

function repositoryProbeState(
  project: AgentProjectDescriptor | undefined,
  authority: AgentProjectAuthority | null,
  fresh: FreshIsolationStatus | undefined,
  context: AgentTaskIsolationContext,
): AgentRepositoryProbeState {
  if (project === undefined) {
    return { kind: "unavailable", message: "Select an available project repository." };
  }
  if (project.trust !== "trusted") {
    return { kind: "unavailable", message: "Trust this project to check its repository." };
  }
  if (
    authority !== null &&
    fresh !== undefined &&
    sameProjectAuthority(fresh.authority, authority)
  ) {
    return fresh.state;
  }
  return context.repositoryStatusKnown ? { kind: "ready" } : { kind: "checking" };
}

function recommendedIsolation(context: AgentTaskIsolationContext): AgentIsolationDefault {
  const recommended = defaultAgentTaskIsolation(context);
  if (recommended.kind === "in-place" && context.workspacePolicy === "auto") {
    return { kind: "worktree", reason: "policy" };
  }
  return recommended;
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
      return "Agents start in an isolated worktree by default.";
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
