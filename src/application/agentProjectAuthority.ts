import { agentProjectOwnsLaunchRoot, type AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentTasksNotice, AgentTasksNoticeUpdate } from "./agentThreadPorts";

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
  return projects.find((project) => agentProjectOwnsLaunchRoot(project, repositoryRoot));
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

export type AgentLaunchAuthorityLoss =
  | "surfaceClosed"
  | "projectClosed"
  | "projectReopened"
  | "projectOwnerReplaced"
  | "repositoryRemoved"
  | "workspaceUnregistered"
  | "workspaceReplaced";

export function agentLaunchAuthorityLossDetail(loss: AgentLaunchAuthorityLoss): string {
  switch (loss) {
    case "surfaceClosed":
      return "the agent view was closed";
    case "projectClosed":
      return "its project was closed";
    case "projectReopened":
      return "its project was closed and opened again";
    case "projectOwnerReplaced":
      return "its project changed owner";
    case "repositoryRemoved":
      return "its repository left the project";
    case "workspaceUnregistered":
      return "its workspace is closing or no longer registered";
    case "workspaceReplaced":
      return "its workspace was registered again";
    default:
      return unsupportedLaunchAuthorityLoss(loss);
  }
}

function unsupportedLaunchAuthorityLoss(loss: never): never {
  throw new TypeError(`Unsupported launch authority loss: ${String(loss)}.`);
}

export function projectHoldsAuthority(
  project: AgentProjectDescriptor,
  authority: AgentProjectAuthority,
): boolean {
  if (project.rootKey !== authority.rootKey) return false;
  if (project.generation !== authority.generation) return false;
  if (project.ownerId === authority.ownerId) return true;
  return project.runtimeOwnerIds?.includes(authority.ownerId) === true;
}

export function agentLaunchReplacedBeforeSendNotice(
  loss: AgentLaunchAuthorityLoss,
  projectRootKey: string,
): AgentTasksNotice {
  return {
    kind: "warning",
    message: `The message was not sent because ${agentLaunchAuthorityLossDetail(loss)} while it was being prepared. Send it again.`,
    action: null,
    projectRootKey,
  };
}

export function agentNoticeForProject(
  notice: AgentTasksNotice | null,
  projectRootKey: string | null,
): AgentTasksNotice | null {
  if (notice === null || notice.projectRootKey === undefined) return notice;
  return notice.projectRootKey === projectRootKey ? notice : null;
}

export function launchAuthorityHolds(
  dependenciesRef: AgentLaunchProjectsRef & {
    readonly current: { readonly setNotice: (update: AgentTasksNoticeUpdate) => void };
  },
  loss: AgentLaunchAuthorityLoss | null,
  rootKey: string,
): boolean {
  if (loss === null) return true;
  if (!launchRootReplacedWhileShown(dependenciesRef, loss, rootKey)) return false;
  const refusal = agentLaunchReplacedBeforeSendNotice(loss, rootKey);
  dependenciesRef.current.setNotice((current) =>
    current === null || current.projectRootKey === rootKey ? refusal : current,
  );
  return false;
}

function launchRootReplacedWhileShown(
  dependenciesRef: AgentLaunchProjectsRef,
  loss: AgentLaunchAuthorityLoss,
  rootKey: string,
): boolean {
  if (loss !== "projectReopened" && loss !== "projectOwnerReplaced" && loss !== "workspaceReplaced")
    return false;
  const project = projectByRootKey(dependenciesRef.current.projects, rootKey);
  if (project?.origin !== "active-tab") return false;
  return dependenciesRef.current.launchIdentityForProject(rootKey) !== null;
}

function projectOwnerLoss(
  dependenciesRef: AgentProjectsRef,
  mountedRef: MountedRef,
  authority: AgentProjectAuthority,
): AgentLaunchAuthorityLoss | null {
  if (!mountedRef.current) return "surfaceClosed";
  const project = projectByRootKey(dependenciesRef.current.projects, authority.rootKey);
  if (project === undefined) return "projectClosed";
  if (project.generation !== authority.generation) return "projectReopened";
  if (!projectHoldsAuthority(project, authority)) return "projectOwnerReplaced";
  return null;
}

function repositoryLoss(
  dependenciesRef: AgentProjectsRef,
  authority: AgentProjectAuthority,
  repositoryRoot: string,
): AgentLaunchAuthorityLoss | null {
  const project = projectByRootKey(dependenciesRef.current.projects, authority.rootKey);
  if (project !== undefined && agentProjectOwnsLaunchRoot(project, repositoryRoot)) return null;
  return "repositoryRemoved";
}

function workspaceIdentityLoss(
  dependenciesRef: AgentLaunchProjectsRef,
  authority: AgentTaskLaunchAuthority,
): AgentLaunchAuthorityLoss | null {
  const identity = dependenciesRef.current.launchIdentityForProject(authority.rootKey);
  if (identity === null) return "workspaceUnregistered";
  if (
    identity.workspaceId !== authority.workspaceId ||
    identity.generation !== authority.workspaceGeneration
  )
    return "workspaceReplaced";
  return null;
}

export function isCurrentProjectOwner(
  dependenciesRef: AgentProjectsRef,
  mountedRef: MountedRef,
  authority: AgentProjectAuthority,
  repositoryRoot: string,
): boolean {
  if (projectOwnerLoss(dependenciesRef, mountedRef, authority) !== null) return false;
  return repositoryLoss(dependenciesRef, authority, repositoryRoot) === null;
}

export function taskLaunchAuthorityLoss(
  dependenciesRef: AgentLaunchProjectsRef,
  mountedRef: MountedRef,
  authority: AgentTaskLaunchAuthority,
  repositoryRoot: string,
): AgentLaunchAuthorityLoss | null {
  return (
    projectOwnerLoss(dependenciesRef, mountedRef, authority) ??
    repositoryLoss(dependenciesRef, authority, repositoryRoot) ??
    workspaceIdentityLoss(dependenciesRef, authority)
  );
}

export function threadLaunchAuthorityLoss(
  dependenciesRef: AgentLaunchProjectsRef,
  mountedRef: MountedRef,
  authority: AgentTaskLaunchAuthority,
): AgentLaunchAuthorityLoss | null {
  return (
    projectOwnerLoss(dependenciesRef, mountedRef, authority) ??
    workspaceIdentityLoss(dependenciesRef, authority)
  );
}

export function isCurrentTaskLaunchAuthority(
  dependenciesRef: AgentLaunchProjectsRef,
  mountedRef: MountedRef,
  authority: AgentTaskLaunchAuthority,
  repositoryRoot: string,
): boolean {
  return taskLaunchAuthorityLoss(dependenciesRef, mountedRef, authority, repositoryRoot) === null;
}

export function sameLaunchAuthority(
  left: AgentTaskLaunchAuthority,
  right: AgentTaskLaunchAuthority,
): boolean {
  return (
    left.rootKey === right.rootKey &&
    left.ownerId === right.ownerId &&
    left.generation === right.generation &&
    left.workspaceId === right.workspaceId &&
    left.workspaceGeneration === right.workspaceGeneration
  );
}

export function isCurrentThreadLaunchAuthority(
  dependenciesRef: AgentLaunchProjectsRef,
  mountedRef: MountedRef,
  authority: AgentTaskLaunchAuthority,
): boolean {
  return threadLaunchAuthorityLoss(dependenciesRef, mountedRef, authority) === null;
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
