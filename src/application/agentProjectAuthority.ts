import type { AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentTasksNotice } from "./agentThreadPorts";

export const AGENT_TASKS_SOURCE = "Agents";

export interface AgentProjectAuthority {
  readonly rootKey: string;
  readonly ownerId: string;
  readonly generation: number;
}

export interface AgentTaskLaunchAuthority extends AgentProjectAuthority {
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
}

export interface AgentProjectLaunchIdentity {
  readonly workspaceId: string;
  readonly generation: number;
}

export interface AgentProjectsRef {
  readonly current: { readonly projects: ReadonlyArray<AgentProjectDescriptor> };
}

export interface AgentLaunchProjectsRef {
  readonly current: {
    readonly projects: ReadonlyArray<AgentProjectDescriptor>;
    readonly launchIdentityForProject: (rootKey: string) => AgentProjectLaunchIdentity | null;
  };
}

export interface AgentErrorReporterRef {
  readonly current: { readonly reportError: (source: string, error: unknown) => void };
}

export interface MountedRef {
  readonly current: boolean;
}

export type Attempt<TValue> =
  { readonly ok: true; readonly value: TValue } | { readonly ok: false; readonly error: unknown };

export function projectAuthority(
  project: AgentProjectDescriptor,
  ownerId: string = project.ownerId,
): AgentProjectAuthority {
  return {
    rootKey: project.rootKey,
    ownerId,
    generation: project.generation,
  };
}

export function taskLaunchAuthority(
  project: AgentProjectDescriptor,
  identity: AgentProjectLaunchIdentity,
): AgentTaskLaunchAuthority {
  return {
    ...projectAuthority(project),
    workspaceId: identity.workspaceId,
    workspaceGeneration: identity.generation,
  };
}

export function projectByRootKey(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  rootKey: string,
): AgentProjectDescriptor | undefined {
  return projects.find((project) => project.rootKey === rootKey);
}

export function projectByOwnerId(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  ownerId: string,
): AgentProjectDescriptor | undefined {
  return projects.find(
    (project) => project.ownerId === ownerId || project.runtimeOwnerIds?.includes(ownerId) === true,
  );
}

export function owningProjectForRepository(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  repositoryRoot: string,
): AgentProjectDescriptor | undefined {
  return projects.find((project) =>
    project.repositories.some((repository) => repository.repositoryRoot === repositoryRoot),
  );
}

export function sameProjectAuthority(
  left: AgentProjectAuthority,
  right: AgentProjectAuthority,
): boolean {
  return (
    left.rootKey === right.rootKey &&
    left.ownerId === right.ownerId &&
    left.generation === right.generation
  );
}

export function sameOptionalProjectAuthority(
  left: AgentProjectAuthority | undefined,
  right: AgentProjectAuthority,
): boolean {
  return left !== undefined && sameProjectAuthority(left, right);
}

export function isCurrentProjectOwner(
  dependenciesRef: AgentProjectsRef,
  mountedRef: MountedRef,
  authority: AgentProjectAuthority,
  repositoryRoot: string,
): boolean {
  if (!mountedRef.current) return false;
  const project = projectByRootKey(dependenciesRef.current.projects, authority.rootKey);
  if (project === undefined) return false;
  if (project.generation !== authority.generation) return false;
  if (
    project.ownerId !== authority.ownerId &&
    project.runtimeOwnerIds?.includes(authority.ownerId) !== true
  )
    return false;
  return project.repositories.some((repository) => repository.repositoryRoot === repositoryRoot);
}

export function isCurrentTaskLaunchAuthority(
  dependenciesRef: AgentLaunchProjectsRef,
  mountedRef: MountedRef,
  authority: AgentTaskLaunchAuthority,
  repositoryRoot: string,
): boolean {
  if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) return false;
  const identity = dependenciesRef.current.launchIdentityForProject(authority.rootKey);
  if (identity === null) return false;
  return (
    identity.workspaceId === authority.workspaceId &&
    identity.generation === authority.workspaceGeneration
  );
}

export function isCurrentThreadLaunchAuthority(
  dependenciesRef: AgentLaunchProjectsRef,
  mountedRef: MountedRef,
  authority: AgentTaskLaunchAuthority,
): boolean {
  if (!mountedRef.current) return false;
  const project = projectByRootKey(dependenciesRef.current.projects, authority.rootKey);
  if (project === undefined || project.generation !== authority.generation) return false;
  if (
    project.ownerId !== authority.ownerId &&
    project.runtimeOwnerIds?.includes(authority.ownerId) !== true
  ) {
    return false;
  }
  const identity = dependenciesRef.current.launchIdentityForProject(authority.rootKey);
  return (
    identity !== null &&
    identity.workspaceId === authority.workspaceId &&
    identity.generation === authority.workspaceGeneration
  );
}

export async function tryOrReport<TValue>(
  operation: () => Promise<TValue>,
  dependenciesRef: AgentErrorReporterRef,
): Promise<Attempt<TValue>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, error);
    return { ok: false, error };
  }
}

export async function attempt<TValue>(operation: () => Promise<TValue>): Promise<Attempt<TValue>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error };
  }
}

export function warning(message: string): AgentTasksNotice {
  return { kind: "warning", message, action: null };
}

export function info(message: string): AgentTasksNotice {
  return { kind: "info", message, action: null };
}

export function failure(message: string): AgentTasksNotice {
  return { kind: "error", message, action: null };
}

export function errorMessageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "";
}
