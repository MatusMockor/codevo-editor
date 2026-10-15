// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  type WorkspaceSettings,
} from "../../domain/settings";
import type { WorkspaceTrustState } from "../../domain/trust";
import {
  agentDescriptor,
  agentIdentityGateway,
  agentRuntimeLifecycleGateway,
  agentScriptsReader,
  agentSettingsGateway,
  agentTrustGateway,
  deferred,
  flushAgentTurns,
  renderAgentWorkspaceHarness,
  unmountAgentWorkspaceHarnesses,
} from "../../test/agentAppWorkspaceHarness";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";

const WORKSPACE_A = "/workspace-a";
const WORKSPACE_B = "/workspace-b";

afterEach(() => {
  unmountAgentWorkspaceHarnesses();
});

async function open(harness: ReturnType<typeof renderAgentWorkspaceHarness>, path: string) {
  let opened = false;
  await act(async () => {
    opened = await harness.current().transition.openWorkspaceRoot(path);
  });
  await flushAgentTurns();
  return opened;
}

async function startOpen(harness: ReturnType<typeof renderAgentWorkspaceHarness>, path: string) {
  let opening: Promise<boolean> = Promise.resolve(false);
  act(() => {
    opening = harness.current().transition.openWorkspaceRoot(path);
  });
  await flushAgentTurns();
  return { opening };
}

function settingsWith(overrides: Partial<WorkspaceSettings>): WorkspaceSettings {
  return { ...defaultWorkspaceSettings(), ...overrides };
}

describe("useAgentWorkspaceTransition open and switch", () => {
  it("publishes the admitted root, identity, owner key, trust and scripts workspace", async () => {
    const harness = renderAgentWorkspaceHarness({
      scriptsReader: agentScriptsReader({
        [WORKSPACE_A]: [
          { kind: "file", name: "package.json", path: `${WORKSPACE_A}/package.json` },
        ],
      }),
    });
    await flushAgentTurns();

    expect(await open(harness, WORKSPACE_A)).toBe(true);

    const { appSettings, transition } = harness.current();
    expect(transition.workspaceRoot).toBe(WORKSPACE_A);
    expect(transition.workspaceIdentityDescriptor).toMatchObject({
      workspaceId: "workspace-a",
      admissionToken: 1,
    });
    expect(transition.workspaceOwnerKey).toContain("workspace-a");
    expect(transition.workspaceTrust).toEqual({ rootPath: WORKSPACE_A, trusted: true });
    expect(transition.scriptsWorkspace).toBe("javaScriptTypeScript");
    expect(appSettings.workspaceTabs).toEqual([WORKSPACE_A]);
    expect(appSettings.recentWorkspacePath).toBe(WORKSPACE_A);
    expect(harness.git.reset).toHaveBeenCalledWith(WORKSPACE_A);
    expect(harness.errors).toEqual([]);
  });

  it("opens a workspace root after a StrictMode mount replay", async () => {
    const unregister = vi.fn(async () => ({ status: "released" as const }));
    const harness = renderAgentWorkspaceHarness({
      identityGateway: agentIdentityGateway({
        openPath: vi.fn(async (path: string) => agentDescriptor("ws-strict", path)),
        unregister,
      }),
      strictMode: true,
    });
    await flushAgentTurns();

    expect(await open(harness, "/selected/strict")).toBe(true);
    expect(harness.current().transition.workspaceRoot).toBe("/selected/strict");
    expect(unregister).not.toHaveBeenCalled();
  });

  it("never publishes late trust or scripts results from the first A generation after A to B to A", async () => {
    const trustByCall: Array<ReturnType<typeof deferred<WorkspaceTrustState>>> = [];
    const trustGateway = agentTrustGateway({
      getTrust: vi.fn(() => {
        const pending = deferred<WorkspaceTrustState>();
        trustByCall.push(pending);
        return pending.promise;
      }),
    });
    const listings: Array<ReturnType<typeof deferred<{ entries: never[]; truncated: boolean }>>> =
      [];
    const scriptsReader = {
      readDirectoryBounded: vi.fn(() => {
        const pending = deferred<{ entries: never[]; truncated: boolean }>();
        listings.push(pending);
        return pending.promise;
      }),
    };
    const harness = renderAgentWorkspaceHarness({ scriptsReader, trustGateway });
    await flushAgentTurns();

    const { opening: openingA1 } = await startOpen(harness, WORKSPACE_A);
    const { opening: openingB } = await startOpen(harness, WORKSPACE_B);
    const { opening: openingA2 } = await startOpen(harness, WORKSPACE_A);
    expect(trustByCall).toHaveLength(3);
    const firstA = harness.current().transition.workspaceIdentityDescriptor;
    expect(firstA?.admissionToken).toBe(3);

    await act(async () => {
      trustByCall[0]!.resolve({ rootPath: WORKSPACE_A, trusted: false });
      listings[0]!.resolve({ entries: [], truncated: true });
      trustByCall[1]!.resolve({ rootPath: WORKSPACE_B, trusted: false });
    });
    await flushAgentTurns();
    expect(harness.current().transition.workspaceTrust).toBeNull();
    expect(harness.current().transition.scriptsWorkspace).toBeNull();

    await act(async () => {
      trustByCall[2]!.resolve({ rootPath: WORKSPACE_A, trusted: true });
      listings[2]!.resolve({ entries: [], truncated: false });
    });
    await flushAgentTurns();
    expect(harness.current().transition.workspaceTrust).toEqual({
      rootPath: WORKSPACE_A,
      trusted: true,
    });
    expect(harness.current().transition.scriptsWorkspace).toBe("none");
    await act(async () => {
      listings[1]!.resolve({ entries: [], truncated: false });
      await expect(Promise.all([openingA1, openingB, openingA2])).resolves.toEqual([
        false,
        false,
        true,
      ]);
    });
  });

  it("does not let a late workspace settings load overwrite the active project", async () => {
    const settingsA = deferred<WorkspaceSettings>();
    const { gateway } = agentSettingsGateway();
    gateway.loadWorkspaceSettings.mockImplementation(async (identity) => {
      const key = typeof identity === "string" ? identity : identity.canonicalKey;
      if (key === WORKSPACE_A) return settingsA.promise;
      return settingsWith({ gitDirectoryMappingsAuto: false });
    });
    const harness = renderAgentWorkspaceHarness({ settingsGateway: gateway });
    await flushAgentTurns();

    let openingA: Promise<boolean> = Promise.resolve(false);
    act(() => {
      openingA = harness.current().transition.openWorkspaceRoot(WORKSPACE_A);
    });
    await flushAgentTurns();
    expect(await open(harness, WORKSPACE_B)).toBe(true);

    await act(async () => {
      settingsA.resolve(settingsWith({ gitDirectoryMappingsAuto: true }));
      expect(await openingA).toBe(false);
    });
    await flushAgentTurns();

    expect(harness.current().transition.workspaceRoot).toBe(WORKSPACE_B);
    expect(harness.current().workspaceSettings.gitDirectoryMappingsAuto).toBe(false);
    expect(harness.current().appSettings.workspaceTabs).toEqual([WORKSPACE_B]);
  });

  it("waits for an in-flight workspace settings save before reloading the same project", async () => {
    const save = deferred<void>();
    const { gateway, saved: store } = agentSettingsGateway();
    gateway.saveWorkspaceSettings.mockImplementationOnce(async (identity, settings) => {
      await save.promise;
      store.workspaces.set(
        typeof identity === "string" ? identity : identity.canonicalKey,
        settings,
      );
    });
    const harness = renderAgentWorkspaceHarness({ settingsGateway: gateway });
    await flushAgentTurns();
    await open(harness, WORKSPACE_A);
    await open(harness, WORKSPACE_B);
    const saved = settingsWith({ gitDirectoryMappingsAuto: false });
    let saving: Promise<void> = Promise.resolve();
    act(() => {
      saving = harness.current().persistWorkspaceSettings(WORKSPACE_A, saved);
    });
    gateway.loadWorkspaceSettings.mockClear();

    let reopening: Promise<boolean> = Promise.resolve(false);
    act(() => {
      reopening = harness.current().transition.openWorkspaceRoot(WORKSPACE_A);
    });
    await flushAgentTurns();
    expect(gateway.loadWorkspaceSettings).not.toHaveBeenCalled();
    expect(harness.current().transition.workspaceRoot).toBe(WORKSPACE_B);

    await act(async () => {
      save.resolve();
      await saving;
      expect(await reopening).toBe(true);
    });
    await flushAgentTurns();

    expect(gateway.loadWorkspaceSettings).toHaveBeenCalledOnce();
    expect(harness.current().transition.workspaceRoot).toBe(WORKSPACE_A);
    expect(harness.current().workspaceSettings).toEqual(saved);
  });

  it("drops a trust load whose owner revision changed during the open", async () => {
    const trust = deferred<WorkspaceTrustState>();
    const harness = renderAgentWorkspaceHarness({
      trustGateway: agentTrustGateway({ getTrust: vi.fn(() => trust.promise) }),
    });
    await flushAgentTurns();
    const { opening } = await startOpen(harness, WORKSPACE_A);
    const { authority, transition } = harness.current();
    const ownerKey = transition.workspaceIdentityDescriptor!.workspaceId;

    authority.workspaceTrustRevisionByOwnerRef.current[ownerKey] =
      (authority.workspaceTrustRevisionByOwnerRef.current[ownerKey] ?? 0) + 1;
    await act(async () => trust.resolve({ rootPath: WORKSPACE_A, trusted: true }));
    await flushAgentTurns();

    expect(harness.current().transition.workspaceTrust).toBeNull();
    expect(harness.current().transition.workspaceIdentityDescriptor).toMatchObject({
      workspaceId: "workspace-a",
      admissionToken: 1,
      canonicalRoot: WORKSPACE_A,
    });
    await act(async () => {
      await expect(opening).resolves.toBe(true);
    });
  });

  it("rolls back a superseded direct admission and never opens it later", async () => {
    const admissionA = deferred<WorkspaceIdentityDescriptor>();
    const rollbackAdmission = vi.fn(async () => ({ status: "released" as const }));
    const harness = renderAgentWorkspaceHarness({
      identityGateway: agentIdentityGateway({
        openPath: vi.fn(async (path: string) =>
          path === WORKSPACE_A ? admissionA.promise : agentDescriptor("workspace-b", path, 2),
        ),
        rollbackAdmission,
      }),
    });
    await flushAgentTurns();

    let openingA: Promise<boolean> = Promise.resolve(true);
    act(() => {
      openingA = harness.current().transition.openWorkspaceRoot(WORKSPACE_A);
    });
    expect(await open(harness, WORKSPACE_B)).toBe(true);
    await act(async () => {
      admissionA.resolve(agentDescriptor("workspace-a", WORKSPACE_A, 1));
      expect(await openingA).toBe(false);
    });
    await flushAgentTurns();

    expect(rollbackAdmission).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-a", admissionToken: 1 }),
    );
    expect(harness.current().transition.workspaceRoot).toBe(WORKSPACE_B);
    expect(harness.current().appSettings.workspaceTabs).toEqual([WORKSPACE_B]);
  });

  it("invalidates a deferred openPath admission on unmount", async () => {
    const admission = deferred<WorkspaceIdentityDescriptor>();
    const rollbackAdmission = vi.fn(async () => ({ status: "released" as const }));
    const harness = renderAgentWorkspaceHarness({
      identityGateway: agentIdentityGateway({
        openPath: vi.fn(() => admission.promise),
        rollbackAdmission,
      }),
    });
    await flushAgentTurns();
    let opening: Promise<boolean> = Promise.resolve(true);
    act(() => {
      opening = harness.current().transition.openWorkspaceRoot(WORKSPACE_A);
    });
    harness.unmount();

    admission.resolve(agentDescriptor("workspace-a", WORKSPACE_A, 1));
    await expect(opening).resolves.toBe(false);
    await vi.waitFor(() => expect(rollbackAdmission).toHaveBeenCalledOnce());
    expect(harness.settingsGateway.saveAppSettings).not.toHaveBeenCalled();
  });

  it("keeps the active workspace unchanged when the picker is cancelled", async () => {
    const harness = renderAgentWorkspaceHarness();
    await flushAgentTurns();
    await open(harness, WORKSPACE_A);

    await act(async () => harness.current().transition.openWorkspace());
    await flushAgentTurns();

    expect(harness.current().transition.workspaceRoot).toBe(WORKSPACE_A);
    expect(harness.errors).toEqual([]);
  });

  it("switches project tabs without stopping another project runtime under keepAlive", async () => {
    const runtimeLifecycleGateway = agentRuntimeLifecycleGateway();
    const harness = renderAgentWorkspaceHarness({ runtimeLifecycleGateway });
    await flushAgentTurns();
    await open(harness, WORKSPACE_A);
    await open(harness, WORKSPACE_B);
    await act(async () => harness.current().transition.activateWorkspaceTab(WORKSPACE_A));
    await flushAgentTurns();

    expect(harness.current().transition.workspaceRoot).toBe(WORKSPACE_A);
    expect(harness.current().appSettings.workspaceTabs).toEqual([WORKSPACE_A, WORKSPACE_B]);
    expect(runtimeLifecycleGateway.disposeWorkspace).not.toHaveBeenCalled();
  });

  it("stops and retires the previous owner under the suspendOnBackground policy", async () => {
    const runtimeLifecycleGateway = agentRuntimeLifecycleGateway();
    const harness = renderAgentWorkspaceHarness({
      appSettings: { ...defaultAppSettings(), runtimePolicy: "suspendOnBackground" },
      runtimeLifecycleGateway,
    });
    await flushAgentTurns();
    await open(harness, WORKSPACE_A);
    const claims = harness.current().authority.workspaceRuntimeOwnerClaimsRef.current;
    expect(claims.generationFor("workspace-a")).toBeTypeOf("number");

    await open(harness, WORKSPACE_B);

    expect(runtimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledExactlyOnceWith(WORKSPACE_A);
    expect(claims.generationFor("workspace-a")).toBeUndefined();
    expect(claims.generationFor("workspace-b")).toBeTypeOf("number");
  });

  it("ignores a stale inactive runtime dispose error after switching tabs", async () => {
    const dispose = deferred<void>();
    const runtimeLifecycleGateway = agentRuntimeLifecycleGateway({
      disposeWorkspace: vi.fn(() => dispose.promise),
    });
    const harness = renderAgentWorkspaceHarness({
      appSettings: { ...defaultAppSettings(), runtimePolicy: "suspendOnBackground" },
      runtimeLifecycleGateway,
    });
    await flushAgentTurns();
    await open(harness, WORKSPACE_A);
    let openingB: Promise<boolean> = Promise.resolve(false);
    act(() => {
      openingB = harness.current().transition.openWorkspaceRoot(WORKSPACE_B);
    });
    await flushAgentTurns();
    await act(async () => {
      dispose.reject(new Error("dispose failed"));
      await openingB;
    });
    await flushAgentTurns();

    expect(harness.current().transition.workspaceRoot).toBe(WORKSPACE_B);
    expect(harness.errors).toEqual([]);
  });

  it("never stops a reopened workspace's terminals when its stale background disposal fails", async () => {
    const disposeA = deferred<void>();
    const runtimeLifecycleGateway = agentRuntimeLifecycleGateway({
      disposeWorkspace: vi.fn(() => disposeA.promise),
    });
    const stopRoot = vi.fn(async (_rootPath: string) => undefined);
    const harness = renderAgentWorkspaceHarness({
      appSettings: { ...defaultAppSettings(), runtimePolicy: "suspendOnBackground" },
      runtimeLifecycleGateway,
      terminalGateway: { stopRoot },
    });
    await flushAgentTurns();
    await open(harness, WORKSPACE_A);
    const { opening: openingB } = await startOpen(harness, WORKSPACE_B);
    expect(runtimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(WORKSPACE_A);

    await act(async () => harness.current().transition.activateWorkspaceTab(WORKSPACE_A));
    await act(async () => {
      disposeA.reject(new Error("dispose failed"));
      await expect(openingB).resolves.toBe(false);
    });
    await flushAgentTurns();

    expect(stopRoot).not.toHaveBeenCalled();
    expect(harness.current().transition.workspaceRoot).toBe(WORKSPACE_A);
    expect(harness.errors).toEqual([]);
  });

  it("does not report a stale scripts detection error after switching tabs", async () => {
    const listingA = deferred<{ entries: never[]; truncated: boolean }>();
    const harness = renderAgentWorkspaceHarness({
      scriptsReader: {
        readDirectoryBounded: vi.fn(async (path: string) =>
          path === WORKSPACE_A ? listingA.promise : { entries: [], truncated: false },
        ),
      },
    });
    await flushAgentTurns();
    const { opening: openingA } = await startOpen(harness, WORKSPACE_A);
    await open(harness, WORKSPACE_B);
    await act(async () => {
      listingA.reject(new Error("listing failed"));
      await expect(openingA).resolves.toBe(false);
    });
    await flushAgentTurns();

    expect(harness.errors).toEqual([]);
    expect(harness.current().transition.scriptsWorkspace).toBe("none");
  });

  it("coalesces sequential same-id aliases into one selected workspace tab", async () => {
    const harness = renderAgentWorkspaceHarness({
      identityGateway: agentIdentityGateway({
        openPath: vi.fn(async (path: string) => ({
          ...agentDescriptor("workspace-a", path, path === "/alias" ? 1 : 2),
          canonicalRoot: "/real",
        })),
      }),
    });
    await flushAgentTurns();
    await open(harness, "/alias");
    await open(harness, "/real");

    expect(harness.current().appSettings.workspaceTabs).toEqual(["/real"]);
    expect(harness.current().transition.workspaceRoot).toBe("/real");
  });

  it("restores the recent workspace at startup and lets a user open retire it", async () => {
    const restore = deferred<WorkspaceIdentityDescriptor>();
    const { gateway } = agentSettingsGateway({
      ...defaultAppSettings(),
      recentWorkspacePath: WORKSPACE_A,
      workspaceTabs: [WORKSPACE_A],
    });
    const harness = renderAgentWorkspaceHarness({
      identityGateway: agentIdentityGateway({
        openPath: vi.fn(async (path: string) =>
          path === WORKSPACE_A ? restore.promise : agentDescriptor("workspace-b", path, 2),
        ),
      }),
      settingsGateway: gateway,
    });
    await flushAgentTurns();
    expect(harness.current().hydrated).toBe(true);

    expect(await open(harness, WORKSPACE_B)).toBe(true);
    await act(async () => restore.resolve(agentDescriptor("workspace-a", WORKSPACE_A, 1)));
    await flushAgentTurns();

    expect(harness.current().transition.workspaceRoot).toBe(WORKSPACE_B);
  });

  it("treats reactivating the current tab as a no-op and never saves workspace settings while switching", async () => {
    const harness = renderAgentWorkspaceHarness();
    await flushAgentTurns();
    await open(harness, WORKSPACE_A);
    await open(harness, WORKSPACE_B);
    const openPath = vi.mocked(harness.identityGateway.openPath!);
    openPath.mockClear();

    await act(async () => harness.current().transition.activateWorkspaceTab(WORKSPACE_B));
    await act(async () => harness.current().transition.activateWorkspaceTab(WORKSPACE_A));
    await act(async () => harness.current().transition.activateWorkspaceTab(WORKSPACE_B));
    await flushAgentTurns();

    expect(openPath.mock.calls.map(([path]) => path)).toEqual([WORKSPACE_A, WORKSPACE_B]);
    expect(harness.settingsGateway.saveWorkspaceSettings).not.toHaveBeenCalled();
    expect(harness.current().transition.workspaceRoot).toBe(WORKSPACE_B);
  });

  it("releases every owned identity with its exact admission on unmount", async () => {
    const unregister = vi.fn(async () => ({ status: "released" as const }));
    const harness = renderAgentWorkspaceHarness({
      identityGateway: agentIdentityGateway({ unregister }),
    });
    await flushAgentTurns();
    await open(harness, WORKSPACE_A);
    await open(harness, WORKSPACE_B);

    harness.unmount();
    await vi.waitFor(() => expect(unregister).toHaveBeenCalledTimes(2));

    expect(unregister).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      admissionToken: 1,
      canonicalRootPath: WORKSPACE_A,
    });
    expect(unregister).toHaveBeenCalledWith({
      workspaceId: "workspace-b",
      admissionToken: 2,
      canonicalRootPath: WORKSPACE_B,
    });
  });

  it("runs git repository discovery only while the git surfaces demand it", async () => {
    const harness = renderAgentWorkspaceHarness();
    await flushAgentTurns();
    await open(harness, WORKSPACE_A);
    expect(harness.git.runDiscovery).not.toHaveBeenCalled();

    harness.gitDemandRef.current = true;
    await act(async () => harness.current().transition.discoverGitRepositories());
    expect(harness.git.runDiscovery).toHaveBeenCalledExactlyOnceWith(
      WORKSPACE_A,
      expect.objectContaining({ gitDirectoryMappingsAuto: expect.any(Boolean) }),
    );

    await open(harness, WORKSPACE_B);
    expect(harness.git.runDiscovery).toHaveBeenLastCalledWith(WORKSPACE_B, expect.any(Object));
  });
});
