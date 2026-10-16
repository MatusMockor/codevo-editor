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
    const gateway = identityGateway();
    const harness = renderAuthority(gateway);
    const a1 = descriptor("workspace-a", "/alias/a-one", "/canonical/a", 11);
    const b = descriptor("workspace-b", "/selected/b", "/canonical/b", 21);
    const a2 = descriptor("workspace-a", "/alias/a-two", "/canonical/a", 12);
    const a1Use = deferred<void>();
    const pendingA1 = harness.managed().withManagedLease(a1, async (adopt) => {
      await a1Use.promise;
      await adopt();
    });

    await harness.managed().withManagedLease(b, async (adopt) => {
      await adopt();
    });
    await harness.managed().withManagedLease(a2, async (adopt) => {
      await adopt();
    });
    a1Use.resolve();
    await pendingA1;

    expect(harness.authority().ownedWorkspaceIdentityGenerationByIdRef.current).toEqual({
      "workspace-a": 3,
      "workspace-b": 2,
    });
    expect(gateway.rollbackAdmission).toHaveBeenCalledExactlyOnceWith(a1);
    expect(gateway.unregister).not.toHaveBeenCalled();

    await harness.managed().releaseOwned("workspace-a", "retryLater");

    expect(gateway.unregister).toHaveBeenCalledExactlyOnceWith({
      workspaceId: "workspace-a",
      admissionToken: 12,
      canonicalRootPath: "/canonical/a",
    });
    expect(harness.retireRuntimeOwnerClaim).toHaveBeenCalledWith("workspace-a", 3);
  });

  it("rolls back the exact admission when its descriptor changes before adoption", async () => {
    const gateway = identityGateway();
    const harness = renderAuthority(gateway);
    const admitted = descriptor("workspace-a", "/alias/a", "/canonical/a", 31);
    const mutable = admitted as {
      admissionToken?: number;
      canonicalRoot: string;
      selectedPath: string;
    };

    await harness.managed().withManagedLease(admitted, async (adopt) => {
      mutable.selectedPath = "/alias/replaced";
      await adopt();
    });

    expect(harness.authority().ownedWorkspaceIdentityIdsRef.current).not.toContain("workspace-a");
    expect(gateway.rollbackAdmission).toHaveBeenCalledExactlyOnceWith(admitted);
    expect(gateway.unregister).not.toHaveBeenCalled();
  });

  it("does not disturb A2 when the A1 rollback settles after replacement admission", async () => {
    const rollbackRequest = deferred<{ readonly status: "released" }>();
    const gateway = identityGateway({ rollbackAdmission: vi.fn(() => rollbackRequest.promise) });
    const harness = renderAuthority(gateway);
    const a1 = descriptor("workspace-a", "/alias/a-one", "/canonical/a", 41);
    const a2 = descriptor("workspace-a", "/alias/a-two", "/canonical/a", 42);
    const retiringA1 = harness.managed().withManagedLease(a1, async () => undefined);

    await vi.waitFor(() => expect(gateway.rollbackAdmission).toHaveBeenCalledExactlyOnceWith(a1));
    await harness.managed().withManagedLease(a2, async (adopt) => {
      await adopt();
    });
    rollbackRequest.resolve({ status: "released" });
    await retiringA1;

    expect(harness.authority().ownedWorkspaceIdentityIdsRef.current).toContain("workspace-a");
    expect(harness.authority().releasedWorkspaceIdentityIdsRef.current).not.toContain(
      "workspace-a",
    );
    expect(harness.authority().ownedWorkspaceIdentityGenerationByIdRef.current["workspace-a"]).toBe(
      2,
    );
    expect(gateway.adoptAdmission).not.toHaveBeenCalled();
  });
});

function renderAuthority(gateway: WorkspaceIdentityGateway) {
  let authority: ReturnType<typeof useWorkspaceIdentityAuthority> | null = null;
  let managed: ReturnType<typeof useManagedWorkspaceIdentityOwnership> | null = null;
  const retireRuntimeOwnerClaim = vi.fn();
  const root = createRoot(document.createElement("div"));
  mountedRoots.push(root);

  function Harness() {
    authority = useWorkspaceIdentityAuthority();
    managed = useManagedWorkspaceIdentityOwnership({
      deferredCleanupIdsRef: authority.deferredWorkspaceIdentityCleanupIdsRef,
      identityGateway: gateway,
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

function identityGateway(overrides: Partial<WorkspaceIdentityGateway> = {}) {
  return {
    getDescriptor: vi.fn(async (workspaceId: string) => ({
      canonicalRootPath: "/canonical",
      caseSensitive: true,
      selectedRootPath: "/selected",
      unicodeNormalizationPolicy: "preserved" as const,
      workspaceId,
    })),
    openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
    unregister: vi.fn<WorkspaceIdentityGateway["unregister"]>(async () => ({ status: "released" })),
    adoptAdmission: vi.fn<WorkspaceIdentityGateway["adoptAdmission"]>(async () => ({
      status: "adopted",
    })),
    rollbackAdmission: vi.fn<WorkspaceIdentityGateway["rollbackAdmission"]>(async () => ({
      status: "released",
    })),
    ...overrides,
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
