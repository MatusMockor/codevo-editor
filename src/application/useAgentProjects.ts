import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import {
  MAX_AGENT_PROJECT_ROOTS,
  agentRootOwnerId,
  type AgentProjectDescriptor,
  type AgentProjectOrigin,
  type AgentProjectTrust,
  type AgentRootLeaseGateway,
} from "../domain/agentProject";
import { DEFAULT_AGENT_ISOLATION_POLICY, type AgentIsolationPolicy } from "../domain/agentSettings";
import {
  repositoryRootForMapping,
  resolveEffectiveGitRepositoryMappings,
  type ResolvedGitRepository,
} from "../domain/gitRepositoryMapping";
import type { AppSettings, SettingsGateway } from "../domain/settings";
import type { WorkspaceTrustGateway } from "../domain/trust";
import { normalizedWorkspaceRootKey, workspaceDisplayName } from "../domain/workspaceRootKey";
import { workspaceSettingsIdentity } from "./workbenchController/workspaceIdentityPolicy";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";
import type { WorkbenchPrompter } from "./workbenchPrompter";

export const MAX_CONCURRENT_AGENT_PROJECT_LOADS = 2;

export interface AgentRepositoryDiscoveryGateway {
  detectRepositories(rootPath: string, maxDepth?: number): Promise<string[]>;
}

export interface AgentProjectsDependencies {
  readonly enabled: boolean;
  readonly appSettingsRef: { readonly current: AppSettings };
  readonly activeWorkspaceId: string | null;
  readonly activeWorkspaceRoot: string | null;
  readonly activeWorkspaceRepositories: ReadonlyArray<ResolvedGitRepository>;
  readonly activeIsolationPolicy: AgentIsolationPolicy;
  readonly descriptorForRoot: (rootPath: string) => WorkspaceIdentityDescriptor | null;
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
  readonly prompter: WorkbenchPrompter;
  readonly reportError: (source: string, error: unknown) => void;
}

export interface AgentProjectsSurface {
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly overflowRootPaths: ReadonlyArray<string>;
  refreshProject(rootKey: string): Promise<void>;
  trustProject(rootKey: string): Promise<void>;
  releaseProject(rootKey: string): Promise<void>;
  ensureProjectLease(rootKey: string): Promise<boolean>;
  noteDispatchTrustRejected(rootKey: string): void;
}

const AGENT_PROJECTS_SOURCE = "Agents";

interface AgentProjectEntry {
  readonly rootKey: string;
  readonly rootPath: string;
  readonly ownerId: string;
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
  const activeLoadsRef = useRef(0);
  const loadQueueRef = useRef<Array<() => void>>([]);
  const mountedRef = useRef(true);
  const [version, publish] = useReducer((current: number) => current + 1, 0);

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
    void dependenciesRef.current.agentRootLeaseGateway
      .releaseAgentRootLease({ rootPath: lease.rootPath, leaseToken: lease.leaseToken })
      .catch((error: unknown) => {
        dependenciesRef.current.reportError(AGENT_PROJECTS_SOURCE, error);
      });
  }, []);

  const dropEntry = useCallback(
    (rootKey: string): void => {
      const entry = entriesRef.current.get(rootKey);
      if (entry === undefined) return;
      if (entry.leaseToken !== null) {
        releaseLease({ rootPath: entry.rootPath, leaseToken: entry.leaseToken });
      }
      dependenciesRef.current.releaseProjectTasks(entry.ownerId);
      const next = new Map(entriesRef.current);
      next.delete(rootKey);
      entriesRef.current = next;
      publish();
    },
    [releaseLease],
  );

  const acquireEntryLease = useCallback(
    async (rootKey: string, generation: number): Promise<boolean> => {
      const entry = entryFor(rootKey, generation);
      if (entry === null || entry.releasing) return false;
      if (entry.leaseToken !== null) return true;
      if (entry.trust !== "trusted") return false;
      const rootPath = entry.rootPath;
      const receipt = await attempt(() =>
        dependenciesRef.current.agentRootLeaseGateway.acquireAgentRootLease({ rootPath }),
      );
      if (!receipt.ok) {
        dependenciesRef.current.reportError(AGENT_PROJECTS_SOURCE, receipt.error);
        return false;
      }
      const current = entryFor(rootKey, generation);
      if (current === null || current.releasing) {
        releaseLease({ rootPath, leaseToken: receipt.value.leaseToken });
        return false;
      }
      if (current.leaseToken === receipt.value.leaseToken) return true;
      if (current.leaseToken !== null) {
        releaseLease({ rootPath, leaseToken: receipt.value.leaseToken });
        return true;
      }
      return patchEntry(rootKey, generation, { leaseToken: receipt.value.leaseToken });
    },
    [entryFor, patchEntry, releaseLease],
  );

  const runProjectLoad = useCallback(
    async (rootKey: string, generation: number): Promise<void> => {
      await acquireLoadSlot(activeLoadsRef, loadQueueRef);
      try {
        const initial = entryFor(rootKey, generation);
        if (initial === null || initial.releasing) return;
        const rootPath = initial.rootPath;
        const deps = dependenciesRef.current;

        const trustResult = await attempt(() => deps.trustGateway.getTrust(rootPath));
        if (!trustResult.ok) {
          dependenciesRef.current.reportError(AGENT_PROJECTS_SOURCE, trustResult.error);
        }
        const trust: AgentProjectTrust = trustResult.ok
          ? trustResult.value.trusted
            ? "trusted"
            : "untrusted"
          : "unknown";
        if (!patchEntry(rootKey, generation, { trust })) return;

        if (trust === "trusted") {
          await acquireEntryLease(rootKey, generation);
          if (entryFor(rootKey, generation) === null) return;
        }

        const settingsResult = await attempt(() =>
          dependenciesRef.current.settingsGateway.loadWorkspaceSettings(
            settingsIdentityForRoot(dependenciesRef.current, rootPath),
          ),
        );
        if (!settingsResult.ok) {
          dependenciesRef.current.reportError(AGENT_PROJECTS_SOURCE, settingsResult.error);
        }
        if (entryFor(rootKey, generation) === null) return;
        const isolationPolicy = settingsResult.ok
          ? settingsResult.value.agentIsolationPolicy
          : DEFAULT_AGENT_ISOLATION_POLICY;
        const manualMappings = settingsResult.ok ? settingsResult.value.gitDirectoryMappings : [];
        const auto = settingsResult.ok ? settingsResult.value.gitDirectoryMappingsAuto : false;
        if (!patchEntry(rootKey, generation, { isolationPolicy })) return;

        let detectedDirectories: readonly string[] | null = null;
        if (trust === "trusted" && auto) {
          const detected = await attempt(() =>
            dependenciesRef.current.repositoryDiscoveryGateway.detectRepositories(rootPath),
          );
          if (entryFor(rootKey, generation) === null) return;
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
          trust === "trusted" && auto,
        );
        patchEntry(rootKey, generation, { repositories });
      } finally {
        releaseLoadSlot(activeLoadsRef, loadQueueRef);
      }
    },
    [acquireEntryLease, entryFor, patchEntry],
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
      const existing = current.get(candidate.rootKey);
      if (existing !== undefined) {
        let entry = existing;
        if (!entry.releasing) {
          if (!entry.admitted) {
            entry = { ...entry, admitted: true };
            changed = true;
          }
          const upgradeOwnerId =
            candidate.rootKey === activeKey &&
            deps.activeWorkspaceId !== null &&
            entry.ownerId !== deps.activeWorkspaceId &&
            !ownerIdsRef.current.has(candidate.rootKey) &&
            !deps.hasLiveTasksForOwner(entry.ownerId);
          if (upgradeOwnerId && deps.activeWorkspaceId !== null) {
            deps.releaseProjectTasks(entry.ownerId);
            ownerIdsRef.current.set(candidate.rootKey, deps.activeWorkspaceId);
            entry = { ...entry, ownerId: deps.activeWorkspaceId };
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
        generation,
        trust: deps.enabled ? "unknown" : "trusted",
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
    for (const [rootKey, entry] of current) {
      if (next.has(rootKey)) continue;
      const draining = entry.releasing || !entry.admitted;
      if (!draining && !deps.hasLiveTasksForOwner(entry.ownerId)) {
        dropped.push(rootKey);
        changed = true;
        continue;
      }
      if (deps.hasLiveTasksForOwner(entry.ownerId)) {
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
      if (deps.hasLiveTasksForOwner(entry.ownerId)) continue;
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
      deps.releaseProjectTasks(entry.ownerId);
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
      const confirmed = dependenciesRef.current.prompter.confirm(
        `Trust this project to run agents?\n\n${entry.rootPath}`,
      );
      if (!confirmed) return;
      const generation = entry.generation;
      const granted = await attempt(() =>
        dependenciesRef.current.trustGateway.setTrust(entry.rootPath, true),
      );
      if (!granted.ok) {
        dependenciesRef.current.reportError(AGENT_PROJECTS_SOURCE, granted.error);
        return;
      }
      if (!patchEntry(rootKey, generation, { trust: "trusted" })) return;
      await runProjectLoad(rootKey, generation);
    },
    [patchEntry, runProjectLoad],
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
      const stopped = await attempt(() =>
        dependenciesRef.current.stopProjectTasks(entry.ownerId, repositoryRoots),
      );
      if (!stopped.ok) {
        dependenciesRef.current.reportError(AGENT_PROJECTS_SOURCE, stopped.error);
      }
      const current = entryFor(rootKey, generation);
      if (current === null) return;
      dependenciesRef.current.releaseProjectTasks(entry.ownerId);
      if (dependenciesRef.current.hasLiveTasksForOwner(entry.ownerId)) return;
      dropEntry(rootKey);
    },
    [dropEntry, entryFor, patchEntry],
  );

  const ensureProjectLease = useCallback(
    async (rootKey: string): Promise<boolean> => {
      if (!dependenciesRef.current.enabled) return true;
      const entry = entriesRef.current.get(rootKey);
      if (entry === undefined || entry.releasing) return false;
      return acquireEntryLease(rootKey, entry.generation);
    },
    [acquireEntryLease],
  );

  const noteDispatchTrustRejected = useCallback(
    (rootKey: string): void => {
      const entry = entriesRef.current.get(rootKey);
      if (entry === undefined) return;
      if (entry.trust === "untrusted") return;
      patchEntry(rootKey, entry.generation, { trust: "untrusted" });
    },
    [patchEntry],
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
      ensureProjectLease,
      noteDispatchTrustRejected,
    }),
    [
      ensureProjectLease,
      noteDispatchTrustRejected,
      overflowRootPaths,
      projects,
      refreshProject,
      releaseProject,
      trustProject,
    ],
  );
}

interface AdmissionCandidate {
  readonly rootKey: string;
  readonly rootPath: string;
}

interface Admission {
  readonly admitted: ReadonlyArray<AdmissionCandidate>;
  readonly overflow: ReadonlyArray<string>;
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
