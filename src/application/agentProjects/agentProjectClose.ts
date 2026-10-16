import { normalizedWorkspaceRootKey } from "../../domain/workspaceRootKey";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";
import type { AgentWorkspaceProjectCloseResult } from "./agentProjectsContract";
import {
  AGENT_PROJECTS_SOURCE,
  agentRootLeaseReleaseFailure,
  attempt,
  entryHasLiveTasks,
  entryOwnerIds,
  type AgentProjectEntry,
} from "./agentProjectEntries";
import { acquireEntryLease, entryFor, type AgentProjectsState } from "./agentProjectsState";

export async function closeWorkspaceProject(
  state: AgentProjectsState,
  descriptor: WorkspaceIdentityDescriptor,
  isCurrent: () => boolean,
): Promise<AgentWorkspaceProjectCloseResult> {
  if (!isCurrent() || !state.mounted) return { status: "stale" };
  const selectedKey = normalizedWorkspaceRootKey(descriptor.selectedPath);
  const canonicalKey = normalizedWorkspaceRootKey(descriptor.canonicalRoot);
  const entry = [...state.entries.values()].find(
    (candidate) =>
      candidate.workspaceId === descriptor.workspaceId &&
      (candidate.rootKey === selectedKey || candidate.rootKey === canonicalKey),
  );
  if (entry === undefined) {
    return {
      status: "closed",
      settlement: {
        complete: async () => undefined,
        finalizeBackendClosed: () => undefined,
      },
    };
  }
  const rootKey = entry.rootKey;
  const generation = entry.generation;
  const workspaceGeneration = entry.workspaceGeneration;
  const leaseToken = entry.leaseToken;
  const retainedCloseAuthority = state.closeAuthorities.get(rootKey);
  if (
    retainedCloseAuthority !== undefined &&
    (retainedCloseAuthority.workspaceId !== descriptor.workspaceId ||
      retainedCloseAuthority.workspaceGeneration !== workspaceGeneration)
  )
    return { status: "stale" };
  const closeAuthority = retainedCloseAuthority ?? {
    workspaceId: descriptor.workspaceId,
    workspaceGeneration,
  };
  state.closeAuthorities.set(rootKey, closeAuthority);
  const clearCloseAuthority = (): void => {
    if (state.closeAuthorities.get(rootKey) !== closeAuthority) return;
    state.closeAuthorities.delete(rootKey);
  };
  const ownerIds = entryOwnerIds(entry);
  const repositoryRoots = (entry.repositories ?? []).map((repository) => repository.repositoryRoot);
  const exactEntry = (): AgentProjectEntry | null => {
    if (!isCurrent() || !state.mounted) return null;
    const current = entryFor(state, rootKey, generation);
    if (current === null) return null;
    if (current.ownerId !== entry.ownerId) return null;
    if (current.workspaceId !== descriptor.workspaceId) return null;
    if (current.workspaceGeneration !== workspaceGeneration) return null;
    if (state.closeAuthorities.get(rootKey) !== closeAuthority) return null;
    return current;
  };
  const exactLeaseEntry = (): AgentProjectEntry | null => {
    const current = exactEntry();
    if (current === null) return null;
    if (current.leaseToken !== leaseToken) return null;
    return current;
  };
  const capturedEntry = (): AgentProjectEntry | null => {
    const current = state.entries.get(rootKey);
    if (current === undefined || current.generation !== generation) return null;
    if (current.ownerId !== entry.ownerId) return null;
    if (current.workspaceId !== descriptor.workspaceId) return null;
    if (current.workspaceGeneration !== workspaceGeneration) return null;
    if (state.closeAuthorities.get(rootKey) !== closeAuthority) return null;
    return current;
  };
  const clearReleasedLease = (): AgentProjectEntry | null => {
    const rootEntry = state.entries.get(rootKey);
    const releasedEntry = rootEntry?.generation === generation ? rootEntry : null;
    if (releasedEntry?.leaseToken === leaseToken) {
      const next = new Map(state.entries);
      next.set(rootKey, { ...releasedEntry, leaseToken: null });
      state.entries = next;
    }
    return releasedEntry;
  };
  for (const ownerId of ownerIds) {
    const stopped = await attempt(() =>
      state.dependencies.stopProjectTasks(ownerId, repositoryRoots),
    );
    if (exactLeaseEntry() === null) {
      clearCloseAuthority();
      return { status: "stale" };
    }
    if (!stopped.ok) {
      state.dependencies.reportError(AGENT_PROJECTS_SOURCE, stopped.error);
      clearCloseAuthority();
      return { status: "task-stop-incomplete" };
    }
  }
  const current = exactLeaseEntry();
  if (current === null) {
    clearCloseAuthority();
    return { status: "stale" };
  }
  for (const ownerId of ownerIds) {
    state.dependencies.releaseProjectTasks(ownerId);
  }
  if (entryHasLiveTasks(state.dependencies, current)) {
    clearCloseAuthority();
    return { status: "task-stop-incomplete" };
  }
  if (leaseToken !== null) {
    const dependencies = state.dependencies;
    const released = await attempt(() =>
      dependencies.agentRootLeaseGateway.releaseAgentRootLease({
        rootPath: entry.rootPath,
        leaseToken,
      }),
    );
    const afterReleaseAuthority = exactLeaseEntry();
    if (!released.ok) {
      dependencies.reportError(AGENT_PROJECTS_SOURCE, released.error);
      return { status: "lease-release-incomplete" };
    }
    const releaseFailure = agentRootLeaseReleaseFailure(released.value, leaseToken);
    if (releaseFailure !== null) {
      dependencies.reportError(AGENT_PROJECTS_SOURCE, releaseFailure);
      return { status: "lease-release-incomplete" };
    }
    if (afterReleaseAuthority === null) {
      const releasedEntry = clearReleasedLease();
      clearCloseAuthority();
      if (state.mounted && releasedEntry?.leaseToken === leaseToken) {
        await acquireEntryLease(state, rootKey, generation, releasedEntry.ownerId);
      }
      return { status: "stale" };
    }
    const releasedEntry = clearReleasedLease();
    if (exactEntry() === null) {
      clearCloseAuthority();
      if (state.mounted && releasedEntry?.leaseToken === leaseToken) {
        await acquireEntryLease(state, rootKey, generation, releasedEntry.ownerId);
      }
      return { status: "stale" };
    }
  }
  if (exactEntry() === null) {
    clearCloseAuthority();
    return { status: "stale" };
  }
  return {
    status: "closed",
    settlement: {
      complete: async (outcome) => {
        const settled = capturedEntry();
        clearCloseAuthority();
        if (settled === null) return;
        if (outcome === "backend-not-closed") {
          await acquireEntryLease(state, rootKey, generation, settled.ownerId);
          return;
        }
        const next = new Map(state.entries);
        next.delete(rootKey);
        state.entries = next;
        state.publish();
      },
      finalizeBackendClosed: () => {
        state.closedWorkspaceIdsByRoot.set(rootKey, descriptor.workspaceId);
        clearCloseAuthority();
        state.publish();
      },
    },
  };
}
