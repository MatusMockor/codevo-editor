import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import {
  MAX_AGENT_PROJECT_ROOTS,
  agentRootOwnerId,
  type AgentProjectDescriptor,
  type AgentProjectOrigin,
  type AgentProjectTrust,
  type AgentRootLeaseGateway,
  type AgentRootLeaseReleaseResult,
} from "../domain/agentProject";
import { DEFAULT_AGENT_ISOLATION_POLICY, type AgentIsolationPolicy } from "../domain/agentSettings";
import {
  repositoryRootForMapping,
  resolveEffectiveGitRepositoryMappings,
  type ResolvedGitRepository,
} from "../domain/gitRepositoryMapping";
import type { AppSettings, SettingsGateway } from "../domain/settings";
import type { WorkspaceTrustGateway, WorkspaceTrustState } from "../domain/trust";
import { normalizedWorkspaceRootKey, workspaceDisplayName } from "../domain/workspaceRootKey";
import { workspaceSettingsIdentity } from "./workbenchController/workspaceIdentityPolicy";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";
import { confirmWorkbenchAction, type WorkbenchPrompter } from "./workbenchPrompter";
import type { AgentProjectAuthority, AgentProjectLaunchIdentity } from "./agentProjectAuthority";

export const MAX_CONCURRENT_AGENT_PROJECT_LOADS = 2;
const MAX_AGENT_PROJECT_RETIRED_OWNERS = 14;

export interface AgentRepositoryDiscoveryGateway {
  detectRepositories(rootPath: string, maxDepth?: number): Promise<readonly string[] | null>;
}

export interface AgentProjectsDependencies {
  readonly enabled: boolean;
  readonly appSettingsRef: { readonly current: AppSettings };
  readonly activeWorkspaceId: string | null;
  readonly activeWorkspaceRoot: string | null;
  readonly activeWorkspaceTrust: WorkspaceTrustState | null;
  readonly activeWorkspaceRepositories: ReadonlyArray<ResolvedGitRepository>;
  readonly activeIsolationPolicy: AgentIsolationPolicy;
  readonly descriptorForRoot: (rootPath: string) => WorkspaceIdentityDescriptor | null;
  readonly activateWorkspaceRoot?: (rootPath: string) => Promise<void>;
  readonly settingsGateway: Pick<SettingsGateway, "loadWorkspaceSettings">;
  readonly trustGateway: WorkspaceTrustGateway;
  readonly repositoryDiscoveryGateway: AgentRepositoryDiscoveryGateway;
  readonly agentRootLeaseGateway: AgentRootLeaseGateway;
  readonly hasLiveTasksForOwner: (ownerId: string) => boolean;
  readonly stopProjectTasks: (
    ownerId: string,
    repositoryRoots: ReadonlyArray<string>,
  ) => Promise<void>;
  readonly releaseProjectTasks: (ownerId: string) => void;
  readonly onActiveWorkspaceTrustChanged: (
    rootPath: string,
    ownerId: string,
    trusted: boolean,
  ) => void;
  readonly prompter: WorkbenchPrompter;
  readonly reportError: (source: string, error: unknown) => void;
}

export interface AgentProjectsSurface {
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly overflowRootPaths: ReadonlyArray<string>;
  refreshProject(rootKey: string): Promise<void>;
  trustProject(rootKey: string): Promise<void>;
  releaseProject(rootKey: string): Promise<void>;
  closeWorkspaceProject?(
    descriptor: WorkspaceIdentityDescriptor,
    isCurrent: () => boolean,
  ): Promise<AgentWorkspaceProjectCloseResult>;
  ensureProjectLease(rootKey: string): Promise<boolean>;
  ensureProjectLaunchIdentity?(
    rootKey: string,
  ): Promise<AgentProjectLaunchIdentity | null>;
  launchIdentityForProject(rootKey: string): AgentProjectLaunchIdentity | null;
  isCurrentRepositoryOwner(authority: AgentProjectAuthority, repositoryRoot: string): boolean;
  noteDispatchTrustRejected(rootKey: string): void;
}

export type AgentWorkspaceProjectCloseResult =
  | {
      readonly status: "closed";
      readonly settlement: AgentWorkspaceProjectCloseSettlement;
    }
  | { readonly status: "lease-release-incomplete" }
  | { readonly status: "stale" }
  | { readonly status: "task-stop-incomplete" };

export interface AgentWorkspaceProjectCloseSettlement {
  complete(outcome: "backend-closed" | "backend-not-closed"): Promise<void>;
  finalizeBackendClosed(): void;
}

const AGENT_PROJECTS_SOURCE = "Agents";

interface AgentProjectEntry {
  readonly rootKey: string;
  readonly rootPath: string;
  readonly ownerId: string;
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

interface AgentProjectLease {
  readonly rootPath: string;
  readonly leaseToken: number;
}

function agentRootLeaseReleaseFailure(
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

type Attempt<TValue> =
  { readonly ok: true; readonly value: TValue } | { readonly ok: false; readonly error: unknown };

async function attempt<TValue>(operation: () => Promise<TValue>): Promise<Attempt<TValue>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error };
  }
}

export function useAgentProjects(dependencies: AgentProjectsDependencies): AgentProjectsSurface {
  const dependenciesRef = useRef(dependencies);
  const entriesRef = useRef<ReadonlyMap<string, AgentProjectEntry>>(new Map());
  const overflowRef = useRef<ReadonlyArray<string>>([]);
  const generationSeedsRef = useRef(new Map<string, number>());
  const ownerIdsRef = useRef(new Map<string, string>());
  const quarantinedLeasesRef = useRef(new Map<string, Map<number, AgentProjectLease>>());
  const closeAuthoritiesRef = useRef(
    new Map<string, { readonly workspaceId: string; readonly workspaceGeneration: number }>(),
  );
  const closedWorkspaceIdsByRootRef = useRef(new Map<string, string>());
  const activeLoadsRef = useRef(0);
  const loadQueueRef = useRef<Array<() => void>>([]);
  const mountedRef = useRef(true);
  const [version, publish] = useReducer((current: number) => current + 1, 0);

  const launchIdentityForProject = useCallback(
    (rootKey: string): AgentProjectLaunchIdentity | null => {
      const entry = entriesRef.current.get(rootKey);
      if (
        entry === undefined ||
        entry.releasing ||
        !entry.admitted ||
        closeAuthoritiesRef.current.has(rootKey)
      )
        return null;
      if (entry.workspaceId === null) return null;
      return { workspaceId: entry.workspaceId, generation: entry.workspaceGeneration };
    },
    [],
  );

  const isCurrentRepositoryOwner = useCallback(
    (authority: AgentProjectAuthority, repositoryRoot: string): boolean => {
      const entry = entriesRef.current.get(authority.rootKey);
      if (
        entry === undefined ||
        entry.releasing ||
        !entry.admitted ||
        entry.trust !== "trusted" ||
        entry.ownerId !== authority.ownerId ||
        entry.generation !== authority.generation
      ) {
        return false;
      }
      const deps = dependenciesRef.current;
      const activeRootKey =
        deps.activeWorkspaceRoot === null
          ? null
          : normalizedWorkspaceRootKey(deps.activeWorkspaceRoot);
      const repositories =
        entry.rootKey === activeRootKey ? deps.activeWorkspaceRepositories : entry.repositories;
      return (
        repositories?.some((repository) => repository.repositoryRoot === repositoryRoot) === true
      );
    },
    [],
  );

  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const entryFor = useCallback((rootKey: string, generation: number): AgentProjectEntry | null => {
    if (!mountedRef.current) return null;
    const entry = entriesRef.current.get(rootKey);
    if (entry === undefined) return null;
    if (entry.generation !== generation) return null;
    return entry;
  }, []);

  const entryForOwner = useCallback(
    (rootKey: string, generation: number, ownerId: string): AgentProjectEntry | null => {
      const entry = entryFor(rootKey, generation);
      if (entry === null) return null;
      if (entry.ownerId !== ownerId) return null;
      return entry;
    },
    [entryFor],
  );

  const patchEntry = useCallback(
    (rootKey: string, generation: number, patch: Partial<AgentProjectEntry>): boolean => {
      const entry = entryFor(rootKey, generation);
      if (entry === null) return false;
      const next = new Map(entriesRef.current);
      next.set(rootKey, { ...entry, ...patch });
      entriesRef.current = next;
      publish();
      return true;
    },
    [entryFor],
  );

  const releaseLease = useCallback((lease: AgentProjectLease): void => {
    const dependencies = dependenciesRef.current;
    const rootKey = normalizedWorkspaceRootKey(lease.rootPath);
    const quarantineAuthority = { ...lease };
    const rootQuarantines = quarantinedLeasesRef.current.get(rootKey) ?? new Map();
    rootQuarantines.set(lease.leaseToken, quarantineAuthority);
    quarantinedLeasesRef.current.set(rootKey, rootQuarantines);
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
      const currentRootQuarantines = quarantinedLeasesRef.current.get(rootKey);
      if (currentRootQuarantines?.get(lease.leaseToken) !== quarantineAuthority) return;
      currentRootQuarantines.delete(lease.leaseToken);
      if (currentRootQuarantines.size > 0) return;
      quarantinedLeasesRef.current.delete(rootKey);
    });
  }, []);

  const applyEntryTrust = useCallback(
    (rootKey: string, generation: number, trust: AgentProjectTrust): boolean => {
      const entry = entryFor(rootKey, generation);
      if (entry === null) return false;
      if (trust === "trusted") return patchEntry(rootKey, generation, { trust });
      if (entry.trust === trust && entry.leaseToken === null) return true;
      if (entry.leaseToken !== null) {
        releaseLease({ rootPath: entry.rootPath, leaseToken: entry.leaseToken });
      }
      return patchEntry(rootKey, generation, { trust, leaseToken: null });
    },
    [entryFor, patchEntry, releaseLease],
  );

  const dropEntry = useCallback(
    (rootKey: string): void => {
      const entry = entriesRef.current.get(rootKey);
      if (entry === undefined) return;
      if (entry.leaseToken !== null) {
        releaseLease({ rootPath: entry.rootPath, leaseToken: entry.leaseToken });
      }
      for (const ownerId of entryOwnerIds(entry)) {
        dependenciesRef.current.releaseProjectTasks(ownerId);
      }
      const next = new Map(entriesRef.current);
      next.delete(rootKey);
      entriesRef.current = next;
      publish();
    },
    [releaseLease],
  );

  const acquireEntryLease = useCallback(
    async (rootKey: string, generation: number, ownerId: string): Promise<boolean> => {
      const entry = entryForOwner(rootKey, generation, ownerId);
      if (entry === null || entry.releasing) return false;
      if (quarantinedLeasesRef.current.has(rootKey)) return false;
      if (entry.leaseToken !== null && entry.workspaceId !== null) return true;
      if (entry.trust !== "trusted") return false;
      const rootPath = entry.rootPath;
      const receipt = await attempt(() =>
        dependenciesRef.current.agentRootLeaseGateway.acquireAgentRootLease({ rootPath }),
      );
      if (!receipt.ok) {
        if (entryForOwner(rootKey, generation, ownerId) === null) return false;
        dependenciesRef.current.reportError(AGENT_PROJECTS_SOURCE, receipt.error);
        return false;
      }
      const current = entryForOwner(rootKey, generation, ownerId);
      if (quarantinedLeasesRef.current.has(rootKey)) {
        releaseLease({ rootPath, leaseToken: receipt.value.leaseToken });
        return false;
      }
      if (current === null || current.releasing) {
        releaseLease({ rootPath, leaseToken: receipt.value.leaseToken });
        return false;
      }
      if (current.trust !== "trusted") {
        releaseLease({ rootPath, leaseToken: receipt.value.leaseToken });
        return false;
      }
      if (current.leaseToken === receipt.value.leaseToken) {
        if (current.workspaceId === receipt.value.workspaceId) return true;
        return patchEntry(rootKey, generation, {
          leaseToken: receipt.value.leaseToken,
          workspaceId: receipt.value.workspaceId,
          observedWorkspaceId: receipt.value.workspaceId,
          workspaceGeneration: current.workspaceGeneration + 1,
        });
      }
      if (current.leaseToken !== null) {
        releaseLease({ rootPath, leaseToken: receipt.value.leaseToken });
        return true;
      }
      return patchEntry(rootKey, generation, {
        leaseToken: receipt.value.leaseToken,
        workspaceId: receipt.value.workspaceId,
        observedWorkspaceId: receipt.value.workspaceId,
        workspaceGeneration:
          current.workspaceId === receipt.value.workspaceId
            ? current.workspaceGeneration
            : current.workspaceGeneration + 1,
      });
    },
    [entryForOwner, patchEntry, releaseLease],
  );

  const runProjectLoad = useCallback(
    async (rootKey: string, generation: number): Promise<void> => {
      const scheduledEntry = entryFor(rootKey, generation);
      if (scheduledEntry === null || scheduledEntry.releasing) return;
      const ownerId = scheduledEntry.ownerId;
      await acquireLoadSlot(activeLoadsRef, loadQueueRef);
      try {
        const initial = entryForOwner(rootKey, generation, ownerId);
        if (initial === null || initial.releasing) return;
        const rootPath = initial.rootPath;
        const deps = dependenciesRef.current;

        const trustResult = await attempt(() => deps.trustGateway.getTrust(rootPath));
        if (entryForOwner(rootKey, generation, ownerId) === null) return;
        if (!trustResult.ok) {
          dependenciesRef.current.reportError(AGENT_PROJECTS_SOURCE, trustResult.error);
        }
        const gatewayTrust: AgentProjectTrust = trustResult.ok
          ? trustResult.value.trusted
            ? "trusted"
            : "untrusted"
          : "unknown";
        const trust =
          activeWorkspaceTrustForRoot(dependenciesRef.current, rootPath) ?? gatewayTrust;
        if (!applyEntryTrust(rootKey, generation, trust)) return;

        if (trust === "trusted") {
          await acquireEntryLease(rootKey, generation, ownerId);
          if (entryForOwner(rootKey, generation, ownerId) === null) return;
        }

        const settingsResult = await attempt(() =>
          dependenciesRef.current.settingsGateway.loadWorkspaceSettings(
            settingsIdentityForRoot(dependenciesRef.current, rootPath),
          ),
        );
        const afterSettings = entryForOwner(rootKey, generation, ownerId);
        if (afterSettings === null) return;
        if (!settingsResult.ok) {
          dependenciesRef.current.reportError(AGENT_PROJECTS_SOURCE, settingsResult.error);
        }
        const currentTrust =
          activeWorkspaceTrustForRoot(dependenciesRef.current, rootPath) ?? afterSettings.trust;
        if (!applyEntryTrust(rootKey, generation, currentTrust)) return;
        const isolationPolicy = settingsResult.ok
          ? settingsResult.value.agentIsolationPolicy
          : DEFAULT_AGENT_ISOLATION_POLICY;
        const manualMappings = settingsResult.ok ? settingsResult.value.gitDirectoryMappings : [];
        const auto = settingsResult.ok ? settingsResult.value.gitDirectoryMappingsAuto : false;
        if (!patchEntry(rootKey, generation, { isolationPolicy })) return;

        let detectedDirectories: readonly string[] | null = null;
        if (currentTrust === "trusted" && auto) {
          const detected = await attempt(() =>
            dependenciesRef.current.repositoryDiscoveryGateway.detectRepositories(rootPath),
          );
          const afterDiscovery = entryForOwner(rootKey, generation, ownerId);
          if (afterDiscovery === null) return;
          const finalTrust =
            activeWorkspaceTrustForRoot(dependenciesRef.current, rootPath) ?? afterDiscovery.trust;
          if (!applyEntryTrust(rootKey, generation, finalTrust)) return;
          if (finalTrust !== "trusted") {
            patchEntry(rootKey, generation, {
              repositories: resolveProjectRepositories(rootPath, manualMappings, null, false),
            });
            return;
          }
          if (detected.ok) {
            detectedDirectories = detected.value;
          }
          if (!detected.ok) {
            dependenciesRef.current.reportError(AGENT_PROJECTS_SOURCE, detected.error);
          }
        }
        const repositories = resolveProjectRepositories(
          rootPath,
          manualMappings,
          detectedDirectories,
          currentTrust === "trusted" && auto,
        );
        patchEntry(rootKey, generation, { repositories });
      } finally {
        releaseLoadSlot(activeLoadsRef, loadQueueRef);
      }
    },
    [acquireEntryLease, applyEntryTrust, entryFor, entryForOwner, patchEntry],
  );

  const scheduleProjectLoad = useCallback(
    (rootKey: string, generation: number): void => {
      void runProjectLoad(rootKey, generation).catch((error: unknown) => {
        dependenciesRef.current.reportError(AGENT_PROJECTS_SOURCE, error);
      });
    },
    [runProjectLoad],
  );

  useEffect(() => {
    const deps = dependenciesRef.current;
    const admission = computeAdmission(deps);
    const activeKey =
      deps.activeWorkspaceRoot === null
        ? null
        : normalizedWorkspaceRootKey(deps.activeWorkspaceRoot);
    const current = entriesRef.current;
    const next = new Map<string, AgentProjectEntry>();
    const scheduled: Array<{ rootKey: string; generation: number }> = [];
    let changed = false;

    for (const candidate of admission.admitted) {
      const closeAuthority = closeAuthoritiesRef.current.get(candidate.rootKey);
      const candidateWorkspaceId =
        candidate.rootKey === activeKey
          ? deps.activeWorkspaceId
          : (deps.descriptorForRoot(candidate.rootPath)?.workspaceId ?? null);
      const closedWorkspaceId = closedWorkspaceIdsByRootRef.current.get(candidate.rootKey);
      if (
        closedWorkspaceId !== undefined &&
        (candidateWorkspaceId === null || candidateWorkspaceId === closedWorkspaceId)
      )
        continue;
      if (closedWorkspaceId !== undefined) {
        closedWorkspaceIdsByRootRef.current.delete(candidate.rootKey);
      }
      if (closeAuthority !== undefined) continue;
      const existing = current.get(candidate.rootKey);
      if (existing !== undefined) {
        let entry = existing;
        if (!entry.releasing) {
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
              retiredWorkspaceIds.length < MAX_AGENT_PROJECT_RETIRED_OWNERS
                ? currentWorkspaceId
                : null;
            entry = {
              ...entry,
              workspaceId: admittedWorkspaceId,
              observedWorkspaceId: currentWorkspaceId,
              workspaceGeneration: entry.workspaceGeneration + 1,
              retiredWorkspaceIds,
            };
            changed = true;
          }
          const replaceOwnerId =
            candidate.rootKey === activeKey &&
            currentWorkspaceId !== null &&
            entry.ownerId !== currentWorkspaceId &&
            !deps.hasLiveTasksForOwner(entry.ownerId);
          if (replaceOwnerId && currentWorkspaceId !== null) {
            deps.releaseProjectTasks(entry.ownerId);
            ownerIdsRef.current.set(candidate.rootKey, currentWorkspaceId);
            entry = { ...entry, ownerId: currentWorkspaceId };
            scheduled.push({ rootKey: candidate.rootKey, generation: entry.generation });
            changed = true;
          }
          const activeTrust = activeWorkspaceTrustForRoot(deps, candidate.rootPath);
          if (activeTrust !== null && entry.trust !== activeTrust) {
            if (activeTrust === "untrusted" && entry.leaseToken !== null) {
              releaseLease({ rootPath: entry.rootPath, leaseToken: entry.leaseToken });
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
        }
        next.set(candidate.rootKey, entry);
        continue;
      }
      const generation = (generationSeedsRef.current.get(candidate.rootKey) ?? 0) + 1;
      generationSeedsRef.current.set(candidate.rootKey, generation);
      const frozenOwnerId = ownerIdsRef.current.get(candidate.rootKey);
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
        ownerIdsRef.current.set(candidate.rootKey, ownerId);
      }
      next.set(candidate.rootKey, {
        rootKey: candidate.rootKey,
        rootPath: candidate.rootPath,
        ownerId,
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
    for (const rootKey of closedWorkspaceIdsByRootRef.current.keys()) {
      if (!admittedRootKeys.has(rootKey)) closedWorkspaceIdsByRootRef.current.delete(rootKey);
    }
    for (const [rootKey, entry] of current) {
      if (next.has(rootKey)) continue;
      if (closeAuthoritiesRef.current.has(rootKey)) {
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

    if (!changed && sameOverflow(overflowRef.current, admission.overflow)) return;
    for (const rootKey of dropped) {
      const entry = current.get(rootKey) ?? next.get(rootKey);
      if (entry === undefined) continue;
      if (entry.leaseToken !== null) {
        releaseLease({ rootPath: entry.rootPath, leaseToken: entry.leaseToken });
      }
      for (const ownerId of entryOwnerIds(entry)) deps.releaseProjectTasks(ownerId);
    }
    entriesRef.current = next;
    overflowRef.current = admission.overflow;
    for (const load of scheduled) scheduleProjectLoad(load.rootKey, load.generation);
    publish();
  });

  const refreshProject = useCallback(
    async (rootKey: string): Promise<void> => {
      const entry = entriesRef.current.get(rootKey);
      if (entry === undefined || entry.releasing) return;
      if (!dependenciesRef.current.enabled) return;
      await runProjectLoad(rootKey, entry.generation);
    },
    [runProjectLoad],
  );

  const trustProject = useCallback(
    async (rootKey: string): Promise<void> => {
      const entry = entriesRef.current.get(rootKey);
      if (entry === undefined || entry.releasing) return;
      if (!dependenciesRef.current.enabled) return;
      if (entry.trust === "trusted") return;
      const generation = entry.generation;
      const ownerId = entry.ownerId;
      const workspaceId = entry.workspaceId;
      const workspaceGeneration = entry.workspaceGeneration;
      const confirmed = await confirmWorkbenchAction(
        dependenciesRef.current.prompter,
        `Trust this project to run agents?\n\n${entry.rootPath}`,
      );
      if (!confirmed) return;
      const current = entryForOwner(rootKey, generation, ownerId);
      if (
        current === null ||
        current.workspaceId !== workspaceId ||
        current.workspaceGeneration !== workspaceGeneration ||
        current.releasing ||
        current.trust === "trusted"
      )
        return;
      const granted = await attempt(() =>
        dependenciesRef.current.trustGateway.setTrust(entry.rootPath, true),
      );
      if (!granted.ok) {
        const afterFailure = entryForOwner(rootKey, generation, ownerId);
        if (
          afterFailure === null ||
          afterFailure.workspaceId !== workspaceId ||
          afterFailure.workspaceGeneration !== workspaceGeneration
        )
          return;
        dependenciesRef.current.reportError(AGENT_PROJECTS_SOURCE, granted.error);
        return;
      }
      const afterGrant = entryForOwner(rootKey, generation, ownerId);
      if (
        afterGrant === null ||
        afterGrant.workspaceId !== workspaceId ||
        afterGrant.workspaceGeneration !== workspaceGeneration
      )
        return;
      const activeRoot = dependenciesRef.current.activeWorkspaceRoot;
      const activeOwnerId = dependenciesRef.current.activeWorkspaceId;
      if (
        activeRoot !== null &&
        workspaceId !== null &&
        activeOwnerId === workspaceId &&
        normalizedWorkspaceRootKey(activeRoot) === entry.rootKey
      ) {
        dependenciesRef.current.onActiveWorkspaceTrustChanged(entry.rootPath, activeOwnerId, true);
        return;
      }
      if (!patchEntry(rootKey, generation, { trust: "trusted" })) return;
      await runProjectLoad(rootKey, generation);
    },
    [entryForOwner, patchEntry, runProjectLoad],
  );

  const releaseProject = useCallback(
    async (rootKey: string): Promise<void> => {
      const entry = entriesRef.current.get(rootKey);
      if (entry === undefined || entry.releasing) return;
      const generation = entry.generation;
      if (!patchEntry(rootKey, generation, { releasing: true })) return;
      const repositoryRoots = (entry.repositories ?? []).map(
        (repository) => repository.repositoryRoot,
      );
      const stopped = await attempt(async () => {
        for (const ownerId of entryOwnerIds(entry)) {
          await dependenciesRef.current.stopProjectTasks(ownerId, repositoryRoots);
        }
      });
      if (!stopped.ok) {
        dependenciesRef.current.reportError(AGENT_PROJECTS_SOURCE, stopped.error);
      }
      const current = entryFor(rootKey, generation);
      if (current === null) return;
      for (const ownerId of entryOwnerIds(current)) {
        dependenciesRef.current.releaseProjectTasks(ownerId);
      }
      if (entryHasLiveTasks(dependenciesRef.current, current)) return;
      dropEntry(rootKey);
    },
    [dropEntry, entryFor, patchEntry],
  );

  const closeWorkspaceProject = useCallback(
    async (
      descriptor: WorkspaceIdentityDescriptor,
      isCurrent: () => boolean,
    ): Promise<AgentWorkspaceProjectCloseResult> => {
      if (!isCurrent() || !mountedRef.current) return { status: "stale" };
      const selectedKey = normalizedWorkspaceRootKey(descriptor.selectedPath);
      const canonicalKey = normalizedWorkspaceRootKey(descriptor.canonicalRoot);
      const entry = [...entriesRef.current.values()].find(
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
      const retainedCloseAuthority = closeAuthoritiesRef.current.get(rootKey);
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
      closeAuthoritiesRef.current.set(rootKey, closeAuthority);
      const clearCloseAuthority = (): void => {
        if (closeAuthoritiesRef.current.get(rootKey) !== closeAuthority) return;
        closeAuthoritiesRef.current.delete(rootKey);
      };
      const ownerIds = entryOwnerIds(entry);
      const repositoryRoots = (entry.repositories ?? []).map(
        (repository) => repository.repositoryRoot,
      );
      const exactEntry = (): AgentProjectEntry | null => {
        if (!isCurrent() || !mountedRef.current) return null;
        const current = entryFor(rootKey, generation);
        if (current === null) return null;
        if (current.ownerId !== entry.ownerId) return null;
        if (current.workspaceId !== descriptor.workspaceId) return null;
        if (current.workspaceGeneration !== workspaceGeneration) return null;
        if (closeAuthoritiesRef.current.get(rootKey) !== closeAuthority) return null;
        return current;
      };
      const exactLeaseEntry = (): AgentProjectEntry | null => {
        const current = exactEntry();
        if (current === null) return null;
        if (current.leaseToken !== leaseToken) return null;
        return current;
      };
      const capturedEntry = (): AgentProjectEntry | null => {
        const current = entriesRef.current.get(rootKey);
        if (current === undefined || current.generation !== generation) return null;
        if (current.ownerId !== entry.ownerId) return null;
        if (current.workspaceId !== descriptor.workspaceId) return null;
        if (current.workspaceGeneration !== workspaceGeneration) return null;
        if (closeAuthoritiesRef.current.get(rootKey) !== closeAuthority) return null;
        return current;
      };
      for (const ownerId of ownerIds) {
        const stopped = await attempt(() =>
          dependenciesRef.current.stopProjectTasks(ownerId, repositoryRoots),
        );
        if (exactLeaseEntry() === null) {
          clearCloseAuthority();
          return { status: "stale" };
        }
        if (!stopped.ok) {
          dependenciesRef.current.reportError(AGENT_PROJECTS_SOURCE, stopped.error);
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
        dependenciesRef.current.releaseProjectTasks(ownerId);
      }
      if (entryHasLiveTasks(dependenciesRef.current, current)) {
        clearCloseAuthority();
        return { status: "task-stop-incomplete" };
      }
      if (leaseToken !== null) {
        const dependencies = dependenciesRef.current;
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
          const rootEntry = entriesRef.current.get(rootKey);
          const releasedEntry = rootEntry?.generation === generation ? rootEntry : null;
          if (releasedEntry?.leaseToken === leaseToken) {
            const next = new Map(entriesRef.current);
            next.set(rootKey, { ...releasedEntry, leaseToken: null });
            entriesRef.current = next;
          }
          clearCloseAuthority();
          if (mountedRef.current && releasedEntry?.leaseToken === leaseToken) {
            await acquireEntryLease(rootKey, generation, releasedEntry.ownerId);
          }
          return { status: "stale" };
        }
        const rootEntry = entriesRef.current.get(rootKey);
        const releasedEntry = rootEntry?.generation === generation ? rootEntry : null;
        if (releasedEntry?.leaseToken === leaseToken) {
          const next = new Map(entriesRef.current);
          next.set(rootKey, { ...releasedEntry, leaseToken: null });
          entriesRef.current = next;
        }
        if (exactEntry() === null) {
          clearCloseAuthority();
          if (mountedRef.current && releasedEntry?.leaseToken === leaseToken) {
            await acquireEntryLease(rootKey, generation, releasedEntry.ownerId);
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
            const current = capturedEntry();
            clearCloseAuthority();
            if (current === null) return;
            if (outcome === "backend-not-closed") {
              await acquireEntryLease(rootKey, generation, current.ownerId);
              return;
            }
            const next = new Map(entriesRef.current);
            next.delete(rootKey);
            entriesRef.current = next;
            publish();
          },
          finalizeBackendClosed: () => {
            closedWorkspaceIdsByRootRef.current.set(rootKey, descriptor.workspaceId);
            clearCloseAuthority();
            publish();
          },
        },
      };
    },
    [acquireEntryLease, entryFor],
  );

  const ensureProjectLease = useCallback(
    async (rootKey: string): Promise<boolean> => {
      if (!dependenciesRef.current.enabled) return true;
      const entry = entriesRef.current.get(rootKey);
      if (entry === undefined || entry.releasing || closeAuthoritiesRef.current.has(rootKey))
        return false;
      return acquireEntryLease(rootKey, entry.generation, entry.ownerId);
    },
    [acquireEntryLease],
  );

  const ensureProjectLaunchIdentity = useCallback(
    async (rootKey: string): Promise<AgentProjectLaunchIdentity | null> => {
      const existingIdentity = launchIdentityForProject(rootKey);
      if (existingIdentity !== null) return existingIdentity;
      const entry = entriesRef.current.get(rootKey);
      if (
        entry === undefined ||
        entry.releasing ||
        !entry.admitted ||
        closeAuthoritiesRef.current.has(rootKey)
      ) {
        return null;
      }
      if (entry.workspaceId === null) {
        const leased = await acquireEntryLease(rootKey, entry.generation, entry.ownerId);
        if (!leased) return null;
        const leasedIdentity = launchIdentityForProject(rootKey);
        if (leasedIdentity !== null) return leasedIdentity;
      }
      const currentEntry = entriesRef.current.get(rootKey);
      if (currentEntry === undefined || currentEntry.workspaceId !== null) {
        return launchIdentityForProject(rootKey);
      }
      const activateWorkspaceRoot = dependenciesRef.current.activateWorkspaceRoot;
      if (activateWorkspaceRoot === undefined) return null;
      const authority = { generation: currentEntry.generation, ownerId: currentEntry.ownerId };
      const activated = await attempt(() => activateWorkspaceRoot(currentEntry.rootPath));
      if (!activated.ok) {
        const current = entriesRef.current.get(rootKey);
        if (
          current?.generation === authority.generation &&
          current.ownerId === authority.ownerId
        ) {
          dependenciesRef.current.reportError(AGENT_PROJECTS_SOURCE, activated.error);
        }
        return null;
      }
      const current = entriesRef.current.get(rootKey);
      if (
        current === undefined ||
        current.generation !== authority.generation ||
        current.ownerId !== authority.ownerId ||
        current.releasing ||
        !current.admitted ||
        current.workspaceId !== null ||
        closeAuthoritiesRef.current.has(rootKey)
      ) {
        return launchIdentityForProject(rootKey);
      }
      const descriptor = dependenciesRef.current.descriptorForRoot(current.rootPath);
      if (descriptor === null) return null;
      const workspaceGeneration = current.workspaceGeneration + 1;
      if (
        !patchEntry(rootKey, current.generation, {
          workspaceId: descriptor.workspaceId,
          observedWorkspaceId: descriptor.workspaceId,
          workspaceGeneration,
        })
      ) {
        return null;
      }
      return { workspaceId: descriptor.workspaceId, generation: workspaceGeneration };
    },
    [acquireEntryLease, launchIdentityForProject, patchEntry],
  );

  const noteDispatchTrustRejected = useCallback(
    (rootKey: string): void => {
      const entry = entriesRef.current.get(rootKey);
      if (entry === undefined) return;
      if (entry.trust === "untrusted") return;
      const activeRoot = dependenciesRef.current.activeWorkspaceRoot;
      const activeOwnerId = dependenciesRef.current.activeWorkspaceId;
      if (
        activeRoot !== null &&
        activeOwnerId !== null &&
        normalizedWorkspaceRootKey(activeRoot) === entry.rootKey
      ) {
        dependenciesRef.current.onActiveWorkspaceTrustChanged(entry.rootPath, activeOwnerId, false);
      }
      applyEntryTrust(rootKey, entry.generation, "untrusted");
    },
    [applyEntryTrust],
  );

  const activeRootKey = dependencies.activeWorkspaceRoot
    ? normalizedWorkspaceRootKey(dependencies.activeWorkspaceRoot)
    : null;
  const projects = useMemo(
    () =>
      projectDescriptors(
        version,
        entriesRef.current,
        activeRootKey,
        dependencies.activeWorkspaceRepositories,
        dependencies.activeIsolationPolicy,
      ),
    [
      activeRootKey,
      dependencies.activeIsolationPolicy,
      dependencies.activeWorkspaceRepositories,
      version,
    ],
  );

  const overflowRootPaths = useMemo(() => overflowSnapshot(version, overflowRef), [version]);

  return useMemo(
    () => ({
      projects,
      overflowRootPaths,
      refreshProject,
      trustProject,
      releaseProject,
      closeWorkspaceProject,
      ensureProjectLease,
      ensureProjectLaunchIdentity,
      launchIdentityForProject,
      isCurrentRepositoryOwner,
      noteDispatchTrustRejected,
    }),
    [
      ensureProjectLease,
      ensureProjectLaunchIdentity,
      launchIdentityForProject,
      isCurrentRepositoryOwner,
      noteDispatchTrustRejected,
      overflowRootPaths,
      projects,
      refreshProject,
      releaseProject,
      closeWorkspaceProject,
      trustProject,
    ],
  );
}

function entryOwnerIds(entry: AgentProjectEntry): ReadonlyArray<string> {
  const ownerIds = new Set(entry.retiredWorkspaceIds);
  ownerIds.add(entry.ownerId);
  if (entry.workspaceId !== null) ownerIds.add(entry.workspaceId);
  return [...ownerIds];
}

function entryHasLiveTasks(
  dependencies: Pick<AgentProjectsDependencies, "hasLiveTasksForOwner">,
  entry: AgentProjectEntry,
): boolean {
  return entryOwnerIds(entry).some((ownerId) => dependencies.hasLiveTasksForOwner(ownerId));
}

interface AdmissionCandidate {
  readonly rootKey: string;
  readonly rootPath: string;
}

interface Admission {
  readonly admitted: ReadonlyArray<AdmissionCandidate>;
  readonly overflow: ReadonlyArray<string>;
}

function activeWorkspaceTrustForRoot(
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

function computeAdmission(dependencies: AgentProjectsDependencies): Admission {
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

function sameOverflow(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function settingsIdentityForRoot(
  dependencies: AgentProjectsDependencies,
  rootPath: string,
): string | ReturnType<typeof workspaceSettingsIdentity> {
  const descriptor = dependencies.descriptorForRoot(rootPath);
  if (descriptor === null) return rootPath;
  return workspaceSettingsIdentity(descriptor.canonicalRoot, rootPath);
}

function resolveProjectRepositories(
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

function overflowSnapshot(
  _revision: number,
  overflowRef: { readonly current: ReadonlyArray<string> },
): ReadonlyArray<string> {
  return overflowRef.current;
}

function projectDescriptors(
  _revision: number,
  entries: ReadonlyMap<string, AgentProjectEntry>,
  activeRootKey: string | null,
  activeRepositories: ReadonlyArray<ResolvedGitRepository>,
  activeIsolationPolicy: AgentIsolationPolicy,
): ReadonlyArray<AgentProjectDescriptor> {
  const claimedRepositoryRoots = new Set<string>();
  const descriptors: AgentProjectDescriptor[] = [];
  for (const entry of entries.values()) {
    const isActive = entry.rootKey === activeRootKey && entry.admitted && !entry.releasing;
    const source = isActive ? activeRepositories : (entry.repositories ?? []);
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
      isolationPolicy: isActive
        ? activeIsolationPolicy
        : (entry.isolationPolicy ?? DEFAULT_AGENT_ISOLATION_POLICY),
      leaseToken: entry.leaseToken,
    });
  }
  return descriptors;
}

function sameRepositories(
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

async function acquireLoadSlot(
  activeLoadsRef: { current: number },
  loadQueueRef: { current: Array<() => void> },
): Promise<void> {
  if (activeLoadsRef.current < MAX_CONCURRENT_AGENT_PROJECT_LOADS) {
    activeLoadsRef.current += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    loadQueueRef.current.push(resolve);
  });
  activeLoadsRef.current += 1;
}

function releaseLoadSlot(
  activeLoadsRef: { current: number },
  loadQueueRef: { current: Array<() => void> },
): void {
  activeLoadsRef.current -= 1;
  const nextWaiter = loadQueueRef.current.shift();
  if (nextWaiter === undefined) return;
  nextWaiter();
}
