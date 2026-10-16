import type { WorkspaceTrustOrigin } from "../../domain/trust";
import { normalizedWorkspaceRootKey, workspaceDisplayName } from "../../domain/workspaceRootKey";
import type { AgentProjectLaunchIdentity } from "../agentProjectAuthority";
import { confirmAndGrantAgentProjectTrust } from "../agentProjectTrustGrant";
import {
  AGENT_PROJECTS_SOURCE,
  attempt,
  entryHasLiveTasks,
  entryOwnerIds,
} from "./agentProjectEntries";
import { runProjectLoad } from "./agentProjectLoad";
import {
  acquireEntryLease,
  applyEntryTrust,
  dropEntry,
  entryFor,
  launchIdentityForProject,
  patchEntry,
  type AgentProjectsState,
} from "./agentProjectsState";

export async function refreshProject(state: AgentProjectsState, rootKey: string): Promise<void> {
  const entry = state.entries.get(rootKey);
  if (entry === undefined || entry.releasing) return;
  if (!state.dependencies.enabled) return;
  await runProjectLoad(state, rootKey, entry.generation);
}

export async function grantProjectTrust(
  state: AgentProjectsState,
  rootKey: string,
  origin: WorkspaceTrustOrigin | null,
): Promise<void> {
  if (rootKey.startsWith("remote:")) return;
  const entry = state.entries.get(rootKey);
  if (entry === undefined || entry.releasing || entry.trust === "trusted") return;
  const generation = entry.generation;
  const admission = state.dependencies.descriptorForRoot(entry.rootPath)?.admissionToken;
  const isCurrent = () => {
    const current = entryFor(state, rootKey, generation);
    return (
      current !== null &&
      !current.releasing &&
      current.workspaceId === entry.workspaceId &&
      state.dependencies.descriptorForRoot(entry.rootPath)?.admissionToken === admission
    );
  };
  const result = await attempt(() =>
    confirmAndGrantAgentProjectTrust({
      rootPath: entry.rootPath,
      label: workspaceDisplayName(entry.rootPath),
      origin: origin ?? { kind: "local" },
      gateway: state.dependencies.trustGateway,
      isCurrent,
    }),
  );
  if (!result.ok) {
    state.dependencies.reportError(AGENT_PROJECTS_SOURCE, result.error);
    return;
  }
  if (result.value === "refused") {
    state.dependencies.reportError(AGENT_PROJECTS_SOURCE, new Error("Trust was refused."));
    return;
  }
  if (result.value !== "granted") return;
  const deps = state.dependencies;
  if (entry.workspaceId !== null && deps.activeWorkspaceId === entry.workspaceId) {
    deps.onActiveWorkspaceTrustChanged(entry.rootPath, entry.workspaceId, true);
    return;
  }
  await runProjectLoad(state, rootKey, generation);
}

export async function releaseProject(state: AgentProjectsState, rootKey: string): Promise<void> {
  const entry = state.entries.get(rootKey);
  if (entry === undefined || entry.releasing) return;
  const generation = entry.generation;
  if (!patchEntry(state, rootKey, generation, { releasing: true })) return;
  const repositoryRoots = (entry.repositories ?? []).map((repository) => repository.repositoryRoot);
  const stopped = await attempt(async () => {
    for (const ownerId of entryOwnerIds(entry)) {
      await state.dependencies.stopProjectTasks(ownerId, repositoryRoots);
    }
  });
  if (!stopped.ok) {
    state.dependencies.reportError(AGENT_PROJECTS_SOURCE, stopped.error);
  }
  const current = entryFor(state, rootKey, generation);
  if (current === null) return;
  for (const ownerId of entryOwnerIds(current)) {
    state.dependencies.releaseProjectTasks(ownerId);
  }
  if (entryHasLiveTasks(state.dependencies, current)) return;
  dropEntry(state, rootKey);
}

export async function ensureProjectLease(
  state: AgentProjectsState,
  rootKey: string,
): Promise<boolean> {
  if (!state.dependencies.enabled) return true;
  const entry = state.entries.get(rootKey);
  if (entry === undefined || entry.releasing || state.closeAuthorities.has(rootKey)) return false;
  return acquireEntryLease(state, rootKey, entry.generation, entry.ownerId);
}

export async function ensureProjectLaunchIdentity(
  state: AgentProjectsState,
  rootKey: string,
): Promise<AgentProjectLaunchIdentity | null> {
  const existingIdentity = launchIdentityForProject(state, rootKey);
  if (existingIdentity !== null) return existingIdentity;
  const entry = state.entries.get(rootKey);
  if (
    entry === undefined ||
    entry.releasing ||
    !entry.admitted ||
    state.closeAuthorities.has(rootKey)
  ) {
    return null;
  }
  if (entry.workspaceId === null) {
    const leased = await acquireEntryLease(state, rootKey, entry.generation, entry.ownerId);
    if (!leased) return null;
    const leasedIdentity = launchIdentityForProject(state, rootKey);
    if (leasedIdentity !== null) return leasedIdentity;
  }
  const currentEntry = state.entries.get(rootKey);
  if (currentEntry === undefined || currentEntry.workspaceId !== null) {
    return launchIdentityForProject(state, rootKey);
  }
  const activateWorkspaceRoot = state.dependencies.activateWorkspaceRoot;
  if (activateWorkspaceRoot === undefined) return null;
  const authority = { generation: currentEntry.generation, ownerId: currentEntry.ownerId };
  const activated = await attempt(() => activateWorkspaceRoot(currentEntry.rootPath));
  if (!activated.ok) {
    const current = state.entries.get(rootKey);
    if (current?.generation === authority.generation && current.ownerId === authority.ownerId) {
      state.dependencies.reportError(AGENT_PROJECTS_SOURCE, activated.error);
    }
    return null;
  }
  const current = state.entries.get(rootKey);
  if (
    current === undefined ||
    current.generation !== authority.generation ||
    current.ownerId !== authority.ownerId ||
    current.releasing ||
    !current.admitted ||
    current.workspaceId !== null ||
    state.closeAuthorities.has(rootKey)
  ) {
    return launchIdentityForProject(state, rootKey);
  }
  const descriptor = state.dependencies.descriptorForRoot(current.rootPath);
  if (descriptor === null) return null;
  const workspaceGeneration = current.workspaceGeneration + 1;
  if (
    !patchEntry(state, rootKey, current.generation, {
      workspaceId: descriptor.workspaceId,
      observedWorkspaceId: descriptor.workspaceId,
      workspaceGeneration,
    })
  ) {
    return null;
  }
  return { workspaceId: descriptor.workspaceId, generation: workspaceGeneration };
}

export function noteDispatchTrustRejected(state: AgentProjectsState, rootKey: string): void {
  const entry = state.entries.get(rootKey);
  if (entry === undefined) return;
  const identity = state.dependencies.descriptorForRoot(entry.rootPath);
  if (identity !== null) state.openedAdmission.revoke(identity);
  if (entry.trust === "untrusted") return;
  const activeRoot = state.dependencies.activeWorkspaceRoot;
  const activeOwnerId = state.dependencies.activeWorkspaceId;
  if (
    activeRoot !== null &&
    activeOwnerId !== null &&
    normalizedWorkspaceRootKey(activeRoot) === entry.rootKey
  ) {
    state.dependencies.onActiveWorkspaceTrustChanged(entry.rootPath, activeOwnerId, false);
  }
  applyEntryTrust(state, rootKey, entry.generation, "untrusted");
}
