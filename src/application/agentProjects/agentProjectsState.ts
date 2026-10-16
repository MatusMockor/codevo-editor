import { agentProjectOwnsLaunchRoot, type AgentProjectTrust } from "../../domain/agentProject";
import { normalizedWorkspaceRootKey } from "../../domain/workspaceRootKey";
import { AgentOpenedProjectAdmission } from "../agentOpenedProjectAdmission";
import type { AgentProjectAuthority, AgentProjectLaunchIdentity } from "../agentProjectAuthority";
import {
  MAX_CONCURRENT_AGENT_PROJECT_LOADS,
  type AgentProjectsDependencies,
} from "./agentProjectsContract";
import {
  AGENT_PROJECTS_SOURCE,
  agentRootLeaseReleaseFailure,
  attempt,
  entryOwnerIds,
  type AgentProjectEntry,
  type AgentProjectLease,
} from "./agentProjectEntries";

export interface AgentProjectCloseAuthority {
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
}

export interface AgentProjectsState {
  dependencies: AgentProjectsDependencies;
  entries: ReadonlyMap<string, AgentProjectEntry>;
  overflow: ReadonlyArray<string>;
  readonly generationSeeds: Map<string, number>;
  readonly ownerIds: Map<string, string>;
  readonly quarantinedLeases: Map<string, Map<number, AgentProjectLease>>;
  readonly closeAuthorities: Map<string, AgentProjectCloseAuthority>;
  readonly closedWorkspaceIdsByRoot: Map<string, string>;
  autoAdmissionEnabled: boolean;
  readonly openedAdmission: AgentOpenedProjectAdmission;
  activeLoads: number;
  readonly loadQueue: Array<() => void>;
  mounted: boolean;
  projectsLoaded: boolean;
  readonly publish: () => void;
}

export function createAgentProjectsState(
  dependencies: AgentProjectsDependencies,
  publish: () => void,
): AgentProjectsState {
  return {
    dependencies,
    entries: new Map(),
    overflow: [],
    generationSeeds: new Map(),
    ownerIds: new Map(),
    quarantinedLeases: new Map(),
    closeAuthorities: new Map(),
    closedWorkspaceIdsByRoot: new Map(),
    autoAdmissionEnabled: false,
    openedAdmission: new AgentOpenedProjectAdmission(),
    activeLoads: 0,
    loadQueue: [],
    mounted: true,
    projectsLoaded: false,
    publish,
  };
}

export async function acquireLoadSlot(state: AgentProjectsState): Promise<void> {
  if (state.activeLoads < MAX_CONCURRENT_AGENT_PROJECT_LOADS) {
    state.activeLoads += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    state.loadQueue.push(resolve);
  });
  state.activeLoads += 1;
}

export function releaseLoadSlot(state: AgentProjectsState): void {
  state.activeLoads -= 1;
  const nextWaiter = state.loadQueue.shift();
  if (nextWaiter === undefined) return;
  nextWaiter();
}

export function launchIdentityForProject(
  state: AgentProjectsState,
  rootKey: string,
): AgentProjectLaunchIdentity | null {
  const entry = state.entries.get(rootKey);
  if (
    entry === undefined ||
    entry.releasing ||
    !entry.admitted ||
    state.closeAuthorities.has(rootKey)
  )
    return null;
  if (entry.workspaceId === null) return null;
  return { workspaceId: entry.workspaceId, generation: entry.workspaceGeneration };
}

export function isCurrentRepositoryOwner(
  state: AgentProjectsState,
  authority: AgentProjectAuthority,
  repositoryRoot: string,
): boolean {
  const entry = state.entries.get(authority.rootKey);
  if (
    entry === undefined ||
    entry.releasing ||
    !entry.admitted ||
    entry.trust !== "trusted" ||
    !entryOwnerIds(entry).includes(authority.ownerId) ||
    entry.generation !== authority.generation
  ) {
    return false;
  }
  const deps = state.dependencies;
  const activeRootKey =
    deps.activeWorkspaceRoot === null ? null : normalizedWorkspaceRootKey(deps.activeWorkspaceRoot);
  const repositories =
    entry.rootKey === activeRootKey && deps.activeWorkspaceRepositories !== null
      ? deps.activeWorkspaceRepositories
      : entry.repositories;
  return agentProjectOwnsLaunchRoot(
    { rootPath: entry.rootPath, repositories: repositories ?? [] },
    repositoryRoot,
  );
}

export function entryFor(
  state: AgentProjectsState,
  rootKey: string,
  generation: number,
): AgentProjectEntry | null {
  if (!state.mounted) return null;
  const entry = state.entries.get(rootKey);
  if (entry === undefined) return null;
  if (entry.generation !== generation) return null;
  return entry;
}

export function entryForOwner(
  state: AgentProjectsState,
  rootKey: string,
  generation: number,
  ownerId: string,
): AgentProjectEntry | null {
  const entry = entryFor(state, rootKey, generation);
  if (entry === null) return null;
  if (entry.ownerId !== ownerId) return null;
  return entry;
}

export function patchEntry(
  state: AgentProjectsState,
  rootKey: string,
  generation: number,
  patch: Partial<AgentProjectEntry>,
): boolean {
  const entry = entryFor(state, rootKey, generation);
  if (entry === null) return false;
  const next = new Map(state.entries);
  next.set(rootKey, { ...entry, ...patch });
  state.entries = next;
  state.publish();
  return true;
}

export function releaseLease(state: AgentProjectsState, lease: AgentProjectLease): void {
  const dependencies = state.dependencies;
  const rootKey = normalizedWorkspaceRootKey(lease.rootPath);
  const quarantineAuthority = { ...lease };
  const rootQuarantines = state.quarantinedLeases.get(rootKey) ?? new Map();
  rootQuarantines.set(lease.leaseToken, quarantineAuthority);
  state.quarantinedLeases.set(rootKey, rootQuarantines);
  void attempt(() =>
    dependencies.agentRootLeaseGateway.releaseAgentRootLease({
      rootPath: lease.rootPath,
      leaseToken: lease.leaseToken,
    }),
  ).then((released) => {
    if (!released.ok) {
      dependencies.reportError(AGENT_PROJECTS_SOURCE, released.error);
      return;
    }
    const failure = agentRootLeaseReleaseFailure(released.value, lease.leaseToken);
    if (failure !== null) {
      dependencies.reportError(AGENT_PROJECTS_SOURCE, failure);
      return;
    }
    const currentRootQuarantines = state.quarantinedLeases.get(rootKey);
    if (currentRootQuarantines?.get(lease.leaseToken) !== quarantineAuthority) return;
    currentRootQuarantines.delete(lease.leaseToken);
    if (currentRootQuarantines.size > 0) return;
    state.quarantinedLeases.delete(rootKey);
  });
}

export function applyEntryTrust(
  state: AgentProjectsState,
  rootKey: string,
  generation: number,
  trust: AgentProjectTrust,
): boolean {
  const entry = entryFor(state, rootKey, generation);
  if (entry === null) return false;
  if (trust === "trusted") return patchEntry(state, rootKey, generation, { trust });
  if (entry.trust === trust && entry.leaseToken === null) return true;
  if (entry.leaseToken !== null) {
    releaseLease(state, { rootPath: entry.rootPath, leaseToken: entry.leaseToken });
  }
  return patchEntry(state, rootKey, generation, { trust, leaseToken: null });
}

export function dropEntry(state: AgentProjectsState, rootKey: string): void {
  const entry = state.entries.get(rootKey);
  if (entry === undefined) return;
  if (entry.leaseToken !== null) {
    releaseLease(state, { rootPath: entry.rootPath, leaseToken: entry.leaseToken });
  }
  for (const ownerId of entryOwnerIds(entry)) {
    state.dependencies.releaseProjectTasks(ownerId);
  }
  const next = new Map(state.entries);
  next.delete(rootKey);
  state.entries = next;
  state.publish();
}

export async function acquireEntryLease(
  state: AgentProjectsState,
  rootKey: string,
  generation: number,
  ownerId: string,
): Promise<boolean> {
  const entry = entryForOwner(state, rootKey, generation, ownerId);
  if (entry === null || entry.releasing) return false;
  if (state.quarantinedLeases.has(rootKey)) return false;
  if (entry.leaseToken !== null && entry.workspaceId !== null) return true;
  if (entry.trust !== "trusted") return false;
  const rootPath = entry.rootPath;
  const receipt = await attempt(() =>
    state.dependencies.agentRootLeaseGateway.acquireAgentRootLease({ rootPath }),
  );
  if (!receipt.ok) {
    if (entryForOwner(state, rootKey, generation, ownerId) === null) return false;
    state.dependencies.reportError(AGENT_PROJECTS_SOURCE, receipt.error);
    return false;
  }
  const current = entryForOwner(state, rootKey, generation, ownerId);
  if (state.quarantinedLeases.has(rootKey)) {
    releaseLease(state, { rootPath, leaseToken: receipt.value.leaseToken });
    return false;
  }
  if (current === null || current.releasing) {
    releaseLease(state, { rootPath, leaseToken: receipt.value.leaseToken });
    return false;
  }
  if (current.trust !== "trusted") {
    releaseLease(state, { rootPath, leaseToken: receipt.value.leaseToken });
    return false;
  }
  if (current.leaseToken === receipt.value.leaseToken) {
    if (current.workspaceId === receipt.value.workspaceId) return true;
    return patchEntry(state, rootKey, generation, {
      leaseToken: receipt.value.leaseToken,
      workspaceId: receipt.value.workspaceId,
      observedWorkspaceId: receipt.value.workspaceId,
      workspaceGeneration: current.workspaceGeneration + 1,
    });
  }
  if (current.leaseToken !== null) {
    releaseLease(state, { rootPath, leaseToken: receipt.value.leaseToken });
    return true;
  }
  return patchEntry(state, rootKey, generation, {
    leaseToken: receipt.value.leaseToken,
    workspaceId: receipt.value.workspaceId,
    observedWorkspaceId: receipt.value.workspaceId,
    workspaceGeneration:
      current.workspaceId === receipt.value.workspaceId
        ? current.workspaceGeneration
        : current.workspaceGeneration + 1,
  });
}
