import { describe, expect, it, vi } from "vitest";
import { MAX_AGENT_PROJECT_ROOTS, agentRootOwnerId } from "../../domain/agentProject";
import { DEFAULT_AGENT_ISOLATION_POLICY } from "../../domain/agentSettings";
import type { ResolvedGitRepository } from "../../domain/gitRepositoryMapping";
import { defaultAppSettings, defaultWorkspaceSettings } from "../../domain/settings";
import type { WorkspaceTrustState } from "../../domain/trust";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";
import {
  MAX_CONCURRENT_AGENT_PROJECT_LOADS,
  type AgentProjectsDependencies,
} from "./agentProjectsContract";
import { createAgentProjectsCoordinator } from "./agentProjectsCoordinator";
import {
  agentRootLeaseReleaseFailure,
  computeAdmission,
  entryOwnerIds,
  projectDescriptors,
  type AgentProjectEntry,
} from "./agentProjectEntries";

const ACTIVE_ROOT = "/ws/active";
const ACTIVE_ID = "workspace-active";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function repository(repositoryRoot: string): ResolvedGitRepository {
  return { mapping: { rootRelativePath: "" }, repositoryRoot, repositoryRelativePath: "" };
}

function descriptor(rootPath: string, canonicalRoot: string): WorkspaceIdentityDescriptor {
  return {
    workspaceId: `id:${canonicalRoot}`,
    selectedPath: rootPath,
    canonicalRoot,
    caseSensitive: null,
    unicodeNormalizationPolicy: "nfc",
    policy: "posix",
  } as unknown as WorkspaceIdentityDescriptor;
}

function entry(patch: Partial<AgentProjectEntry>): AgentProjectEntry {
  return {
    rootKey: ACTIVE_ROOT,
    rootPath: ACTIVE_ROOT,
    ownerId: ACTIVE_ID,
    supersededOwnerId: null,
    workspaceId: ACTIVE_ID,
    observedWorkspaceId: ACTIVE_ID,
    workspaceGeneration: 1,
    retiredWorkspaceIds: [],
    generation: 1,
    trust: "trusted",
    isolationPolicy: null,
    repositories: null,
    leaseToken: null,
    admitted: true,
    releasing: false,
    ...patch,
  };
}

function dependencies(patch: Partial<AgentProjectsDependencies> = {}): AgentProjectsDependencies {
  let leaseToken = 0;
  return {
    enabled: true,
    appSettingsRef: { current: { ...defaultAppSettings(), workspaceTabs: [] } },
    activeWorkspaceId: ACTIVE_ID,
    activeWorkspaceRoot: ACTIVE_ROOT,
    activeWorkspaceTrust: null,
    activeWorkspaceRepositories: [],
    activeIsolationPolicy: DEFAULT_AGENT_ISOLATION_POLICY,
    descriptorForRoot: () => null,
    settingsGateway: { loadWorkspaceSettings: vi.fn(async () => defaultWorkspaceSettings()) },
    trustGateway: {
      getTrust: vi.fn(async (rootPath: string) => ({ rootPath, trusted: true })),
      setTrust: vi.fn(async (rootPath: string, trusted: boolean) => ({ rootPath, trusted })),
    },
    repositoryDiscoveryGateway: { detectRepositories: vi.fn(async () => []) },
    agentRootLeaseGateway: {
      acquireAgentRootLease: vi.fn(async () => {
        leaseToken += 1;
        return { leaseToken, workspaceId: ACTIVE_ID };
      }),
      releaseAgentRootLease: vi.fn(async ({ leaseToken: token }) => ({
        kind: "released" as const,
        leaseToken: token,
      })),
    },
    hasLiveTasksForOwner: () => false,
    stopProjectTasks: vi.fn(async () => undefined),
    releaseProjectTasks: vi.fn(),
    onActiveWorkspaceTrustChanged: vi.fn(),
    prompter: { confirm: () => true, prompt: () => null },
    reportError: vi.fn(),
    ...patch,
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe("agent project entry policies", () => {
  it("admits the active root first, dedupes canonical aliases, and reports overflow", () => {
    const tabs = ["/var/shared", "/private/var/shared"];
    for (let index = 0; index < MAX_AGENT_PROJECT_ROOTS; index += 1) tabs.push(`/ws/${index}`);
    const admission = computeAdmission(
      dependencies({
        appSettingsRef: { current: { ...defaultAppSettings(), workspaceTabs: tabs } },
        descriptorForRoot: (rootPath) =>
          rootPath === "/var/shared" ? descriptor(rootPath, "/private/var/shared") : null,
      }),
    );
    expect(admission.admitted.map((candidate) => candidate.rootPath).slice(0, 3)).toEqual([
      ACTIVE_ROOT,
      "/var/shared",
      "/ws/0",
    ]);
    expect(admission.admitted).toHaveLength(MAX_AGENT_PROJECT_ROOTS);
    expect(admission.overflow).toEqual(["/ws/62", "/ws/63"]);
  });

  it("fails closed on mismatched or non-released lease release results", () => {
    expect(agentRootLeaseReleaseFailure({ kind: "released", leaseToken: 3 }, 3)).toBeNull();
    expect(agentRootLeaseReleaseFailure({ kind: "released", leaseToken: 4 }, 3)).toBeInstanceOf(
      Error,
    );
    expect(agentRootLeaseReleaseFailure({ kind: "notHeld", leaseToken: 3 }, 3)).toBeInstanceOf(
      Error,
    );
    expect(agentRootLeaseReleaseFailure({ kind: "foreignOwner", leaseToken: 3 }, 3)).toBeInstanceOf(
      Error,
    );
  });

  it("unions retired, superseded, current, and workspace owners without duplicates", () => {
    expect(
      entryOwnerIds(
        entry({
          retiredWorkspaceIds: ["old", "older"],
          supersededOwnerId: "old",
          ownerId: "owner",
          workspaceId: "owner",
        }),
      ),
    ).toEqual(["old", "older", "owner"]);
  });

  it("claims each repository root for the first project only", () => {
    const entries = new Map([
      ["/a", entry({ rootKey: "/a", rootPath: "/a", repositories: [repository("/shared")] })],
      ["/b", entry({ rootKey: "/b", rootPath: "/b", repositories: [repository("/shared")] })],
    ]);
    const descriptors = projectDescriptors(entries, null, [], DEFAULT_AGENT_ISOLATION_POLICY);
    expect(descriptors.map((project) => project.repositories.length)).toEqual([1, 0]);
    expect(descriptors.map((project) => project.origin)).toEqual([
      "background-tab",
      "background-tab",
    ]);
  });
});

describe("agent projects coordinator", () => {
  it("admits, trusts, and leases the active root and exposes its launch identity", async () => {
    const publish = vi.fn();
    const coordinator = createAgentProjectsCoordinator(dependencies(), publish);
    coordinator.reconcile();
    await settle();

    const [project] = coordinator.projects(ACTIVE_ROOT, [], DEFAULT_AGENT_ISOLATION_POLICY);
    expect(project?.trust).toBe("trusted");
    expect(project?.leaseToken).toBe(1);
    expect(coordinator.projectsLoaded()).toBe(true);
    expect(coordinator.launchIdentityForProject(ACTIVE_ROOT)).toEqual({
      workspaceId: ACTIVE_ID,
      generation: 1,
    });
    expect(publish).toHaveBeenCalled();
  });

  it("drops a late trust result after the coordinator is unmounted", async () => {
    const trust = deferred<WorkspaceTrustState>();
    const deps = dependencies({
      trustGateway: { getTrust: () => trust.promise, setTrust: vi.fn() },
    });
    const coordinator = createAgentProjectsCoordinator(deps, vi.fn());
    coordinator.reconcile();
    await settle();
    coordinator.setMounted(false);
    trust.resolve({ rootPath: ACTIVE_ROOT, trusted: true });
    await settle();

    expect(deps.agentRootLeaseGateway.acquireAgentRootLease).not.toHaveBeenCalled();
    const [project] = coordinator.projects(ACTIVE_ROOT, [], DEFAULT_AGENT_ISOLATION_POLICY);
    expect(project?.trust).toBe("unknown");
  });

  it("treats a root removed and re-admitted as a new generation", async () => {
    const tabs = { ...defaultAppSettings(), workspaceTabs: ["/ws/b"] };
    let deps = dependencies({ appSettingsRef: { current: tabs } });
    const coordinator = createAgentProjectsCoordinator(deps, vi.fn());
    coordinator.reconcile();
    await settle();
    const first = coordinator
      .projects(ACTIVE_ROOT, [], DEFAULT_AGENT_ISOLATION_POLICY)
      .find((project) => project.rootKey === "/ws/b");
    expect(first?.ownerId).toBe(agentRootOwnerId("/ws/b"));

    deps = { ...deps, appSettingsRef: { current: { ...tabs, workspaceTabs: [] } } };
    coordinator.setDependencies(deps);
    coordinator.reconcile();
    await settle();
    expect(deps.releaseProjectTasks).toHaveBeenCalledWith(agentRootOwnerId("/ws/b"));

    coordinator.setDependencies({ ...deps, appSettingsRef: { current: tabs } });
    coordinator.reconcile();
    await settle();
    const second = coordinator
      .projects(ACTIVE_ROOT, [], DEFAULT_AGENT_ISOLATION_POLICY)
      .find((project) => project.rootKey === "/ws/b");
    expect(second?.generation).toBe((first?.generation ?? 0) + 1);
  });

  it("bounds concurrent project loads", async () => {
    const pending: Array<ReturnType<typeof deferred<WorkspaceTrustState>>> = [];
    const deps = dependencies({
      appSettingsRef: {
        current: { ...defaultAppSettings(), workspaceTabs: ["/ws/1", "/ws/2", "/ws/3"] },
      },
      trustGateway: {
        getTrust: () => {
          const next = deferred<WorkspaceTrustState>();
          pending.push(next);
          return next.promise;
        },
        setTrust: vi.fn(),
      },
    });
    const coordinator = createAgentProjectsCoordinator(deps, vi.fn());
    coordinator.reconcile();
    await settle();
    expect(pending).toHaveLength(MAX_CONCURRENT_AGENT_PROJECT_LOADS);

    pending[0]?.resolve({ rootPath: ACTIVE_ROOT, trusted: false });
    await settle();
    expect(pending).toHaveLength(MAX_CONCURRENT_AGENT_PROJECT_LOADS + 1);
  });

  it("revokes trust and releases the lease when dispatch trust is rejected", async () => {
    const deps = dependencies();
    const coordinator = createAgentProjectsCoordinator(deps, vi.fn());
    coordinator.reconcile();
    await settle();

    coordinator.noteDispatchTrustRejected(ACTIVE_ROOT);
    await settle();

    expect(deps.onActiveWorkspaceTrustChanged).toHaveBeenCalledWith(ACTIVE_ROOT, ACTIVE_ID, false);
    expect(deps.agentRootLeaseGateway.releaseAgentRootLease).toHaveBeenCalledWith({
      rootPath: ACTIVE_ROOT,
      leaseToken: 1,
    });
    const [project] = coordinator.projects(ACTIVE_ROOT, [], DEFAULT_AGENT_ISOLATION_POLICY);
    expect(project?.trust).toBe("untrusted");
    expect(project?.leaseToken).toBeNull();
  });
});
