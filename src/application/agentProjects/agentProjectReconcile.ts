import { agentRootOwnerId } from "../../domain/agentProject";
import { normalizedWorkspaceRootKey } from "../../domain/workspaceRootKey";
import type { AgentProjectsDependencies } from "./agentProjectsContract";
import {
  activeWorkspaceTrustForRoot,
  computeAdmission,
  entryHasLiveTasks,
  entryOwnerIds,
  sameOverflow,
  sameRepositories,
  type AdmissionCandidate,
  type AgentProjectEntry,
} from "./agentProjectEntries";
import { scheduleProjectLoad } from "./agentProjectLoad";
import { releaseLease, type AgentProjectsState } from "./agentProjectsState";

export const MAX_AGENT_PROJECT_RETIRED_OWNERS = 14;

interface ScheduledLoad {
  readonly rootKey: string;
  readonly generation: number;
}

interface ExistingEntryReconciliation {
  readonly entry: AgentProjectEntry;
  readonly changed: boolean;
}

export function reconcileAgentProjects(state: AgentProjectsState): void {
  const deps = state.dependencies;
  const autoAdmissionEnabled = deps.autoAdmitOpenedProjects === true;
  const admissionEnabledNow = autoAdmissionEnabled && !state.autoAdmissionEnabled;
  state.autoAdmissionEnabled = autoAdmissionEnabled;
  const admission = computeAdmission(deps);
  const activeKey =
    deps.activeWorkspaceRoot === null ? null : normalizedWorkspaceRootKey(deps.activeWorkspaceRoot);
  const current = state.entries;
  const next = new Map<string, AgentProjectEntry>();
  const scheduled: ScheduledLoad[] = [];
  let changed = false;
  if (deps.settingsHydrated !== false && !state.projectsLoaded) {
    state.projectsLoaded = true;
    changed = true;
  }

  for (const candidate of admission.admitted) {
    const closeAuthority = state.closeAuthorities.get(candidate.rootKey);
    const candidateWorkspaceId =
      candidate.rootKey === activeKey
        ? deps.activeWorkspaceId
        : (deps.descriptorForRoot(candidate.rootPath)?.workspaceId ?? null);
    const closedWorkspaceId = state.closedWorkspaceIdsByRoot.get(candidate.rootKey);
    if (
      closedWorkspaceId !== undefined &&
      (candidateWorkspaceId === null || candidateWorkspaceId === closedWorkspaceId)
    )
      continue;
    if (closedWorkspaceId !== undefined) {
      state.closedWorkspaceIdsByRoot.delete(candidate.rootKey);
    }
    if (closeAuthority !== undefined) continue;
    const existing = current.get(candidate.rootKey);
    if (existing !== undefined) {
      const reconciled = reconcileExistingEntry(
        state,
        deps,
        candidate,
        existing,
        candidateWorkspaceId,
        activeKey,
        admissionEnabledNow,
        scheduled,
      );
      if (reconciled.changed) changed = true;
      next.set(candidate.rootKey, reconciled.entry);
      continue;
    }
    const generation = (state.generationSeeds.get(candidate.rootKey) ?? 0) + 1;
    state.generationSeeds.set(candidate.rootKey, generation);
    const frozenOwnerId = state.ownerIds.get(candidate.rootKey);
    const preferredOwnerId =
      candidate.rootKey === activeKey
        ? deps.activeWorkspaceId
        : (deps.descriptorForRoot(candidate.rootPath)?.workspaceId ?? null);
    const ownerId = frozenOwnerId ?? preferredOwnerId ?? agentRootOwnerId(candidate.rootKey);
    const activeTrust = activeWorkspaceTrustForRoot(deps, candidate.rootPath);
    if (
      frozenOwnerId === undefined &&
      (preferredOwnerId !== null || candidate.rootKey !== activeKey)
    ) {
      state.ownerIds.set(candidate.rootKey, ownerId);
    }
    next.set(candidate.rootKey, {
      rootKey: candidate.rootKey,
      rootPath: candidate.rootPath,
      ownerId,
      supersededOwnerId: null,
      workspaceId: preferredOwnerId,
      observedWorkspaceId: preferredOwnerId,
      workspaceGeneration: 1,
      retiredWorkspaceIds: [],
      generation,
      trust: deps.enabled ? (activeTrust ?? "unknown") : "trusted",
      isolationPolicy: null,
      repositories: null,
      leaseToken: null,
      admitted: true,
      releasing: false,
    });
    changed = true;
    if (deps.enabled) scheduled.push({ rootKey: candidate.rootKey, generation });
  }

  const dropped: string[] = [];
  const admittedRootKeys = new Set(admission.admitted.map((candidate) => candidate.rootKey));
  for (const rootKey of state.closedWorkspaceIdsByRoot.keys()) {
    if (!admittedRootKeys.has(rootKey)) state.closedWorkspaceIdsByRoot.delete(rootKey);
  }
  for (const [rootKey, entry] of current) {
    if (next.has(rootKey)) continue;
    if (state.closeAuthorities.has(rootKey)) {
      next.set(rootKey, entry);
      continue;
    }
    const draining = entry.releasing || !entry.admitted;
    if (!draining && !entryHasLiveTasks(deps, entry)) {
      dropped.push(rootKey);
      changed = true;
      continue;
    }
    if (entryHasLiveTasks(deps, entry)) {
      if (entry.admitted) {
        next.set(rootKey, { ...entry, admitted: false });
        changed = true;
        continue;
      }
      next.set(rootKey, entry);
      continue;
    }
    dropped.push(rootKey);
    changed = true;
  }

  for (const [rootKey, entry] of next) {
    if (!entry.releasing) continue;
    if (entryHasLiveTasks(deps, entry)) continue;
    next.delete(rootKey);
    dropped.push(rootKey);
    changed = true;
  }

  if (!changed && sameOverflow(state.overflow, admission.overflow)) return;
  for (const rootKey of dropped) {
    const entry = current.get(rootKey) ?? next.get(rootKey);
    if (entry === undefined) continue;
    if (entry.leaseToken !== null) {
      releaseLease(state, { rootPath: entry.rootPath, leaseToken: entry.leaseToken });
    }
    for (const ownerId of entryOwnerIds(entry)) deps.releaseProjectTasks(ownerId);
  }
  state.openedAdmission.retain(
    [...next.values()]
      .filter((entry) => entry.admitted)
      .map((entry) => deps.descriptorForRoot(entry.rootPath)?.canonicalRoot ?? entry.rootPath),
  );
  state.entries = next;
  state.overflow = admission.overflow;
  for (const load of scheduled) scheduleProjectLoad(state, load.rootKey, load.generation);
  state.publish();
}

function reconcileExistingEntry(
  state: AgentProjectsState,
  deps: AgentProjectsDependencies,
  candidate: AdmissionCandidate,
  existing: AgentProjectEntry,
  candidateWorkspaceId: string | null,
  activeKey: string | null,
  admissionEnabledNow: boolean,
  scheduled: ScheduledLoad[],
): ExistingEntryReconciliation {
  let entry = existing;
  let changed = false;
  if (admissionEnabledNow && !entry.releasing) {
    scheduled.push({ rootKey: candidate.rootKey, generation: entry.generation });
    changed = true;
  }
  if (entry.releasing) return { entry, changed };
  if (!entry.admitted) {
    entry = { ...entry, admitted: true };
    changed = true;
  }
  if (
    candidate.rootKey === activeKey &&
    deps.activeWorkspaceRepositories.length > 0 &&
    !sameRepositories(entry.repositories, deps.activeWorkspaceRepositories)
  ) {
    entry = { ...entry, repositories: deps.activeWorkspaceRepositories };
    changed = true;
  }
  const currentWorkspaceId =
    candidateWorkspaceId ?? (entry.leaseToken !== null ? entry.workspaceId : null);
  const retainedWorkspaceIds = [...entry.retiredWorkspaceIds];
  const workspaceIdentityChanged = currentWorkspaceId !== entry.observedWorkspaceId;
  const workspaceIdentityCanRecover =
    entry.workspaceId === null &&
    currentWorkspaceId !== null &&
    (retainedWorkspaceIds.length < MAX_AGENT_PROJECT_RETIRED_OWNERS ||
      retainedWorkspaceIds.some((workspaceId) => !deps.hasLiveTasksForOwner(workspaceId)));
  if (workspaceIdentityChanged || workspaceIdentityCanRecover) {
    const retiredWorkspaceIds = [...retainedWorkspaceIds];
    if (
      entry.workspaceId !== null &&
      entry.workspaceId !== currentWorkspaceId &&
      !retiredWorkspaceIds.includes(entry.workspaceId)
    ) {
      retiredWorkspaceIds.push(entry.workspaceId);
    }
    while (retiredWorkspaceIds.length >= MAX_AGENT_PROJECT_RETIRED_OWNERS) {
      const removableIndex = retiredWorkspaceIds.findIndex(
        (workspaceId) => !deps.hasLiveTasksForOwner(workspaceId),
      );
      if (removableIndex < 0) break;
      const removed = retiredWorkspaceIds.splice(removableIndex, 1)[0];
      if (removed !== undefined) deps.releaseProjectTasks(removed);
    }
    const admittedWorkspaceId =
      retiredWorkspaceIds.length < MAX_AGENT_PROJECT_RETIRED_OWNERS ? currentWorkspaceId : null;
    entry = {
      ...entry,
      workspaceId: admittedWorkspaceId,
      observedWorkspaceId: currentWorkspaceId,
      workspaceGeneration: entry.workspaceGeneration + 1,
      retiredWorkspaceIds,
    };
    scheduled.push({ rootKey: candidate.rootKey, generation: entry.generation });
    changed = true;
  }
  const replaceOwnerId =
    candidate.rootKey === activeKey &&
    currentWorkspaceId !== null &&
    entry.ownerId !== currentWorkspaceId &&
    !deps.hasLiveTasksForOwner(entry.ownerId);
  if (replaceOwnerId && currentWorkspaceId !== null) {
    const forgottenOwnerId = entry.supersededOwnerId;
    state.ownerIds.set(candidate.rootKey, currentWorkspaceId);
    entry = {
      ...entry,
      ownerId: currentWorkspaceId,
      supersededOwnerId: entry.ownerId,
    };
    if (forgottenOwnerId !== null && !entryOwnerIds(entry).includes(forgottenOwnerId)) {
      deps.releaseProjectTasks(forgottenOwnerId);
    }
    scheduled.push({ rootKey: candidate.rootKey, generation: entry.generation });
    changed = true;
  }
  const activeTrust = activeWorkspaceTrustForRoot(deps, candidate.rootPath);
  if (activeTrust !== null && entry.trust !== activeTrust) {
    if (activeTrust === "untrusted" && entry.trust === "trusted") {
      const identity = deps.descriptorForRoot(entry.rootPath);
      if (identity !== null) state.openedAdmission.revoke(identity);
    }
    if (activeTrust === "untrusted" && entry.leaseToken !== null) {
      releaseLease(state, { rootPath: entry.rootPath, leaseToken: entry.leaseToken });
      entry = { ...entry, trust: activeTrust, leaseToken: null };
    }
    if (activeTrust === "untrusted" && entry.leaseToken === null) {
      entry = { ...entry, trust: activeTrust };
    }
    if (activeTrust === "trusted") {
      entry = { ...entry, trust: activeTrust };
      scheduled.push({ rootKey: candidate.rootKey, generation: entry.generation });
    }
    changed = true;
  }
  return { entry, changed };
}
