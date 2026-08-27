// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  WorkspaceIdentityDescriptor,
  WorkspaceIdentityGateway,
} from "../workspaceIdentityGatewayPort";
import { useManagedWorkspaceIdentityOwnership } from "./useManagedWorkspaceIdentityOwnership";
import { useWorkspaceOpenRequestLifecycle } from "./useWorkspaceOpenRequestLifecycle";
import { LatestWorkspaceRequestTokenRegistry } from "./workspaceRequestTokenRegistry";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mountedRoots: Root[] = [];

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount());
  }
});

describe("useWorkspaceOpenRequestLifecycle close ownership", () => {
  it("releases a stale direct admission without invalidating an active close", async () => {
    const active = descriptor("workspace-active", "/selected/active", "/canonical/shared");
    const stale = descriptor("workspace-stale", "/selected/stale", active.canonicalRoot);
    const replacement = descriptor(
      "workspace-replacement",
      "/selected/replacement",
      "/canonical/replacement",
    );
    const staleAdmission = deferred<WorkspaceIdentityDescriptor>();
    const gateway = identityGateway({
      openPath: vi.fn((path: string) => {
        if (path === stale.selectedPath) return staleAdmission.promise;
        return Promise.resolve(path === active.selectedPath ? active : replacement);
      }),
    });
    const harness = renderLifecycle(gateway);

    await act(async () => harness.lifecycle().openWorkspacePath(active.selectedPath));
    const pendingStaleOpen = harness.lifecycle().openWorkspacePath(stale.selectedPath);
    await vi.waitFor(() => expect(gateway.openPath).toHaveBeenCalledWith(stale.selectedPath));
    const closeOwnership = harness.lifecycle().beginWorkspaceClose(active.selectedPath, active);

    await act(async () => harness.lifecycle().openWorkspacePath(replacement.selectedPath));
    expect(closeOwnership.isCurrent()).toBe(true);

    staleAdmission.resolve(stale);
    await act(async () => pendingStaleOpen);

    expect(closeOwnership.isCurrent()).toBe(true);
    expect(harness.performOpenWorkspacePath.mock.calls.map(([path]) => path)).toEqual([
      active.selectedPath,
      replacement.selectedPath,
    ]);
    expect(gateway.unregister).toHaveBeenCalledExactlyOnceWith(stale.workspaceId);
  });

  it("releases a stale picker admission without invalidating an active close", async () => {
    const active = descriptor("workspace-active", "/selected/active", "/canonical/shared");
    const stale = descriptor("workspace-stale-picker", "/selected/stale", active.canonicalRoot);
    const replacement = descriptor(
      "workspace-replacement",
      "/selected/replacement",
      "/canonical/replacement",
    );
    const staleAdmission =
      deferred<Awaited<ReturnType<WorkspaceIdentityGateway["openFromPicker"]>>>();
    const gateway = identityGateway({
      openFromPicker: vi.fn(() => staleAdmission.promise),
      openPath: vi.fn(async (path: string) =>
        path === active.selectedPath ? active : replacement,
      ),
    });
    const harness = renderLifecycle(gateway);

    await act(async () => harness.lifecycle().openWorkspacePath(active.selectedPath));
    const pendingPickerOpen = harness.lifecycle().openWorkspace();
    await vi.waitFor(() => expect(gateway.openFromPicker).toHaveBeenCalledOnce());
    const closeOwnership = harness.lifecycle().beginWorkspaceClose(active.selectedPath, active);

    await act(async () => harness.lifecycle().openWorkspacePath(replacement.selectedPath));
    expect(closeOwnership.isCurrent()).toBe(true);

    staleAdmission.resolve({ status: "opened", descriptor: stale });
    await act(async () => pendingPickerOpen);

    expect(closeOwnership.isCurrent()).toBe(true);
    expect(harness.performOpenWorkspacePath.mock.calls.map(([path]) => path)).toEqual([
      active.selectedPath,
      replacement.selectedPath,
    ]);
    expect(gateway.unregister).toHaveBeenCalledExactlyOnceWith(stale.workspaceId);
  });
});

function renderLifecycle(gateway: WorkspaceIdentityGateway) {
  const currentWorkspaceRootRef = { current: null as string | null };
  const openWorkspaceRequestInFlightTokenRef = { current: null as number | null };
  const openWorkspaceRequestPathRef = { current: null as string | null };
  const openWorkspaceRequestTokenRef = { current: 0 };
  const pendingWorkspaceIdentityRequestTokensRef = {
    current: new LatestWorkspaceRequestTokenRegistry(),
  };
  const workbenchMountedRef = { current: true };
  const workspaceCloseGenerationByRootRef = { current: {} as Record<string, number> };
  const workspaceCloseOwnershipByKeyRef = { current: {} as Record<string, number> };
  const workspaceCloseOwnershipGenerationRef = { current: 0 };
  const workspaceIdentityByRootRef = {
    current: {} as Record<string, WorkspaceIdentityDescriptor>,
  };
  const performOpenWorkspacePath = vi.fn(
    async (
      path: string,
      admitted: WorkspaceIdentityDescriptor | null,
      adoptIdentity: (() => void) | null,
    ) => {
      adoptIdentity?.();
      currentWorkspaceRootRef.current = path;
      if (admitted) workspaceIdentityByRootRef.current[path] = admitted;
    },
  );
  let lifecycle: ReturnType<typeof useWorkspaceOpenRequestLifecycle> | null = null;
  const root = createRoot(document.createElement("div"));
  mountedRoots.push(root);

  function Harness() {
    const managedOwnership = useManagedWorkspaceIdentityOwnership({
      deferredCleanupIdsRef: { current: new Set<string>() },
      identityGateway: gateway,
      identityRequestTokensRef: pendingWorkspaceIdentityRequestTokensRef,
      mountedRef: workbenchMountedRef,
      nextAdmissionGenerationRef: { current: 0 },
      ownedGenerationByIdRef: { current: {} },
      ownedIdsRef: { current: new Set<string>() },
      pendingAdmissionsRef: { current: {} },
      releasedIdsRef: { current: new Set<string>() },
      releaseGenerationByIdRef: { current: {} },
      reportError: vi.fn(),
      retireRuntimeOwnerClaim: vi.fn(),
      runtimeOwnerClaimsRef: { current: { generationFor: () => undefined } },
      unregisterByIdRef: { current: {} },
    });
    lifecycle = useWorkspaceOpenRequestLifecycle({
      completeDeferredIdentityCleanup: managedOwnership.flushDeferredCleanup,
      currentWorkspaceRootRef,
      openWorkspaceRequestInFlightTokenRef,
      openWorkspaceRequestPathRef,
      openWorkspaceRequestTokenRef,
      pendingWorkspaceIdentityRequestTokensRef,
      performOpenWorkspacePath,
      reportError: vi.fn(),
      resolveCachedWorkspaceState: () => null,
      withManagedWorkspaceIdentityLease: managedOwnership.withManagedLease,
      workbenchMountedRef,
      workspaceCloseGenerationByRootRef,
      workspaceCloseOwnershipByKeyRef,
      workspaceCloseOwnershipGenerationRef,
      workspaceIdentityByRootRef,
      workspaceIdentityGateway: gateway,
      workspaceRoot: currentWorkspaceRootRef.current,
    });
    return null;
  }

  act(() => root.render(<Harness />));

  return {
    lifecycle: () => {
      if (!lifecycle) throw new Error("Workspace lifecycle did not render");
      return lifecycle;
    },
    performOpenWorkspacePath,
  };
}

function identityGateway(overrides: Partial<WorkspaceIdentityGateway>): WorkspaceIdentityGateway & {
  readonly openFromPicker: ReturnType<typeof vi.fn>;
  readonly openPath: ReturnType<typeof vi.fn>;
  readonly unregister: ReturnType<typeof vi.fn>;
} {
  return {
    getDescriptor: vi.fn(async (workspaceId: string) => ({
      workspaceId,
      selectedRootPath: "/selected",
      canonicalRootPath: "/canonical",
      caseSensitive: true,
      unicodeNormalizationPolicy: "preserved",
    })),
    openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
    openPath: vi.fn(async (path: string) => descriptor(path, path, path)),
    unregister: vi.fn(async () => undefined),
    ...overrides,
  } as WorkspaceIdentityGateway & {
    readonly openFromPicker: ReturnType<typeof vi.fn>;
    readonly openPath: ReturnType<typeof vi.fn>;
    readonly unregister: ReturnType<typeof vi.fn>;
  };
}

function descriptor(
  workspaceId: string,
  selectedPath: string,
  canonicalRoot: string,
): WorkspaceIdentityDescriptor {
  return {
    canonicalRoot,
    caseSensitive: true,
    policy: { caseSensitive: true, unicodeNormalization: "none" },
    selectedPath,
    unicodeNormalizationPolicy: "preserved",
    workspaceId,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
