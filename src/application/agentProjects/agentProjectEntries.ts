import {
  MAX_AGENT_PROJECT_ROOTS,
  type AgentProjectDescriptor,
  type AgentProjectOrigin,
  type AgentProjectTrust,
  type AgentRootLeaseReleaseResult,
} from "../../domain/agentProject";
import {
  DEFAULT_AGENT_ISOLATION_POLICY,
  type AgentIsolationPolicy,
} from "../../domain/agentSettings";
import {
  repositoryRootForMapping,
  resolveEffectiveGitRepositoryMappings,
  type ResolvedGitRepository,
} from "../../domain/gitRepositoryMapping";
import { normalizedWorkspaceRootKey, workspaceDisplayName } from "../../domain/workspaceRootKey";
import { workspaceSettingsIdentity } from "../workspace/workspaceIdentityPolicy";
import type { AgentProjectsDependencies } from "./agentProjectsContract";

export const AGENT_PROJECTS_SOURCE = "Agents";

export interface AgentProjectEntry {
  readonly rootKey: string;
  readonly rootPath: string;
  readonly ownerId: string;
  readonly supersededOwnerId: string | null;
  readonly workspaceId: string | null;
  readonly observedWorkspaceId: string | null;
  readonly workspaceGeneration: number;
  readonly retiredWorkspaceIds: ReadonlyArray<string>;
  readonly generation: number;
  readonly trust: AgentProjectTrust;
  readonly isolationPolicy: AgentIsolationPolicy | null;
  readonly repositories: ReadonlyArray<ResolvedGitRepository> | null;
  readonly leaseToken: number | null;
  readonly admitted: boolean;
  readonly releasing: boolean;
}

export interface AgentProjectLease {
  readonly rootPath: string;
  readonly leaseToken: number;
}

export interface AdmissionCandidate {
  readonly rootKey: string;
  readonly rootPath: string;
}

export interface Admission {
  readonly admitted: ReadonlyArray<AdmissionCandidate>;
  readonly overflow: ReadonlyArray<string>;
}

export type Attempt<TValue> =
  { readonly ok: true; readonly value: TValue } | { readonly ok: false; readonly error: unknown };

export async function attempt<TValue>(operation: () => Promise<TValue>): Promise<Attempt<TValue>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error };
  }
}

export function agentRootLeaseReleaseFailure(
  result: AgentRootLeaseReleaseResult,
  expectedLeaseToken: number,
): Error | null {
  if (result.leaseToken !== expectedLeaseToken) {
    return new Error("Agent root lease release returned a mismatched lease token.");
  }
  switch (result.kind) {
    case "released":
      return null;
    case "notHeld":
      return new Error("Agent root lease release reported that the lease was not held.");
    case "foreignOwner":
      return new Error("Agent root lease release reported a foreign lease owner.");
    default:
      return assertNever(result);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected agent root lease release result: ${String(value)}`);
}

export function entryOwnerIds(entry: AgentProjectEntry): ReadonlyArray<string> {
  const ownerIds = new Set(entry.retiredWorkspaceIds);
  if (entry.supersededOwnerId !== null) ownerIds.add(entry.supersededOwnerId);
  ownerIds.add(entry.ownerId);
  if (entry.workspaceId !== null) ownerIds.add(entry.workspaceId);
  return [...ownerIds];
}

export function entryHasLiveTasks(
  dependencies: Pick<AgentProjectsDependencies, "hasLiveTasksForOwner">,
  entry: AgentProjectEntry,
): boolean {
  return entryOwnerIds(entry).some((ownerId) => dependencies.hasLiveTasksForOwner(ownerId));
}

export function activeWorkspaceTrustForRoot(
  dependencies: AgentProjectsDependencies,
  rootPath: string,
): AgentProjectTrust | null {
  if (!dependencies.enabled) return null;
  if (dependencies.activeWorkspaceRoot === null) return null;
  if (dependencies.activeWorkspaceTrust === null) return null;
  const rootKey = normalizedWorkspaceRootKey(rootPath);
  if (normalizedWorkspaceRootKey(dependencies.activeWorkspaceRoot) !== rootKey) return null;
  if (normalizedWorkspaceRootKey(dependencies.activeWorkspaceTrust.rootPath) !== rootKey)
    return null;
  return dependencies.activeWorkspaceTrust.trusted ? "trusted" : "untrusted";
}

export function computeAdmission(dependencies: AgentProjectsDependencies): Admission {
  const seen = new Set<string>();
  const candidates: AdmissionCandidate[] = [];
  const consider = (rootPath: string): void => {
    const trimmed = rootPath.trim();
    if (trimmed === "") return;
    const rootKey = normalizedWorkspaceRootKey(trimmed);
    if (rootKey === "") return;
    const canonicalKey = canonicalAdmissionKey(dependencies, trimmed, rootKey);
    if (seen.has(rootKey) || seen.has(canonicalKey)) return;
    seen.add(rootKey);
    seen.add(canonicalKey);
    candidates.push({ rootKey, rootPath: trimmed });
  };
  if (dependencies.activeWorkspaceRoot !== null) consider(dependencies.activeWorkspaceRoot);
  if (dependencies.enabled) {
    for (const tab of dependencies.appSettingsRef.current.workspaceTabs) consider(tab);
  }
  return {
    admitted: candidates.slice(0, MAX_AGENT_PROJECT_ROOTS),
    overflow: candidates.slice(MAX_AGENT_PROJECT_ROOTS).map((candidate) => candidate.rootPath),
  };
}

function canonicalAdmissionKey(
  dependencies: AgentProjectsDependencies,
  rootPath: string,
  rootKey: string,
): string {
  const descriptor = dependencies.descriptorForRoot(rootPath);
  if (descriptor === null) return rootKey;
  const canonicalKey = normalizedWorkspaceRootKey(descriptor.canonicalRoot);
  if (canonicalKey === "") return rootKey;
  return canonicalKey;
}

export function sameOverflow(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function settingsIdentityForRoot(
  dependencies: AgentProjectsDependencies,
  rootPath: string,
): string | ReturnType<typeof workspaceSettingsIdentity> {
  const descriptor = dependencies.descriptorForRoot(rootPath);
  if (descriptor === null) return rootPath;
  return workspaceSettingsIdentity(descriptor.canonicalRoot, rootPath);
}

export function resolveProjectRepositories(
  rootPath: string,
  manualMappings: ReadonlyArray<string>,
  detectedDirectories: readonly string[] | null,
  auto: boolean,
): ReadonlyArray<ResolvedGitRepository> {
  const mappings = resolveEffectiveGitRepositoryMappings({
    manualMappings: [...manualMappings],
    detectedDirectories,
    auto,
  });
  return mappings.map((mapping) => ({
    mapping,
    repositoryRoot: repositoryRootForMapping(mapping, rootPath),
    repositoryRelativePath: "",
  }));
}

export function projectDescriptors(
  entries: ReadonlyMap<string, AgentProjectEntry>,
  activeRootKey: string | null,
  activeRepositories: ReadonlyArray<ResolvedGitRepository> | null,
  activeIsolationPolicy: AgentIsolationPolicy,
): ReadonlyArray<AgentProjectDescriptor> {
  const claimedRepositoryRoots = new Set<string>();
  const descriptors: AgentProjectDescriptor[] = [];
  for (const entry of entries.values()) {
    const isActive = entry.rootKey === activeRootKey && entry.admitted && !entry.releasing;
    const source =
      isActive && activeRepositories !== null ? activeRepositories : (entry.repositories ?? []);
    const repositories = source.filter((repository) => {
      if (claimedRepositoryRoots.has(repository.repositoryRoot)) return false;
      claimedRepositoryRoots.add(repository.repositoryRoot);
      return true;
    });
    descriptors.push({
      rootKey: entry.rootKey,
      rootPath: entry.rootPath,
      ownerId: entry.ownerId,
      runtimeOwnerIds: entryOwnerIds(entry),
      label: workspaceDisplayName(entry.rootPath),
      generation: entry.generation,
      trust: entry.trust,
      origin: projectOrigin(entry, isActive),
      repositories,
      repositoryDiscovery: entry.repositories === null ? "pending" : "settled",
      isolationPolicy: isActive
        ? activeIsolationPolicy
        : (entry.isolationPolicy ?? DEFAULT_AGENT_ISOLATION_POLICY),
      leaseToken: entry.leaseToken,
    });
  }
  return descriptors;
}

export function sameRepositories(
  left: ReadonlyArray<ResolvedGitRepository> | null,
  right: ReadonlyArray<ResolvedGitRepository>,
): boolean {
  if (left === null || left.length !== right.length) return false;
  return left.every((repository, index) => {
    const candidate = right[index];
    return (
      candidate !== undefined &&
      repository.repositoryRoot === candidate.repositoryRoot &&
      repository.repositoryRelativePath === candidate.repositoryRelativePath &&
      repository.mapping.rootRelativePath === candidate.mapping.rootRelativePath
    );
  });
}

function projectOrigin(entry: AgentProjectEntry, isActive: boolean): AgentProjectOrigin {
  if (isActive) return "active-tab";
  if (entry.admitted && !entry.releasing) return "background-tab";
  return "closed-tab-live-tasks";
}
