import type { AgentProjectTrust } from "../../domain/agentProject";
import { DEFAULT_AGENT_ISOLATION_POLICY } from "../../domain/agentSettings";
import {
  AGENT_PROJECTS_SOURCE,
  activeWorkspaceTrustForRoot,
  attempt,
  resolveProjectRepositories,
  settingsIdentityForRoot,
} from "./agentProjectEntries";
import {
  acquireEntryLease,
  acquireLoadSlot,
  applyEntryTrust,
  entryFor,
  entryForOwner,
  patchEntry,
  releaseLoadSlot,
  type AgentProjectsState,
} from "./agentProjectsState";

export async function runProjectLoad(
  state: AgentProjectsState,
  rootKey: string,
  generation: number,
): Promise<void> {
  const scheduledEntry = entryFor(state, rootKey, generation);
  if (scheduledEntry === null || scheduledEntry.releasing) return;
  const ownerId = scheduledEntry.ownerId;
  await acquireLoadSlot(state);
  try {
    const initial = entryForOwner(state, rootKey, generation, ownerId);
    if (initial === null || initial.releasing) return;
    const rootPath = initial.rootPath;
    const deps = state.dependencies;
    const descriptor = deps.descriptorForRoot(rootPath);
    const workspaceGeneration = initial.workspaceGeneration;
    const trustRevision = deps.trustRevisionForOwner?.(initial.workspaceId ?? ownerId) ?? 0;

    const trustResult = await attempt(() => deps.trustGateway.getTrust(rootPath));
    if (entryForOwner(state, rootKey, generation, ownerId) === null) return;
    if (!trustResult.ok) {
      state.dependencies.reportError(AGENT_PROJECTS_SOURCE, trustResult.error);
    }
    const gatewayTrust: AgentProjectTrust = trustResult.ok
      ? trustResult.value.trusted
        ? "trusted"
        : "untrusted"
      : "untrusted";
    let trust = activeWorkspaceTrustForRoot(state.dependencies, rootPath) ?? gatewayTrust;
    const isAdmissionCurrent = (): boolean => {
      const current = entryForOwner(state, rootKey, generation, ownerId);
      const identity = state.dependencies.descriptorForRoot(rootPath);
      return (
        current !== null &&
        current.admitted &&
        current.workspaceGeneration === workspaceGeneration &&
        current.workspaceId === descriptor?.workspaceId &&
        !current.releasing &&
        !state.closeAuthorities.has(rootKey) &&
        state.dependencies.enabled &&
        state.dependencies.autoAdmitOpenedProjects === true &&
        (state.dependencies.trustRevisionForOwner?.(initial.workspaceId ?? ownerId) ?? 0) ===
          trustRevision &&
        descriptor !== null &&
        identity?.workspaceId === descriptor.workspaceId &&
        identity.admissionToken === descriptor.admissionToken &&
        identity.canonicalRoot === descriptor.canonicalRoot
      );
    };
    if (descriptor !== null && trustResult.ok && deps.autoAdmitOpenedProjects === true) {
      const admitted = await attempt(() =>
        state.openedAdmission.authorize(
          descriptor,
          { rootPath, trusted: trust === "trusted" },
          deps.trustGateway,
          isAdmissionCurrent,
        ),
      );
      if (!isAdmissionCurrent()) {
        const current = entryForOwner(state, rootKey, generation, ownerId);
        const identity = state.dependencies.descriptorForRoot(rootPath);
        if (
          current?.workspaceGeneration === workspaceGeneration &&
          current.trust === "unknown" &&
          identity?.workspaceId === descriptor.workspaceId &&
          identity.admissionToken === descriptor.admissionToken
        ) {
          applyEntryTrust(state, rootKey, generation, "untrusted");
        }
        return;
      }
      if (!admitted.ok) state.dependencies.reportError(AGENT_PROJECTS_SOURCE, admitted.error);
      if (admitted.ok && admitted.value !== null) {
        trust = "trusted";
        if (state.dependencies.activeWorkspaceId === descriptor.workspaceId) {
          state.dependencies.onActiveWorkspaceTrustChanged(rootPath, descriptor.workspaceId, true);
          return;
        }
      }
    }
    if (!applyEntryTrust(state, rootKey, generation, trust)) return;

    if (trust === "trusted") {
      await acquireEntryLease(state, rootKey, generation, ownerId);
      if (entryForOwner(state, rootKey, generation, ownerId) === null) return;
    }

    const settingsResult = await attempt(() =>
      state.dependencies.settingsGateway.loadWorkspaceSettings(
        settingsIdentityForRoot(state.dependencies, rootPath),
      ),
    );
    const afterSettings = entryForOwner(state, rootKey, generation, ownerId);
    if (afterSettings === null) return;
    if (!settingsResult.ok) {
      state.dependencies.reportError(AGENT_PROJECTS_SOURCE, settingsResult.error);
    }
    const currentTrust =
      activeWorkspaceTrustForRoot(state.dependencies, rootPath) ?? afterSettings.trust;
    if (!applyEntryTrust(state, rootKey, generation, currentTrust)) return;
    const isolationPolicy = settingsResult.ok
      ? settingsResult.value.agentIsolationPolicy
      : DEFAULT_AGENT_ISOLATION_POLICY;
    const manualMappings = settingsResult.ok ? settingsResult.value.gitDirectoryMappings : [];
    const auto = settingsResult.ok ? settingsResult.value.gitDirectoryMappingsAuto : false;
    if (!patchEntry(state, rootKey, generation, { isolationPolicy })) return;

    let detectedDirectories: readonly string[] | null = null;
    if (currentTrust === "trusted" && auto) {
      const detected = await attempt(() =>
        state.dependencies.repositoryDiscoveryGateway.detectRepositories(rootPath),
      );
      const afterDiscovery = entryForOwner(state, rootKey, generation, ownerId);
      if (afterDiscovery === null) return;
      const finalTrust =
        activeWorkspaceTrustForRoot(state.dependencies, rootPath) ?? afterDiscovery.trust;
      if (!applyEntryTrust(state, rootKey, generation, finalTrust)) return;
      if (finalTrust !== "trusted") {
        patchEntry(state, rootKey, generation, {
          repositories: resolveProjectRepositories(rootPath, manualMappings, null, false),
        });
        return;
      }
      if (detected.ok) {
        detectedDirectories = detected.value;
      }
      if (!detected.ok) {
        state.dependencies.reportError(AGENT_PROJECTS_SOURCE, detected.error);
      }
    }
    const repositories = resolveProjectRepositories(
      rootPath,
      manualMappings,
      detectedDirectories,
      currentTrust === "trusted" && auto,
    );
    patchEntry(state, rootKey, generation, { repositories });
  } finally {
    releaseLoadSlot(state);
  }
}

export function scheduleProjectLoad(
  state: AgentProjectsState,
  rootKey: string,
  generation: number,
): void {
  void runProjectLoad(state, rootKey, generation).catch((error: unknown) => {
    state.dependencies.reportError(AGENT_PROJECTS_SOURCE, error);
  });
}
