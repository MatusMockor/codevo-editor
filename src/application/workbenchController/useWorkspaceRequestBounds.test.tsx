// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceOpenRequestLifecycle } from "./useWorkspaceOpenRequestLifecycle";
import { LatestWorkspaceRequestTokenRegistry } from "./workspaceRequestTokenRegistry";

const mountedRoots: Root[] = [];

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount());
  }
  vi.useRealTimers();
});

describe("workspace request bounds", () => {
  it("retires a never-settling superseded open token while preserving the winner", async () => {
    const never = new Promise<never>(() => undefined);
    const registry = new LatestWorkspaceRequestTokenRegistry();
    const completeDeferredIdentityCleanup = vi.fn();
    const openPath = vi.fn((path: string) =>
      path === "/a"
        ? never
        : Promise.resolve({
            workspaceId: "b",
            selectedPath: "/b",
            canonicalRoot: "/b",
            caseSensitive: true,
            unicodeNormalizationPolicy: "preserved" as const,
            policy: {
              caseSensitive: true as const,
              unicodeNormalization: "none" as const,
            },
          }),
    );
    let lifecycle!: ReturnType<typeof useWorkspaceOpenRequestLifecycle>;
    render(() => {
      lifecycle = useWorkspaceOpenRequestLifecycle({
        completeDeferredIdentityCleanup,
        currentWorkspaceRootRef: { current: null },
        openWorkspaceRequestInFlightTokenRef: { current: null },
        openWorkspaceRequestPathRef: { current: null },
        openWorkspaceRequestTokenRef: { current: 0 },
        ownedWorkspaceIdentityGenerationByIdRef: { current: {} },
        pendingWorkspaceIdentityRequestTokensRef: { current: registry },
        performOpenWorkspacePath: async () => undefined,
        reportError: vi.fn(),
        resolveCachedWorkspaceState: () => null,
        withManagedWorkspaceIdentityLease: async (_descriptor, leaseOperation) =>
          leaseOperation(async () => false),
        workbenchMountedRef: { current: true },
        workspaceCloseGenerationByRootRef: { current: {} },
        workspaceCloseOwnershipByKeyRef: { current: {} },
        workspaceCloseOwnershipGenerationRef: { current: 0 },
        workspaceIdentityByRootRef: { current: {} },
        workspaceIdentityGateway: {
          openFromPicker: async () => ({ status: "cancelled" }),
          openPath,
          getDescriptor: async (workspaceId) => ({
            workspaceId,
            selectedRootPath: "/b",
            canonicalRootPath: "/b",
            caseSensitive: true,
            unicodeNormalizationPolicy: "preserved",
          }),
          unregister: async () => ({ status: "released" as const }),
          adoptAdmission: async () => ({ status: "adopted" as const }),
          rollbackAdmission: async () => ({ status: "released" as const }),
        },
        workspaceRoot: null,
      });
    });

    void lifecycle.openWorkspacePath("/a");
    expect(registry.pendingToken()).toBe(1);

    await act(async () => lifecycle.openWorkspacePath("/b"));
    expect(openPath).toHaveBeenCalledTimes(2);
    expect(registry.hasPending()).toBe(false);
    expect(completeDeferredIdentityCleanup).toHaveBeenCalledTimes(1);
  });
});

function render(useHooks: () => void): void {
  const container = document.createElement("div");
  const root = createRoot(container);
  mountedRoots.push(root);

  function Harness() {
    useHooks();
    return null;
  }

  act(() => root.render(<Harness />));
}
