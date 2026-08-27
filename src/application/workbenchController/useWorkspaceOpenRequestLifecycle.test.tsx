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

describe("useWorkspaceOpenRequestLifecycle open intents", () => {
  it("returns false for stale A1 after B and exact A2 open at the same selected path", async () => {
    const sharedPath = "/selected/shared";
    const a1 = descriptor("workspace-a", sharedPath, "/canonical/a", 11);
    const b = descriptor("workspace-b", sharedPath, "/canonical/b", 21);
    const a2 = descriptor("workspace-a", sharedPath, "/canonical/a", 12);
    const delayedA1 = deferred<WorkspaceIdentityDescriptor>();
    let callCount = 0;
    const gateway = identityGateway({
      openPath: vi.fn(() => {
        callCount += 1;
        if (callCount === 1) return delayedA1.promise;
        return Promise.resolve(callCount === 2 ? b : a2);
      }),
    });
    const harness = renderLifecycle(gateway);

    const openingA1 = harness.lifecycle().openWorkspaceRoot(sharedPath);
    await vi.waitFor(() => expect(gateway.openPath).toHaveBeenCalledTimes(1));
    await expect(harness.lifecycle().openWorkspaceRoot(sharedPath)).resolves.toBe(true);
    await expect(harness.lifecycle().openWorkspaceRoot(sharedPath)).resolves.toBe(true);
    delayedA1.resolve(a1);

    await expect(openingA1).resolves.toBe(false);
    expect(harness.currentWorkspaceIdentity()).toBe(a2);
    expect(gateway.unregister).not.toHaveBeenCalledWith(a1.workspaceId);
  });

  it("accepts an exact registered alias receipt without inferring success from path equality", async () => {
    const requestedAlias = "/requested/alias";
    const admitted = descriptor("workspace-alias", "/selected/alias", "/canonical/alias", 31);
    const gateway = identityGateway({ openPath: vi.fn(async () => admitted) });
    const harness = renderLifecycle(gateway);

    await expect(harness.lifecycle().openWorkspaceRoot(requestedAlias)).resolves.toBe(true);
    expect(harness.currentWorkspaceRoot()).toBe(admitted.selectedPath);
  });

  it("returns the exact alias and admission generation in a startup restore receipt", async () => {
    const admitted = descriptor("workspace-alias", "/selected/alias", "/canonical/alias", 41);
    const gateway = identityGateway({ openPath: vi.fn(async () => admitted) });
    const harness = renderLifecycle(gateway);
    const startup = harness.lifecycle().beginStartupRestore();

    const outcome = await startup.openWorkspacePath("/restored/alias");

    expect(outcome).toEqual({
      kind: "opened",
      receipt: {
        admissionGeneration: 1,
        admissionToken: 41,
        canonicalRoot: admitted.canonicalRoot,
        descriptor: admitted,
        kind: "registeredWorkspaceOpenReceipt",
        requestToken: 1,
        selectedPath: admitted.selectedPath,
        workspaceId: admitted.workspaceId,
      },
    });
  });

  it("accepts the exact owned generation for a cached registered identity", async () => {
    const cached = descriptor("workspace-cached", "/selected/cached", "/canonical/cached", 43);
    const gateway = identityGateway({ openPath: undefined });
    const harness = renderLifecycle(gateway, {
      cachedWorkspaceIdentity: cached,
      ownedWorkspaceIdentityGeneration: 7,
    });
    const startup = harness.lifecycle().beginStartupRestore();

    await expect(startup.openWorkspacePath("/restored/cached-alias")).resolves.toEqual({
      kind: "opened",
      receipt: {
        admissionGeneration: 7,
        admissionToken: 43,
        canonicalRoot: cached.canonicalRoot,
        descriptor: cached,
        kind: "registeredWorkspaceOpenReceipt",
        requestToken: 1,
        selectedPath: cached.selectedPath,
        workspaceId: cached.workspaceId,
      },
    });
  });

  it("permanently retires startup restore after a user open intent", async () => {
    const startupDescriptor = descriptor(
      "workspace-startup",
      "/selected/startup",
      "/canonical/startup",
      51,
    );
    const userDescriptor = descriptor("workspace-user", "/selected/user", "/canonical/user", 61);
    const gateway = identityGateway({
      openPath: vi.fn(async (path: string) =>
        path === startupDescriptor.selectedPath ? startupDescriptor : userDescriptor,
      ),
    });
    const harness = renderLifecycle(gateway);
    const startup = harness.lifecycle().beginStartupRestore();

    await expect(harness.lifecycle().openWorkspaceRoot(userDescriptor.selectedPath)).resolves.toBe(
      true,
    );
    const outcome = await startup.openWorkspacePath(startupDescriptor.selectedPath);

    expect(outcome.kind).toBe("stale");
    expect(gateway.openPath).not.toHaveBeenCalledWith(startupDescriptor.selectedPath);
    expect(startup.isCurrent()).toBe(false);
  });

  it("retires a pending startup restore when the user reactivates the current tab", async () => {
    const currentPath = "/selected/current";
    const startup = descriptor("workspace-startup", "/selected/startup", "/canonical/startup", 62);
    const pendingCommit = deferred<void>();
    const gateway = identityGateway({ openPath: vi.fn(async () => startup) });
    const harness = renderLifecycle(gateway, {
      beforeWorkspaceCommit: () => pendingCommit.promise,
      initialWorkspaceRoot: currentPath,
    });
    const startupIntent = harness.lifecycle().beginStartupRestore();
    const opening = startupIntent.openWorkspacePath(startup.selectedPath);
    await vi.waitFor(() => expect(harness.performOpenWorkspacePath).toHaveBeenCalledOnce());

    await harness.lifecycle().activateWorkspaceTab(currentPath);
    pendingCommit.resolve();

    await expect(opening).resolves.toEqual({ kind: "stale", requestToken: 1 });
    expect(harness.currentWorkspaceRoot()).toBe(currentPath);
    expect(startupIntent.isCurrent()).toBe(false);
  });

  it("rejects an old owned generation when exact descriptor adoption fails", async () => {
    const initial = descriptor("workspace-shared", "/selected/shared", "/canonical/initial", 81);
    const replacement = descriptor(
      "workspace-shared",
      "/selected/shared",
      "/canonical/replacement",
      82,
    );
    const gateway = identityGateway({
      openPath: vi
        .fn<NonNullable<WorkspaceIdentityGateway["openPath"]>>()
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(replacement),
    });
    const harness = renderLifecycle(gateway, {
      beforeAdopt: (descriptor) => {
        if (descriptor === replacement) descriptor.canonicalRoot = "/canonical/mutated";
      },
    });

    await expect(harness.lifecycle().openWorkspaceRoot(initial.selectedPath)).resolves.toBe(true);
    await expect(harness.lifecycle().openWorkspaceRoot(replacement.selectedPath)).resolves.toBe(
      false,
    );

    expect(harness.currentWorkspaceIdentity()).toBe(initial);
  });

  it("fails a pending open closed after unmount", async () => {
    const admitted = descriptor("workspace-late", "/selected/late", "/canonical/late", 71);
    const delayed = deferred<WorkspaceIdentityDescriptor>();
    const gateway = identityGateway({ openPath: vi.fn(() => delayed.promise) });
    const harness = renderLifecycle(gateway);
    const opening = harness.lifecycle().openWorkspaceRoot(admitted.selectedPath);
    await vi.waitFor(() => expect(gateway.openPath).toHaveBeenCalledOnce());

    harness.unmountAuthority();
    delayed.resolve(admitted);

    await expect(opening).resolves.toBe(false);
    expect(harness.performOpenWorkspacePath).not.toHaveBeenCalled();
  });
});

interface LifecycleHarnessOptions {
  beforeAdopt?(descriptor: WorkspaceIdentityDescriptor): void;
  beforeWorkspaceCommit?(): Promise<void>;
  readonly cachedWorkspaceIdentity?: WorkspaceIdentityDescriptor;
  readonly initialWorkspaceRoot?: string;
  readonly ownedWorkspaceIdentityGeneration?: number;
}

function renderLifecycle(gateway: WorkspaceIdentityGateway, options: LifecycleHarnessOptions = {}) {
  const currentWorkspaceRootRef = { current: options.initialWorkspaceRoot ?? null };
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
  const latestAdmissionGenerationByIdRef = { current: {} as Record<string, number> };
  const nextAdmissionGenerationRef = { current: 0 };
  const ownedGenerationByIdRef = { current: {} as Record<string, number> };
  if (options.cachedWorkspaceIdentity && options.ownedWorkspaceIdentityGeneration !== undefined) {
    ownedGenerationByIdRef.current[options.cachedWorkspaceIdentity.workspaceId] =
      options.ownedWorkspaceIdentityGeneration;
  }
  const ownedIdsRef = { current: new Set<string>() };
  const pendingAdmissionsRef = { current: {} as Record<string, Set<number>> };
  const releasedIdsRef = { current: new Set<string>() };
  const releaseGenerationByIdRef = { current: {} as Record<string, number> };
  const unregisterByIdRef = { current: {} as Record<string, Promise<void>> };
  const performOpenWorkspacePath = vi.fn(
    async (
      path: string,
      admitted: WorkspaceIdentityDescriptor | null,
      adoptIdentity: (() => number | null) | null,
      _requestToken: number,
      commitOpenWorkspaceRequest: (
        selectedPath: string,
        admissionGeneration: number | null,
      ) => void,
      openOptions?: Readonly<{
        cachePreviousWorkspace?: boolean;
        isOpenIntentCurrent?: () => boolean;
      }>,
    ) => {
      await options.beforeWorkspaceCommit?.();
      if (openOptions?.isOpenIntentCurrent && !openOptions.isOpenIntentCurrent()) return;
      if (admitted) options.beforeAdopt?.(admitted);
      const admissionGeneration = adoptIdentity
        ? adoptIdentity()
        : admitted
          ? (ownedGenerationByIdRef.current[admitted.workspaceId] ?? null)
          : null;
      if (adoptIdentity && admissionGeneration === null) return;
      currentWorkspaceRootRef.current = path;
      if (admitted) workspaceIdentityByRootRef.current[path] = admitted;
      commitOpenWorkspaceRequest(path, admissionGeneration);
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
      latestAdmissionGenerationByIdRef,
      mountedRef: workbenchMountedRef,
      nextAdmissionGenerationRef,
      ownedGenerationByIdRef,
      ownedIdsRef,
      pendingAdmissionsRef,
      releasedIdsRef,
      releaseGenerationByIdRef,
      reportError: vi.fn(),
      retireRuntimeOwnerClaim: vi.fn(),
      runtimeOwnerClaimsRef: { current: { generationFor: () => undefined } },
      unregisterByIdRef,
    });
    lifecycle = useWorkspaceOpenRequestLifecycle({
      completeDeferredIdentityCleanup: managedOwnership.flushDeferredCleanup,
      currentWorkspaceRootRef,
      openWorkspaceRequestInFlightTokenRef,
      openWorkspaceRequestPathRef,
      openWorkspaceRequestTokenRef,
      ownedWorkspaceIdentityGenerationByIdRef: ownedGenerationByIdRef,
      pendingWorkspaceIdentityRequestTokensRef,
      performOpenWorkspacePath,
      reportError: vi.fn(),
      resolveCachedWorkspaceState: () =>
        options.cachedWorkspaceIdentity
          ? { workspaceIdentityDescriptor: options.cachedWorkspaceIdentity }
          : null,
      withManagedWorkspaceIdentityLease: managedOwnership.withManagedLease,
      workbenchMountedRef,
      workspaceCloseGenerationByRootRef,
      workspaceCloseOwnershipByKeyRef,
      workspaceCloseOwnershipGenerationRef,
      workspaceIdentityByRootRef,
      workspaceIdentityGateway: gateway,
      workspaceRoot: options.initialWorkspaceRoot ?? null,
    });
    return null;
  }

  act(() => root.render(<Harness />));

  return {
    currentWorkspaceIdentity: () =>
      workspaceIdentityByRootRef.current[currentWorkspaceRootRef.current ?? ""] ?? null,
    currentWorkspaceRoot: () => currentWorkspaceRootRef.current,
    lifecycle: () => {
      if (!lifecycle) throw new Error("Workspace lifecycle did not render");
      return lifecycle;
    },
    performOpenWorkspacePath,
    unmountAuthority: () => {
      workbenchMountedRef.current = false;
    },
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
  admissionToken = 1,
): WorkspaceIdentityDescriptor {
  return {
    admissionToken,
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
