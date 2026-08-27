// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  WorkspaceIdentityDescriptor,
  WorkspaceIdentityGateway,
} from "../workspaceIdentityGatewayPort";
import { useManagedWorkspaceIdentityOwnership } from "./useManagedWorkspaceIdentityOwnership";
import { useWorkspaceIdentityAuthority } from "./useWorkspaceIdentityAuthority";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mountedRoots: Root[] = [];

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount());
  }
});

describe("useWorkspaceIdentityAuthority", () => {
  it("keeps the adopted A2 generation authoritative when pending A1 retires after B", async () => {
    const unregister = vi.fn(async () => undefined);
    const harness = renderAuthority(unregister);
    const a1 = descriptor("workspace-a", "/alias/a-one", "/canonical/a", 11);
    const b = descriptor("workspace-b", "/selected/b", "/canonical/b", 21);
    const a2 = descriptor("workspace-a", "/alias/a-two", "/canonical/a", 12);
    const a1Use = deferred<void>();
    const pendingA1 = harness.managed().withManagedLease(a1, async (adopt) => {
      await a1Use.promise;
      adopt();
    });

    await harness.managed().withManagedLease(b, async (adopt) => adopt());
    await harness.managed().withManagedLease(a2, async (adopt) => adopt());
    a1Use.resolve();
    await pendingA1;

    expect(harness.authority().ownedWorkspaceIdentityGenerationByIdRef.current).toEqual({
      "workspace-a": 3,
      "workspace-b": 2,
    });
    expect(unregister).not.toHaveBeenCalledWith("workspace-a");

    await harness.managed().releaseOwned("workspace-a");

    expect(unregister).toHaveBeenCalledExactlyOnceWith("workspace-a");
    expect(harness.retireRuntimeOwnerClaim).toHaveBeenCalledWith("workspace-a", 3);
  });

  it("rejects adoption after the exact alias admission descriptor changes", async () => {
    const unregister = vi.fn(async () => undefined);
    const harness = renderAuthority(unregister);
    const admitted = descriptor("workspace-a", "/alias/a", "/canonical/a", 31);
    const mutable = admitted as {
      admissionToken?: number;
      canonicalRoot: string;
      selectedPath: string;
    };

    await harness.managed().withManagedLease(admitted, async (adopt) => {
      mutable.selectedPath = "/alias/replaced";
      adopt();
    });

    expect(harness.authority().ownedWorkspaceIdentityIdsRef.current).not.toContain("workspace-a");
    expect(unregister).toHaveBeenCalledExactlyOnceWith("workspace-a");
  });

  it("does not mark A2 released when A1 unregister settles after replacement admission", async () => {
    const unregisterRequest = deferred<void>();
    const unregister = vi.fn(() => unregisterRequest.promise);
    const harness = renderAuthority(unregister);
    const a1 = descriptor("workspace-a", "/alias/a-one", "/canonical/a", 41);
    const a2 = descriptor("workspace-a", "/alias/a-two", "/canonical/a", 42);
    const retiringA1 = harness.managed().withManagedLease(a1, async () => undefined);

    await vi.waitFor(() => expect(unregister).toHaveBeenCalledExactlyOnceWith("workspace-a"));
    await harness.managed().withManagedLease(a2, async (adopt) => adopt());
    unregisterRequest.resolve();
    await retiringA1;

    expect(harness.authority().ownedWorkspaceIdentityIdsRef.current).toContain("workspace-a");
    expect(harness.authority().releasedWorkspaceIdentityIdsRef.current).not.toContain(
      "workspace-a",
    );
    expect(harness.authority().ownedWorkspaceIdentityGenerationByIdRef.current["workspace-a"]).toBe(
      2,
    );
  });
});

function renderAuthority(unregister: (workspaceId: string) => Promise<void>) {
  let authority: ReturnType<typeof useWorkspaceIdentityAuthority> | null = null;
  let managed: ReturnType<typeof useManagedWorkspaceIdentityOwnership> | null = null;
  const retireRuntimeOwnerClaim = vi.fn();
  const root = createRoot(document.createElement("div"));
  mountedRoots.push(root);

  function Harness() {
    authority = useWorkspaceIdentityAuthority();
    managed = useManagedWorkspaceIdentityOwnership({
      deferredCleanupIdsRef: authority.deferredWorkspaceIdentityCleanupIdsRef,
      identityGateway: identityGateway(unregister),
      identityRequestTokensRef: authority.pendingWorkspaceIdentityRequestTokensRef,
      latestAdmissionGenerationByIdRef: authority.latestWorkspaceIdentityAdmissionGenerationByIdRef,
      mountedRef: { current: true },
      nextAdmissionGenerationRef: authority.workspaceIdentityAdmissionGenerationRef,
      ownedGenerationByIdRef: authority.ownedWorkspaceIdentityGenerationByIdRef,
      ownedIdsRef: authority.ownedWorkspaceIdentityIdsRef,
      pendingAdmissionsRef: authority.pendingWorkspaceIdentityAdmissionsRef,
      releasedIdsRef: authority.releasedWorkspaceIdentityIdsRef,
      releaseGenerationByIdRef: authority.workspaceIdentityReleaseGenerationByIdRef,
      reportError: vi.fn(),
      retireRuntimeOwnerClaim,
      runtimeOwnerClaimsRef: {
        current: {
          generationFor: (workspaceId: string) =>
            authority?.ownedWorkspaceIdentityGenerationByIdRef.current[workspaceId],
        },
      },
      unregisterByIdRef: authority.workspaceIdentityUnregisterByIdRef,
    });
    return null;
  }

  act(() => root.render(<Harness />));

  return {
    authority: () => {
      if (!authority) throw new Error("Workspace identity authority did not render");
      return authority;
    },
    managed: () => {
      if (!managed) throw new Error("Managed workspace identity ownership did not render");
      return managed;
    },
    retireRuntimeOwnerClaim,
  };
}

function identityGateway(
  unregister: (workspaceId: string) => Promise<void>,
): WorkspaceIdentityGateway {
  return {
    getDescriptor: async (workspaceId) => ({
      canonicalRootPath: "/canonical",
      caseSensitive: true,
      selectedRootPath: "/selected",
      unicodeNormalizationPolicy: "preserved",
      workspaceId,
    }),
    openFromPicker: async () => ({ status: "cancelled" }),
    unregister,
  };
}

function descriptor(
  workspaceId: string,
  selectedPath: string,
  canonicalRoot: string,
  admissionToken: number,
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

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
