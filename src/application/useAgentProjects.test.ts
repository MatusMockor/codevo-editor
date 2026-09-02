// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_AGENT_PROJECT_ROOTS,
  agentRootOwnerId,
  type AgentRootLeaseReceipt,
  type AgentRootLeaseReleaseResult,
} from "../domain/agentProject";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  type AppSettings,
  type WorkspaceSettings,
  type WorkspaceSettingsIdentity,
} from "../domain/settings";
import type { ResolvedGitRepository } from "../domain/gitRepositoryMapping";
import type { WorkspaceTrustState } from "../domain/trust";
import { waitForReact } from "../test/reactTestLifecycle";
import {
  useAgentProjects,
  type AgentProjectsDependencies,
  type AgentProjectsSurface,
} from "./useAgentProjects";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";

const ACTIVE_ROOT = "/ws/active";
const ACTIVE_ID = "workspace-active";
const BACKGROUND_ROOT = "/ws/api";

function activeRepository(): ResolvedGitRepository {
  return {
    mapping: { rootRelativePath: "" },
    repositoryRoot: ACTIVE_ROOT,
    repositoryRelativePath: "",
  };
}

function descriptorFor(rootPath: string, workspaceId: string): WorkspaceIdentityDescriptor {
  return {
    workspaceId,
    selectedPath: rootPath,
    canonicalRoot: `/private${rootPath}`,
    caseSensitive: null,
    unicodeNormalizationPolicy: "nfc",
    policy: "posix",
  } as unknown as WorkspaceIdentityDescriptor;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("useAgentProjects admission and bounds", () => {
  it("admits the active root plus tabs in order and reports overflow truthfully", async () => {
    const harness = renderAgentProjects({
      tabs: Array.from({ length: 10 }, (_unused, index) => `/ws/tab-${index}`),
    });

    await waitForReact(() => expect(harness.hook().projects).toHaveLength(MAX_AGENT_PROJECT_ROOTS));

    const projects = harness.hook().projects;
    expect(projects[0]?.rootKey).toBe(ACTIVE_ROOT);
    expect(projects[0]?.origin).toBe("active-tab");
    expect(projects.slice(1).every((project) => project.origin === "background-tab")).toBe(true);
    expect(harness.hook().overflowRootPaths).toEqual(["/ws/tab-7", "/ws/tab-8", "/ws/tab-9"]);
    harness.unmount();
  });

  it("admits alias tabs of one canonical root as a single project without double-leasing", async () => {
    const aliasRoot = "/var/shared";
    const canonicalRoot = "/private/var/shared";
    const harness = renderAgentProjects({
      tabs: [aliasRoot, canonicalRoot],
      descriptors: [[aliasRoot, descriptorFor(aliasRoot, "workspace-shared")]],
    });

    await waitForReact(() => {
      const project = harness.hook().projects.find((candidate) => candidate.rootKey === aliasRoot);
      expect(project?.leaseToken).not.toBeNull();
    });

    const rootKeys = harness.hook().projects.map((project) => project.rootKey);
    expect(rootKeys).toContain(aliasRoot);
    expect(rootKeys).not.toContain(canonicalRoot);
    expect(
      harness.lease.acquireAgentRootLease.mock.calls.filter(
        ([request]) => request.rootPath !== ACTIVE_ROOT,
      ),
    ).toHaveLength(1);
    expect(harness.lease.releaseAgentRootLease).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("exposes only the active project without gateway calls when disabled", async () => {
    const harness = renderAgentProjects({ enabled: false, tabs: [BACKGROUND_ROOT] });

    await waitForReact(() => expect(harness.hook().projects).toHaveLength(1));

    const project = harness.hook().projects[0];
    expect(project?.rootKey).toBe(ACTIVE_ROOT);
    expect(project?.ownerId).toBe(ACTIVE_ID);
    expect(project?.trust).toBe("trusted");
    expect(project?.origin).toBe("active-tab");
    expect(project?.repositories.map((repository) => repository.repositoryRoot)).toEqual([
      ACTIVE_ROOT,
    ]);
    expect(harness.trust.getTrust).not.toHaveBeenCalled();
    expect(harness.settings.loadWorkspaceSettings).not.toHaveBeenCalled();
    expect(harness.discovery.detectRepositories).not.toHaveBeenCalled();
    expect(harness.lease.acquireAgentRootLease).not.toHaveBeenCalled();
    harness.unmount();
  });
});

describe("useAgentProjects background root loading", () => {
  it("omits an aggregate non-Git root while keeping its configured and discovered repositories", async () => {
    const harness = renderAgentProjects({ tabs: [BACKGROUND_ROOT] });
    harness.environment.workspaceSettingsByRoot.set(BACKGROUND_ROOT, {
      ...defaultWorkspaceSettings(),
      agentIsolationPolicy: "worktree",
      gitDirectoryMappings: ["packages/api"],
      gitDirectoryMappingsAuto: true,
    });
    harness.environment.detectedByRoot.set(BACKGROUND_ROOT, ["packages/web"]);

    await waitForReact(() => {
      const project = harness
        .hook()
        .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
      expect(project?.trust).toBe("trusted");
      expect(project?.leaseToken).not.toBeNull();
    });

    const project = harness
      .hook()
      .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
    expect(project?.ownerId).toBe(agentRootOwnerId(BACKGROUND_ROOT));
    expect(project?.isolationPolicy).toBe("worktree");
    expect(project?.repositories.map((repository) => repository.repositoryRoot)).toEqual([
      `${BACKGROUND_ROOT}/packages/api`,
      `${BACKGROUND_ROOT}/packages/web`,
    ]);
    expect(harness.lease.acquireAgentRootLease).toHaveBeenCalledWith({
      rootPath: BACKGROUND_ROOT,
    });
    harness.unmount();
  });

  it("acquires the dispose-protection lease before settings and discovery run", async () => {
    const harness = renderAgentProjects({ tabs: [BACKGROUND_ROOT] });

    await waitForReact(() => {
      const project = harness
        .hook()
        .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
      expect(project?.leaseToken).not.toBeNull();
      expect(project?.repositories.length).toBeGreaterThan(0);
    });

    const acquireIndex = harness.lease.acquireAgentRootLease.mock.calls.findIndex(
      ([request]) => request.rootPath === BACKGROUND_ROOT,
    );
    const settingsIndex = harness.settings.loadWorkspaceSettings.mock.calls.findIndex(
      ([identity]) => identity === BACKGROUND_ROOT,
    );
    expect(acquireIndex).toBeGreaterThanOrEqual(0);
    expect(settingsIndex).toBeGreaterThanOrEqual(0);
    const acquireOrder =
      harness.lease.acquireAgentRootLease.mock.invocationCallOrder[acquireIndex] ?? Infinity;
    const settingsOrder =
      harness.settings.loadWorkspaceSettings.mock.invocationCallOrder[settingsIndex] ?? 0;
    expect(acquireOrder).toBeLessThan(settingsOrder);
    harness.unmount();
  });

  it("ensures a missing lease on demand after a refused load-time acquisition", async () => {
    const harness = renderAgentProjects({ tabs: [BACKGROUND_ROOT] });
    harness.lease.acquireAgentRootLease
      .mockRejectedValueOnce(new Error("Too many agent project roots are leased."))
      .mockRejectedValueOnce(new Error("Too many agent project roots are leased."));

    await waitForReact(() => {
      const project = harness
        .hook()
        .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
      expect(project?.trust).toBe("trusted");
      expect(project?.repositories.length).toBeGreaterThan(0);
      expect(project?.leaseToken).toBeNull();
    });
    expect(harness.reportError).toHaveBeenCalled();

    let granted = false;
    await act(async () => {
      granted = await harness.hook().ensureProjectLease(BACKGROUND_ROOT);
    });

    expect(granted).toBe(true);
    const project = harness
      .hook()
      .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
    expect(project?.leaseToken).not.toBeNull();
    harness.unmount();
  });

  it("fails closed when ensureProjectLease cannot acquire the lease", async () => {
    const harness = renderAgentProjects({ tabs: [BACKGROUND_ROOT] });
    harness.lease.acquireAgentRootLease.mockRejectedValue(
      new Error("Too many agent project roots are leased."),
    );

    await waitForReact(() => {
      const project = harness
        .hook()
        .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
      expect(project?.trust).toBe("trusted");
      expect(project?.repositories.length).toBeGreaterThan(0);
    });

    let granted = true;
    await act(async () => {
      granted = await harness.hook().ensureProjectLease(BACKGROUND_ROOT);
    });

    expect(granted).toBe(false);
    expect(harness.reportError).toHaveBeenCalled();
    const project = harness
      .hook()
      .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
    expect(project?.leaseToken).toBeNull();
    harness.unmount();
  });

  it("treats every project as protected when the surface is disabled", async () => {
    const harness = renderAgentProjects({ enabled: false, tabs: [] });

    await waitForReact(() => expect(harness.hook().projects).toHaveLength(1));

    let granted = false;
    await act(async () => {
      granted = await harness.hook().ensureProjectLease(ACTIVE_ROOT);
    });

    expect(granted).toBe(true);
    expect(harness.lease.acquireAgentRootLease).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("derives the canonical settings identity from the cached descriptor", async () => {
    const harness = renderAgentProjects({
      tabs: [BACKGROUND_ROOT],
      descriptors: [[BACKGROUND_ROOT, descriptorFor(BACKGROUND_ROOT, "ws-api-id")]],
    });

    await waitForReact(() =>
      expect(harness.settings.loadWorkspaceSettings).toHaveBeenCalledWith({
        canonicalKey: `/private${BACKGROUND_ROOT}`,
        legacyRawKeys: [`/private${BACKGROUND_ROOT}`, BACKGROUND_ROOT],
      }),
    );

    const project = harness
      .hook()
      .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
    expect(project?.ownerId).toBe("ws-api-id");
    harness.unmount();
  });

  it("falls back to the raw path identity without a descriptor and to a synthetic owner id", async () => {
    const harness = renderAgentProjects({ tabs: [BACKGROUND_ROOT] });

    await waitForReact(() =>
      expect(harness.settings.loadWorkspaceSettings).toHaveBeenCalledWith(BACKGROUND_ROOT),
    );

    const project = harness
      .hook()
      .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
    expect(project?.ownerId).toBe(agentRootOwnerId(BACKGROUND_ROOT));
    harness.unmount();
  });

  it("keeps an untrusted root without discovery or lease and with manual mappings only", async () => {
    const harness = renderAgentProjects({ tabs: [BACKGROUND_ROOT] });
    harness.environment.trustedByRoot.set(BACKGROUND_ROOT, false);
    harness.environment.workspaceSettingsByRoot.set(BACKGROUND_ROOT, {
      ...defaultWorkspaceSettings(),
      gitDirectoryMappings: ["packages/api"],
      gitDirectoryMappingsAuto: true,
    });

    await waitForReact(() => {
      const project = harness
        .hook()
        .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
      expect(project?.trust).toBe("untrusted");
      expect(project?.repositories.length).toBeGreaterThan(0);
    });

    const project = harness
      .hook()
      .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
    expect(project?.leaseToken).toBeNull();
    expect(project?.repositories.map((repository) => repository.repositoryRoot)).toEqual([
      BACKGROUND_ROOT,
      `${BACKGROUND_ROOT}/packages/api`,
    ]);
    expect(harness.discovery.detectRepositories).not.toHaveBeenCalledWith(BACKGROUND_ROOT);
    expect(harness.lease.acquireAgentRootLease).not.toHaveBeenCalledWith({
      rootPath: BACKGROUND_ROOT,
    });
    harness.unmount();
  });

  it("renders a trust gateway failure as unknown trust fail-closed", async () => {
    const harness = renderAgentProjects({ tabs: [BACKGROUND_ROOT] });
    harness.trust.getTrust.mockImplementation(async (rootPath: string) => {
      if (rootPath === BACKGROUND_ROOT) {
        return Promise.reject(new Error("trust backend offline"));
      }
      return { rootPath, trusted: true };
    });

    await waitForReact(() => {
      const project = harness
        .hook()
        .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
      expect(project?.trust).toBe("unknown");
    });

    expect(harness.reportError).toHaveBeenCalledWith("Agents", expect.any(Error));
    const project = harness
      .hook()
      .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
    expect(project?.leaseToken).toBeNull();
    harness.unmount();
  });

  it("caps concurrent root loads at two", async () => {
    const roots = ["/ws/one", "/ws/two", "/ws/three", "/ws/four"];
    const harness = renderAgentProjects({ tabs: roots, deferTrust: true });

    await waitForReact(() => expect(harness.environment.pendingTrust.size).toBeGreaterThan(0));
    expect(harness.environment.maxConcurrentTrustCalls).toBeLessThanOrEqual(2);

    await act(async () => {
      for (const [, deferred] of harness.environment.pendingTrust) {
        deferred.resolve({ rootPath: "", trusted: true });
      }
      harness.environment.pendingTrust.clear();
    });
    await waitForReact(() =>
      expect(harness.trust.getTrust.mock.calls.length).toBeGreaterThanOrEqual(4),
    );
    expect(harness.environment.maxConcurrentTrustCalls).toBeLessThanOrEqual(2);
    harness.unmount();
  });
});

describe("useAgentProjects lifecycle", () => {
  it("releases a stale lease receipt after same-generation owner promotion", async () => {
    const harness = renderAgentProjects({ activeWorkspaceId: null, deferLease: true });
    await waitForReact(() => expect(harness.environment.pendingLease).not.toBeNull());
    const staleLease = harness.environment.pendingLease;
    const initialOwnerId = harness.hook().projects[0]?.ownerId;

    harness.environment.activeWorkspaceId = ACTIVE_ID;
    harness.rerender();
    await waitForReact(() => expect(harness.hook().projects[0]?.ownerId).not.toBe(initialOwnerId));
    await act(async () => {
      staleLease?.resolve({ leaseToken: 41 });
    });

    await waitForReact(() => {
      expect(harness.lease.releaseAgentRootLease).toHaveBeenCalledWith({
        rootPath: ACTIVE_ROOT,
        leaseToken: 41,
      });
      expect(harness.environment.pendingLease).not.toBe(staleLease);
    });
    await act(async () => {
      harness.environment.pendingLease?.resolve({ leaseToken: 42 });
    });
    await waitForReact(() => expect(harness.hook().projects[0]?.leaseToken).toBe(42));
    harness.unmount();
  });

  it("does not publish an A2 lease acquired while an A1 cleanup becomes quarantined", async () => {
    const harness = renderAgentProjects({ activeWorkspaceId: null, deferLease: true });
    await waitForReact(() => expect(harness.environment.pendingLease).not.toBeNull());
    const staleLease = harness.environment.pendingLease;

    harness.environment.activeWorkspaceId = ACTIVE_ID;
    harness.rerender();
    await waitForReact(() => expect(harness.environment.pendingLease).not.toBe(staleLease));
    const replacementLease = harness.environment.pendingLease;
    harness.lease.releaseAgentRootLease.mockResolvedValueOnce({
      kind: "foreignOwner",
      leaseToken: 51,
    });

    await act(async () => {
      staleLease?.resolve({ leaseToken: 51 });
    });
    await waitForReact(() =>
      expect(harness.lease.releaseAgentRootLease).toHaveBeenCalledWith({
        rootPath: ACTIVE_ROOT,
        leaseToken: 51,
      }),
    );
    await act(async () => {
      replacementLease?.resolve({ leaseToken: 52 });
    });

    await waitForReact(() =>
      expect(harness.lease.releaseAgentRootLease).toHaveBeenCalledWith({
        rootPath: ACTIVE_ROOT,
        leaseToken: 52,
      }),
    );
    expect(harness.hook().projects[0]?.leaseToken).toBeNull();
    expect(await harness.hook().ensureProjectLease(ACTIVE_ROOT)).toBe(false);
    expect(harness.lease.acquireAgentRootLease).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it("replaces the active launch workspace while retaining a live project task owner", async () => {
    const harness = renderAgentProjects();
    await waitForReact(() => expect(harness.hook().projects[0]?.leaseToken).not.toBeNull());
    const previousLeaseToken = harness.hook().projects[0]?.leaseToken;
    harness.environment.liveOwners.add(ACTIVE_ID);

    harness.environment.activeWorkspaceId = "workspace-active-replaced";
    harness.rerender();

    await waitForReact(() => {
      expect(harness.hook().launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe(
        "workspace-active-replaced",
      );
    });
    expect(harness.hook().projects[0]?.ownerId).toBe(ACTIVE_ID);
    expect(harness.releaseProjectTasks).not.toHaveBeenCalledWith(ACTIVE_ID);
    expect(harness.hook().projects[0]?.leaseToken).toBe(previousLeaseToken);
    harness.unmount();
  });

  it("retains a replaced launch workspace while its task drains across A to B to A", async () => {
    const harness = renderAgentProjects();
    await waitForReact(() => expect(harness.hook().projects).toHaveLength(1));
    harness.environment.liveOwners.add(ACTIVE_ID);
    const generationA = harness.hook().launchIdentityForProject(ACTIVE_ROOT)?.generation;

    harness.environment.activeWorkspaceId = "workspace-b";
    harness.rerender();
    await waitForReact(() => {
      expect(harness.hook().launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe("workspace-b");
    });
    const generationB = harness.hook().launchIdentityForProject(ACTIVE_ROOT)?.generation;
    expect(generationB).toBeGreaterThan(generationA ?? 0);
    harness.environment.liveOwners.add("workspace-b");
    harness.environment.activeWorkspaceId = ACTIVE_ID;
    harness.rerender();
    await waitForReact(() => {
      expect(harness.hook().launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe(ACTIVE_ID);
    });
    expect(harness.hook().launchIdentityForProject(ACTIVE_ROOT)?.generation).toBeGreaterThan(
      generationB ?? 0,
    );

    harness.environment.tabs = [];
    harness.environment.activeWorkspaceRoot = null;
    harness.environment.activeWorkspaceId = null;
    harness.environment.activeWorkspaceTrust = null;
    harness.rerender();
    await waitForReact(() => expect(harness.hook().projects).toHaveLength(1));

    harness.environment.liveOwners.delete(ACTIVE_ID);
    harness.rerender();
    expect(harness.hook().projects).toHaveLength(1);
    harness.environment.liveOwners.delete("workspace-b");
    harness.rerender();
    await waitForReact(() => expect(harness.hook().projects).toHaveLength(0));
    harness.unmount();
  });

  it("treats active workspace trust changes as authoritative and reacquires after a grant", async () => {
    const harness = renderAgentProjects();
    await waitForReact(() => {
      expect(harness.hook().projects[0]?.leaseToken).not.toBeNull();
    });
    const firstLeaseToken = harness.hook().projects[0]?.leaseToken;

    harness.environment.activeWorkspaceTrust = { rootPath: ACTIVE_ROOT, trusted: false };
    harness.rerender();

    await waitForReact(() => {
      expect(harness.hook().projects[0]?.trust).toBe("untrusted");
      expect(harness.hook().projects[0]?.leaseToken).toBeNull();
    });
    expect(harness.lease.releaseAgentRootLease).toHaveBeenCalledWith({
      rootPath: ACTIVE_ROOT,
      leaseToken: firstLeaseToken,
    });

    const settingsLoadsBeforeGrant = harness.settings.loadWorkspaceSettings.mock.calls.length;
    harness.environment.activeWorkspaceTrust = { rootPath: ACTIVE_ROOT, trusted: true };
    harness.rerender();

    await waitForReact(() => {
      expect(harness.hook().projects[0]?.trust).toBe("trusted");
      expect(harness.hook().projects[0]?.leaseToken).not.toBeNull();
      expect(harness.hook().projects[0]?.leaseToken).not.toBe(firstLeaseToken);
      expect(harness.settings.loadWorkspaceSettings.mock.calls.length).toBeGreaterThan(
        settingsLoadsBeforeGrant,
      );
    });
    harness.unmount();
  });

  it("does not let late trust lookup overwrite active A to B to A authority", async () => {
    const harness = renderAgentProjects({ tabs: [BACKGROUND_ROOT], deferTrust: true });
    await waitForReact(() => expect(harness.environment.pendingTrust.size).toBe(2));
    const staleActiveTrust = harness.environment.pendingTrust.get(ACTIVE_ROOT);
    expect(staleActiveTrust).toBeDefined();

    harness.environment.activeWorkspaceId = "workspace-background";
    harness.environment.activeWorkspaceRoot = BACKGROUND_ROOT;
    harness.environment.activeWorkspaceTrust = { rootPath: BACKGROUND_ROOT, trusted: false };
    harness.rerender();
    harness.environment.activeWorkspaceId = ACTIVE_ID;
    harness.environment.activeWorkspaceRoot = ACTIVE_ROOT;
    harness.environment.activeWorkspaceTrust = { rootPath: ACTIVE_ROOT, trusted: true };
    harness.rerender();

    await act(async () => {
      staleActiveTrust?.resolve({ rootPath: ACTIVE_ROOT, trusted: false });
    });

    await waitForReact(() => {
      const active = harness.hook().projects.find((candidate) => candidate.rootKey === ACTIVE_ROOT);
      expect(active?.trust).toBe("trusted");
    });
    harness.unmount();
  });

  it("auto-releases a closed tab without live tasks and bumps the generation on re-add", async () => {
    const harness = renderAgentProjects({ tabs: [BACKGROUND_ROOT] });
    await waitForReact(() => {
      const project = harness
        .hook()
        .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
      expect(project?.leaseToken).not.toBeNull();
    });
    const ownerId =
      harness.hook().projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT)?.ownerId ??
      "";
    const leaseToken =
      harness.hook().projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT)
        ?.leaseToken ?? -1;

    harness.environment.tabs = [];
    harness.rerender();
    await waitForReact(() => expect(harness.hook().projects).toHaveLength(1));
    expect(harness.lease.releaseAgentRootLease).toHaveBeenCalledWith({
      rootPath: BACKGROUND_ROOT,
      leaseToken,
    });
    expect(harness.releaseProjectTasks).toHaveBeenCalledWith(ownerId);

    harness.environment.tabs = [BACKGROUND_ROOT];
    harness.rerender();
    await waitForReact(() => {
      const readded = harness
        .hook()
        .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
      expect(readded?.generation).toBe(2);
    });
    const readded = harness
      .hook()
      .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
    expect(readded?.ownerId).toBe(ownerId);
    harness.unmount();
  });

  it("retains a closed tab with live tasks and auto-releases it once drained", async () => {
    const harness = renderAgentProjects({ tabs: [BACKGROUND_ROOT] });
    await waitForReact(() => {
      const project = harness
        .hook()
        .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
      expect(project?.leaseToken).not.toBeNull();
    });
    const ownerId =
      harness.hook().projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT)?.ownerId ??
      "";
    const leaseToken =
      harness.hook().projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT)
        ?.leaseToken ?? -1;
    harness.environment.liveOwners.add(ownerId);

    harness.environment.tabs = [];
    harness.rerender();
    await waitForReact(() => {
      const project = harness
        .hook()
        .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
      expect(project?.origin).toBe("closed-tab-live-tasks");
    });
    expect(harness.lease.releaseAgentRootLease).not.toHaveBeenCalled();

    harness.environment.liveOwners.delete(ownerId);
    harness.rerender();
    await waitForReact(() =>
      expect(
        harness.hook().projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT),
      ).toBeUndefined(),
    );
    expect(harness.lease.releaseAgentRootLease).toHaveBeenCalledWith({
      rootPath: BACKGROUND_ROOT,
      leaseToken,
    });
    harness.unmount();
  });

  it("releases a project by stopping its tasks before dropping state and lease", async () => {
    const harness = renderAgentProjects({ tabs: [BACKGROUND_ROOT] });
    await waitForReact(() => {
      const project = harness
        .hook()
        .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
      expect(project?.leaseToken).not.toBeNull();
    });
    const project = harness
      .hook()
      .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
    expect(project).toBeDefined();
    const leaseToken = project?.leaseToken ?? -1;
    harness.environment.tabs = [];

    await act(async () => {
      await harness.hook().releaseProject(BACKGROUND_ROOT);
    });

    expect(harness.stopProjectTasks).toHaveBeenCalledWith(project?.ownerId, [BACKGROUND_ROOT]);
    expect(harness.releaseProjectTasks).toHaveBeenCalledWith(project?.ownerId);
    expect(harness.lease.releaseAgentRootLease).toHaveBeenCalledWith({
      rootPath: BACKGROUND_ROOT,
      leaseToken,
    });
    expect(
      harness.hook().projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT),
    ).toBeUndefined();
    expect(harness.calls.indexOf("stopProjectTasks")).toBeLessThan(
      harness.calls.indexOf("releaseAgentRootLease"),
    );
    harness.unmount();
  });

  it("drains exact workspace tasks and awaits its lease before removing the project", async () => {
    const harness = renderAgentProjects();
    await waitForReact(() => expect(harness.hook().projects[0]?.leaseToken).not.toBeNull());
    const closeWorkspaceProject = harness.hook().closeWorkspaceProject;
    if (!closeWorkspaceProject) throw new Error("Exact workspace close is unavailable");

    let result: Awaited<ReturnType<typeof closeWorkspaceProject>> | undefined;
    await act(async () => {
      result = await closeWorkspaceProject(descriptorFor(ACTIVE_ROOT, ACTIVE_ID), () => true);
    });

    expect(result?.status).toBe("closed");
    if (result?.status !== "closed") throw new Error("Exact workspace close did not drain");
    const settlement = result.settlement;
    await act(async () => {
      await settlement.complete("backend-closed");
      settlement.finalizeBackendClosed();
    });
    expect(harness.calls).toEqual([
      "acquireAgentRootLease",
      "stopProjectTasks",
      "releaseProjectTasks",
      "releaseAgentRootLease",
    ]);
    expect(harness.hook().launchIdentityForProject(ACTIVE_ROOT)).toBeNull();
    await waitForReact(() => expect(harness.hook().projects).toHaveLength(0));
    harness.unmount();
  });

  it("does not release the exact lease when task drain is incomplete", async () => {
    const harness = renderAgentProjects();
    await waitForReact(() => expect(harness.hook().projects[0]?.leaseToken).not.toBeNull());
    harness.stopProjectTasks.mockRejectedValueOnce(new Error("task still running"));
    const closeWorkspaceProject = harness.hook().closeWorkspaceProject;
    if (!closeWorkspaceProject) throw new Error("Exact workspace close is unavailable");

    const result = await closeWorkspaceProject(descriptorFor(ACTIVE_ROOT, ACTIVE_ID), () => true);

    expect(result).toEqual({ status: "task-stop-incomplete" });
    expect(harness.lease.releaseAgentRootLease).not.toHaveBeenCalled();
    expect(harness.hook().projects).toHaveLength(1);
    harness.unmount();
  });

  it("fails closed when exact authority changes while task drain is pending", async () => {
    const harness = renderAgentProjects();
    await waitForReact(() => expect(harness.hook().projects[0]?.leaseToken).not.toBeNull());
    const stopped = createDeferred<void>();
    harness.stopProjectTasks.mockImplementationOnce(() => stopped.promise);
    const closeWorkspaceProject = harness.hook().closeWorkspaceProject;
    if (!closeWorkspaceProject) throw new Error("Exact workspace close is unavailable");
    let current = true;
    const closing = closeWorkspaceProject(descriptorFor(ACTIVE_ROOT, ACTIVE_ID), () => current);

    current = false;
    stopped.resolve();
    const result = await closing;

    expect(result).toEqual({ status: "stale" });
    expect(harness.releaseProjectTasks).not.toHaveBeenCalled();
    expect(harness.lease.releaseAgentRootLease).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("keeps an uncertain released lease quarantined and permits an exact retry", async () => {
    const harness = renderAgentProjects();
    await waitForReact(() => expect(harness.hook().projects[0]?.leaseToken).not.toBeNull());
    harness.lease.releaseAgentRootLease.mockRejectedValueOnce(new Error("uncertain release"));
    const closeWorkspaceProject = harness.hook().closeWorkspaceProject;
    if (!closeWorkspaceProject) throw new Error("Exact workspace close is unavailable");
    const exact = descriptorFor(ACTIVE_ROOT, ACTIVE_ID);

    const first = await closeWorkspaceProject(exact, () => true);

    expect(first).toEqual({ status: "lease-release-incomplete" });
    expect(harness.hook().launchIdentityForProject(ACTIVE_ROOT)).toBeNull();
    expect(await harness.hook().ensureProjectLease(ACTIVE_ROOT)).toBe(false);

    const retry = await closeWorkspaceProject(exact, () => true);
    expect(retry.status).toBe("closed");
    if (retry.status !== "closed") throw new Error("Exact workspace retry did not drain");
    await act(async () => {
      await retry.settlement.complete("backend-closed");
      retry.settlement.finalizeBackendClosed();
    });
    expect(harness.lease.releaseAgentRootLease).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it.each([
    { kind: "notHeld", echoedToken: "exact" },
    { kind: "foreignOwner", echoedToken: "exact" },
    { kind: "released", echoedToken: "mismatched" },
  ] as const)(
    "keeps the exact lease quarantined for $kind with an $echoedToken token echo",
    async ({ kind, echoedToken }) => {
      const harness = renderAgentProjects();
      await waitForReact(() => expect(harness.hook().projects[0]?.leaseToken).not.toBeNull());
      const leaseToken = harness.hook().projects[0]?.leaseToken;
      if (leaseToken === null || leaseToken === undefined) throw new Error("Lease unavailable");
      harness.lease.releaseAgentRootLease.mockResolvedValueOnce({
        kind,
        leaseToken: echoedToken === "exact" ? leaseToken : leaseToken + 1,
      });
      const closeWorkspaceProject = harness.hook().closeWorkspaceProject;
      if (!closeWorkspaceProject) throw new Error("Exact workspace close is unavailable");

      const result = await closeWorkspaceProject(descriptorFor(ACTIVE_ROOT, ACTIVE_ID), () => true);

      expect(result).toEqual({ status: "lease-release-incomplete" });
      expect(harness.hook().projects[0]?.leaseToken).toBe(leaseToken);
      expect(harness.hook().launchIdentityForProject(ACTIVE_ROOT)).toBeNull();
      expect(await harness.hook().ensureProjectLease(ACTIVE_ROOT)).toBe(false);
      expect(harness.lease.acquireAgentRootLease).toHaveBeenCalledTimes(1);
      expect(harness.reportError).toHaveBeenCalledOnce();
      harness.unmount();
    },
  );

  it("quarantines a non-released trust cleanup and blocks same-root reacquisition", async () => {
    const harness = renderAgentProjects();
    await waitForReact(() => expect(harness.hook().projects[0]?.leaseToken).not.toBeNull());
    const leaseToken = harness.hook().projects[0]?.leaseToken;
    if (leaseToken === null || leaseToken === undefined) throw new Error("Lease unavailable");
    harness.lease.releaseAgentRootLease.mockResolvedValueOnce({
      kind: "foreignOwner",
      leaseToken,
    });

    harness.environment.activeWorkspaceTrust = { rootPath: ACTIVE_ROOT, trusted: false };
    harness.rerender();

    await waitForReact(() => expect(harness.reportError).toHaveBeenCalledOnce());
    expect(harness.lease.releaseAgentRootLease).toHaveBeenCalledWith({
      rootPath: ACTIVE_ROOT,
      leaseToken,
    });
    expect(harness.hook().projects[0]?.leaseToken).toBeNull();

    harness.environment.activeWorkspaceTrust = { rootPath: ACTIVE_ROOT, trusted: true };
    harness.rerender();
    await waitForReact(() => expect(harness.hook().projects[0]?.trust).toBe("trusted"));

    expect(await harness.hook().ensureProjectLease(ACTIVE_ROOT)).toBe(false);
    expect(harness.lease.acquireAgentRootLease).toHaveBeenCalledTimes(1);
    expect(harness.hook().projects[0]?.leaseToken).toBeNull();
    harness.unmount();
  });

  it("quarantines A2 until A1 lease release settles and then acquires a fresh lease", async () => {
    const harness = renderAgentProjects();
    await waitForReact(() => expect(harness.hook().projects[0]?.leaseToken).not.toBeNull());
    const released = createDeferred<AgentRootLeaseReleaseResult>();
    harness.lease.releaseAgentRootLease.mockImplementationOnce(() => released.promise);
    const closeWorkspaceProject = harness.hook().closeWorkspaceProject;
    if (!closeWorkspaceProject) throw new Error("Exact workspace close is unavailable");
    const closing = closeWorkspaceProject(descriptorFor(ACTIVE_ROOT, ACTIVE_ID), () => true);
    await waitForReact(() => expect(harness.lease.releaseAgentRootLease).toHaveBeenCalledOnce());

    harness.environment.activeWorkspaceId = "workspace-a2";
    harness.rerender();
    expect(harness.hook().launchIdentityForProject(ACTIVE_ROOT)).toBeNull();
    const leaseToken = harness.hook().projects[0]?.leaseToken;
    if (leaseToken === null || leaseToken === undefined) throw new Error("Lease unavailable");
    released.resolve({ kind: "released", leaseToken });
    const result = await closing;
    expect(result.status).toBe("closed");
    if (result.status !== "closed") throw new Error("A1 lease release did not settle");
    await act(async () => {
      await result.settlement.complete("backend-closed");
      result.settlement.finalizeBackendClosed();
    });

    await waitForReact(() =>
      expect(harness.hook().launchIdentityForProject(ACTIVE_ROOT)?.workspaceId).toBe(
        "workspace-a2",
      ),
    );
    expect(harness.lease.acquireAgentRootLease).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it("keeps a releasing project with live tasks until its owner drains", async () => {
    const harness = renderAgentProjects({ tabs: [BACKGROUND_ROOT] });
    await waitForReact(() => {
      const project = harness
        .hook()
        .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
      expect(project?.leaseToken).not.toBeNull();
    });
    const ownerId =
      harness.hook().projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT)?.ownerId ??
      "";
    const leaseToken =
      harness.hook().projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT)
        ?.leaseToken ?? -1;
    harness.environment.liveOwners.add(ownerId);
    harness.environment.tabs = [];

    await act(async () => {
      await harness.hook().releaseProject(BACKGROUND_ROOT);
    });

    const releasing = harness
      .hook()
      .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
    expect(releasing?.origin).toBe("closed-tab-live-tasks");
    expect(harness.lease.releaseAgentRootLease).not.toHaveBeenCalled();

    harness.environment.liveOwners.delete(ownerId);
    harness.rerender();
    await waitForReact(() =>
      expect(
        harness.hook().projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT),
      ).toBeUndefined(),
    );
    expect(harness.lease.releaseAgentRootLease).toHaveBeenCalledWith({
      rootPath: BACKGROUND_ROOT,
      leaseToken,
    });
    harness.unmount();
  });

  it("ignores a late load result for a released and re-added generation", async () => {
    const harness = renderAgentProjects({ tabs: [BACKGROUND_ROOT], deferTrust: true });
    await waitForReact(() => expect(harness.environment.pendingTrust.size).toBe(2));
    const stale = harness.environment.pendingTrust.get(BACKGROUND_ROOT);
    expect(stale).toBeDefined();
    harness.environment.pendingTrust.delete(BACKGROUND_ROOT);

    harness.environment.tabs = [];
    harness.rerender();
    await waitForReact(() =>
      expect(
        harness.hook().projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT),
      ).toBeUndefined(),
    );
    harness.environment.tabs = [BACKGROUND_ROOT];
    harness.rerender();
    await waitForReact(() => {
      const readded = harness
        .hook()
        .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
      expect(readded?.generation).toBe(2);
    });

    await act(async () => {
      stale?.resolve({ rootPath: BACKGROUND_ROOT, trusted: false });
    });

    const readded = harness
      .hook()
      .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
    expect(readded?.trust).not.toBe("untrusted");
    harness.unmount();
  });
});

describe("useAgentProjects trust actions", () => {
  it("promotes active controller trust when trust is granted from the project menu", async () => {
    const harness = renderAgentProjects();
    harness.environment.activeWorkspaceTrust = { rootPath: ACTIVE_ROOT, trusted: false };
    harness.environment.trustedByRoot.set(ACTIVE_ROOT, false);
    harness.rerender();
    await waitForReact(() => expect(harness.hook().projects[0]?.trust).toBe("untrusted"));

    await act(async () => {
      await harness.hook().trustProject(ACTIVE_ROOT);
    });
    harness.rerender();

    await waitForReact(() => {
      expect(harness.hook().projects[0]?.trust).toBe("trusted");
      expect(harness.hook().projects[0]?.leaseToken).not.toBeNull();
    });
    expect(harness.activeTrustChanges).toContainEqual({
      ownerId: ACTIVE_ID,
      rootPath: ACTIVE_ROOT,
      trusted: true,
    });
    harness.unmount();
  });

  it("grants trust only after an explicit confirmation and then refreshes the root", async () => {
    const harness = renderAgentProjects({ tabs: [BACKGROUND_ROOT], confirmResult: false });
    harness.environment.trustedByRoot.set(BACKGROUND_ROOT, false);
    await waitForReact(() => {
      const project = harness
        .hook()
        .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
      expect(project?.trust).toBe("untrusted");
    });

    await act(async () => {
      await harness.hook().trustProject(BACKGROUND_ROOT);
    });
    expect(harness.trust.setTrust).not.toHaveBeenCalled();

    harness.environment.confirmResult = true;
    await act(async () => {
      await harness.hook().trustProject(BACKGROUND_ROOT);
    });

    expect(harness.confirm.mock.calls[0]?.[0]).toContain(BACKGROUND_ROOT);
    expect(harness.trust.setTrust).toHaveBeenCalledWith(BACKGROUND_ROOT, true);
    await waitForReact(() => {
      const project = harness
        .hook()
        .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
      expect(project?.trust).toBe("trusted");
      expect(project?.leaseToken).not.toBeNull();
    });
    harness.unmount();
  });

  it("drops a confirmed trust request after same-root owner replacement", async () => {
    const confirmation = createDeferred<boolean>();
    const harness = renderAgentProjects({ tabs: [BACKGROUND_ROOT] });
    harness.environment.trustedByRoot.set(BACKGROUND_ROOT, false);
    await waitForReact(() => {
      expect(
        harness.hook().projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT)?.trust,
      ).toBe("untrusted");
    });
    harness.confirm.mockImplementationOnce(() => confirmation.promise as never);

    let pending!: Promise<void>;
    act(() => {
      pending = harness.hook().trustProject(BACKGROUND_ROOT);
    });
    harness.environment.tabs = [];
    harness.rerender();
    await waitForReact(() => {
      expect(
        harness.hook().projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT),
      ).toBeUndefined();
    });
    harness.environment.tabs = [BACKGROUND_ROOT];
    harness.rerender();
    await waitForReact(() => {
      expect(
        harness.hook().projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT)
          ?.generation,
      ).toBe(2);
    });

    await act(async () => {
      confirmation.resolve(true);
      await pending;
    });

    expect(harness.trust.setTrust).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("drops a confirmed trust request after same-generation owner promotion", async () => {
    const confirmation = createDeferred<boolean>();
    const harness = renderAgentProjects({ activeWorkspaceId: null });
    harness.environment.activeWorkspaceTrust = { rootPath: ACTIVE_ROOT, trusted: false };
    harness.environment.trustedByRoot.set(ACTIVE_ROOT, false);
    harness.rerender();
    await waitForReact(() => expect(harness.hook().projects[0]?.trust).toBe("untrusted"));
    const generation = harness.hook().projects[0]?.generation;
    const initialOwnerId = harness.hook().projects[0]?.ownerId;
    harness.confirm.mockImplementationOnce(() => confirmation.promise as never);

    let pending!: Promise<void>;
    act(() => {
      pending = harness.hook().trustProject(ACTIVE_ROOT);
    });
    harness.environment.activeWorkspaceId = ACTIVE_ID;
    harness.rerender();
    await waitForReact(() => {
      expect(harness.hook().projects[0]?.generation).toBe(generation);
      expect(harness.hook().projects[0]?.ownerId).not.toBe(initialOwnerId);
    });

    await act(async () => {
      confirmation.resolve(true);
      await pending;
    });

    expect(harness.trust.setTrust).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("does not report a stale trust failure after same-root owner replacement", async () => {
    let rejectTrust!: (error: Error) => void;
    const trustFailure = new Promise<WorkspaceTrustState>((_resolve, reject) => {
      rejectTrust = reject;
    });
    const harness = renderAgentProjects({ tabs: [BACKGROUND_ROOT] });
    harness.environment.trustedByRoot.set(BACKGROUND_ROOT, false);
    await waitForReact(() => {
      expect(
        harness.hook().projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT)?.trust,
      ).toBe("untrusted");
    });
    harness.trust.setTrust.mockImplementationOnce(() => trustFailure);

    let pending!: Promise<void>;
    act(() => {
      pending = harness.hook().trustProject(BACKGROUND_ROOT);
    });
    await waitForReact(() => expect(harness.trust.setTrust).toHaveBeenCalledOnce());
    harness.environment.tabs = [];
    harness.rerender();
    await waitForReact(() => {
      expect(
        harness.hook().projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT),
      ).toBeUndefined();
    });
    harness.environment.tabs = [BACKGROUND_ROOT];
    harness.rerender();
    await waitForReact(() => {
      expect(
        harness.hook().projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT)
          ?.generation,
      ).toBe(2);
    });

    await act(async () => {
      rejectTrust(new Error("trust failed"));
      await pending;
    });

    expect(harness.reportError).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("downgrades a project to untrusted after a dispatch trust rejection", async () => {
    const harness = renderAgentProjects({ tabs: [BACKGROUND_ROOT] });
    await waitForReact(() => {
      const project = harness
        .hook()
        .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
      expect(project?.trust).toBe("trusted");
    });

    act(() => harness.hook().noteDispatchTrustRejected(BACKGROUND_ROOT));

    const project = harness
      .hook()
      .projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT);
    expect(project?.trust).toBe("untrusted");
    harness.unmount();
  });

  it("downgrades active controller trust after a dispatch trust rejection", async () => {
    const harness = renderAgentProjects();
    harness.environment.activeWorkspaceTrust = { rootPath: ACTIVE_ROOT, trusted: true };
    harness.rerender();
    await waitForReact(() => expect(harness.hook().projects[0]?.trust).toBe("trusted"));
    const leaseToken = harness.hook().projects[0]?.leaseToken;
    const trustCallsBeforeRejection = harness.trust.getTrust.mock.calls.length;

    act(() => harness.hook().noteDispatchTrustRejected(ACTIVE_ROOT));

    await waitForReact(() => expect(harness.hook().projects[0]?.trust).toBe("untrusted"));
    expect(harness.activeTrustChanges).toEqual([
      { ownerId: ACTIVE_ID, rootPath: ACTIVE_ROOT, trusted: false },
    ]);
    expect(harness.lease.releaseAgentRootLease).toHaveBeenCalledWith({
      rootPath: ACTIVE_ROOT,
      leaseToken,
    });
    expect(harness.trust.getTrust).toHaveBeenCalledTimes(trustCallsBeforeRejection);
    harness.unmount();
  });

  it("downgrades controller trust when a frozen background owner becomes active", async () => {
    const harness = renderAgentProjects({ tabs: [BACKGROUND_ROOT] });
    await waitForReact(() => {
      expect(
        harness.hook().projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT)?.trust,
      ).toBe("trusted");
    });
    harness.environment.activeWorkspaceId = "workspace-background";
    harness.environment.activeWorkspaceRoot = BACKGROUND_ROOT;
    harness.environment.activeWorkspaceTrust = { rootPath: BACKGROUND_ROOT, trusted: true };
    harness.rerender();

    act(() => harness.hook().noteDispatchTrustRejected(BACKGROUND_ROOT));

    await waitForReact(() => {
      expect(
        harness.hook().projects.find((candidate) => candidate.rootKey === BACKGROUND_ROOT)?.trust,
      ).toBe("untrusted");
    });
    expect(harness.activeTrustChanges).toEqual([
      { ownerId: "workspace-background", rootPath: BACKGROUND_ROOT, trusted: false },
    ]);
    harness.unmount();
  });
});

interface Environment {
  enabled: boolean;
  activeWorkspaceId: string | null;
  activeWorkspaceRoot: string | null;
  activeWorkspaceTrust: WorkspaceTrustState | null;
  tabs: ReadonlyArray<string>;
  confirmResult: boolean;
  deferTrust: boolean;
  deferLease: boolean;
  liveOwners: Set<string>;
  trustedByRoot: Map<string, boolean>;
  descriptorsByRoot: Map<string, WorkspaceIdentityDescriptor>;
  workspaceSettingsByRoot: Map<string, WorkspaceSettings>;
  detectedByRoot: Map<string, string[]>;
  pendingTrust: Map<string, ReturnType<typeof createDeferred<WorkspaceTrustState>>>;
  pendingLease: ReturnType<typeof createDeferred<AgentRootLeaseReceipt>> | null;
  concurrentTrustCalls: number;
  maxConcurrentTrustCalls: number;
}

interface HarnessOptions {
  enabled?: boolean;
  activeWorkspaceId?: string | null;
  tabs?: ReadonlyArray<string>;
  confirmResult?: boolean;
  deferTrust?: boolean;
  deferLease?: boolean;
  descriptors?: ReadonlyArray<[string, WorkspaceIdentityDescriptor]>;
}

function renderAgentProjects(options: HarnessOptions = {}) {
  const environment: Environment = {
    enabled: options.enabled ?? true,
    activeWorkspaceId:
      options.activeWorkspaceId === undefined ? ACTIVE_ID : options.activeWorkspaceId,
    activeWorkspaceRoot: ACTIVE_ROOT,
    activeWorkspaceTrust: null,
    tabs: options.tabs ?? [],
    confirmResult: options.confirmResult ?? true,
    deferTrust: options.deferTrust ?? false,
    deferLease: options.deferLease ?? false,
    liveOwners: new Set<string>(),
    trustedByRoot: new Map<string, boolean>(),
    descriptorsByRoot: new Map<string, WorkspaceIdentityDescriptor>(options.descriptors ?? []),
    workspaceSettingsByRoot: new Map<string, WorkspaceSettings>(),
    detectedByRoot: new Map<string, string[]>(),
    pendingTrust: new Map(),
    pendingLease: null,
    concurrentTrustCalls: 0,
    maxConcurrentTrustCalls: 0,
  };

  const calls: string[] = [];
  const activeTrustChanges: Array<{ ownerId: string; rootPath: string; trusted: boolean }> = [];
  const appSettings: AppSettings = defaultAppSettings();
  const appSettingsRef = {
    get current(): AppSettings {
      return { ...appSettings, workspaceTabs: [...environment.tabs] };
    },
  };

  const trust = {
    getTrust: vi.fn(async (rootPath: string): Promise<WorkspaceTrustState> => {
      environment.concurrentTrustCalls += 1;
      environment.maxConcurrentTrustCalls = Math.max(
        environment.maxConcurrentTrustCalls,
        environment.concurrentTrustCalls,
      );
      try {
        if (environment.deferTrust) {
          const deferred = createDeferred<WorkspaceTrustState>();
          environment.pendingTrust.set(rootPath, deferred);
          const state = await deferred.promise;
          return { ...state, rootPath };
        }
        return { rootPath, trusted: environment.trustedByRoot.get(rootPath) ?? true };
      } finally {
        environment.concurrentTrustCalls -= 1;
      }
    }),
    setTrust: vi.fn(async (rootPath: string, trusted: boolean): Promise<WorkspaceTrustState> => {
      environment.trustedByRoot.set(rootPath, trusted);
      return { rootPath, trusted };
    }),
  };

  const settings = {
    loadWorkspaceSettings: vi.fn(
      async (identity: string | WorkspaceSettingsIdentity): Promise<WorkspaceSettings> => {
        const key = typeof identity === "string" ? identity : (identity.legacyRawKeys?.[1] ?? "");
        return environment.workspaceSettingsByRoot.get(key) ?? defaultWorkspaceSettings();
      },
    ),
  };

  const discovery = {
    detectRepositories: vi.fn(
      async (rootPath: string): Promise<string[]> =>
        environment.detectedByRoot.get(rootPath) ?? [""],
    ),
  };

  let nextLeaseToken = 0;
  const lease = {
    acquireAgentRootLease: vi.fn(
      async (_request: { rootPath: string }): Promise<AgentRootLeaseReceipt> => {
        calls.push("acquireAgentRootLease");
        if (environment.deferLease) {
          const deferred = createDeferred<AgentRootLeaseReceipt>();
          environment.pendingLease = deferred;
          return deferred.promise;
        }
        nextLeaseToken += 1;
        return { leaseToken: nextLeaseToken };
      },
    ),
    releaseAgentRootLease: vi.fn(
      async (request: { readonly leaseToken: number }): Promise<AgentRootLeaseReleaseResult> => {
        calls.push("releaseAgentRootLease");
        return { kind: "released", leaseToken: request.leaseToken };
      },
    ),
  };

  const confirm = vi.fn((_message: string) => environment.confirmResult);
  const reportError = vi.fn();
  const stopProjectTasks = vi.fn(async (): Promise<void> => {
    calls.push("stopProjectTasks");
  });
  const releaseProjectTasks = vi.fn((): void => {
    calls.push("releaseProjectTasks");
  });

  const dependencies: AgentProjectsDependencies = {
    get enabled() {
      return environment.enabled;
    },
    appSettingsRef,
    get activeWorkspaceId() {
      return environment.activeWorkspaceId;
    },
    get activeWorkspaceRoot() {
      return environment.activeWorkspaceRoot;
    },
    get activeWorkspaceTrust() {
      return environment.activeWorkspaceTrust;
    },
    activeWorkspaceRepositories: [activeRepository()],
    activeIsolationPolicy: "auto",
    descriptorForRoot: (rootPath: string) => environment.descriptorsByRoot.get(rootPath) ?? null,
    settingsGateway: settings,
    trustGateway: trust,
    repositoryDiscoveryGateway: discovery,
    agentRootLeaseGateway: lease,
    hasLiveTasksForOwner: (ownerId: string) => environment.liveOwners.has(ownerId),
    stopProjectTasks,
    releaseProjectTasks,
    onActiveWorkspaceTrustChanged: (rootPath: string, ownerId: string, trusted: boolean) => {
      activeTrustChanges.push({ ownerId, rootPath, trusted });
      environment.activeWorkspaceTrust = { rootPath, trusted };
    },
    prompter: { confirm, prompt: () => null },
    reportError,
  };

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let current: AgentProjectsSurface | null = null;

  function Harness() {
    current = useAgentProjects(dependencies);
    return null;
  }

  act(() => root.render(createElement(Harness)));

  return {
    calls,
    activeTrustChanges,
    confirm,
    discovery,
    environment,
    lease,
    releaseProjectTasks,
    reportError,
    settings,
    stopProjectTasks,
    trust,
    hook(): AgentProjectsSurface {
      expect(current).not.toBeNull();
      return current as AgentProjectsSurface;
    },
    rerender() {
      act(() => root.render(createElement(Harness)));
    },
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}
