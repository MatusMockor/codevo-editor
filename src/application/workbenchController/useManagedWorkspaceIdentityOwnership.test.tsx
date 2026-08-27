// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";
import { useManagedWorkspaceIdentityOwnership } from "./useManagedWorkspaceIdentityOwnership";
import { LatestWorkspaceRequestTokenRegistry } from "./workspaceRequestTokenRegistry";

function descriptor(admissionToken = 7): WorkspaceIdentityDescriptor {
  return {
    admissionToken,
    workspaceId: "workspace-a",
    selectedPath: "/workspace-a",
    canonicalRoot: "/private/workspace-a",
    caseSensitive: true,
    unicodeNormalizationPolicy: "preserved",
    policy: { caseSensitive: true, unicodeNormalization: "none" },
  };
}

function renderOwnership() {
  const root = createRoot(document.createElement("div"));
  const registry = new LatestWorkspaceRequestTokenRegistry();
  const unregister = vi.fn(async () => undefined);
  const settleClosedDescriptor = vi.fn(() => true);
  const retireRuntimeOwnerClaim = vi.fn();
  const refs = {
    deferredCleanupIdsRef: { current: new Set<string>() },
    identityRequestTokensRef: { current: registry },
    latestAdmissionGenerationByIdRef: { current: {} as Record<string, number> },
    mountedRef: { current: true },
    nextAdmissionGenerationRef: { current: 0 },
    ownedGenerationByIdRef: { current: {} as Record<string, number> },
    ownedIdsRef: { current: new Set<string>() },
    pendingAdmissionsRef: { current: {} as Record<string, Set<number>> },
    releasedIdsRef: { current: new Set<string>() },
    releaseGenerationByIdRef: { current: {} as Record<string, number> },
    unregisterByIdRef: { current: {} as Record<string, Promise<void>> },
  };
  let ownership!: ReturnType<typeof useManagedWorkspaceIdentityOwnership>;

  function Host(): null {
    ownership = useManagedWorkspaceIdentityOwnership({
      ...refs,
      identityGateway: {
        openFromPicker: async () => ({ status: "cancelled" }),
        getDescriptor: async () => ({
          workspaceId: "workspace-a",
          selectedRootPath: "/workspace-a",
          canonicalRootPath: "/private/workspace-a",
          caseSensitive: true,
          unicodeNormalizationPolicy: "preserved",
        }),
        unregister,
        settleClosedDescriptor,
      },
      reportError: vi.fn(),
      retireRuntimeOwnerClaim,
      runtimeOwnerClaimsRef: { current: { generationFor: () => 1 } },
    });
    return null;
  }

  act(() => root.render(<Host />));
  return {
    ownership: () => ownership,
    refs,
    registry,
    retireRuntimeOwnerClaim,
    settleClosedDescriptor,
    unregister,
  };
}

describe("useManagedWorkspaceIdentityOwnership backend settlement", () => {
  it("settles only the adopted exact descriptor without legacy unregister", async () => {
    const harness = renderOwnership();
    const exact = descriptor();
    await harness.ownership().withManagedLease(exact, async (adopt) => adopt());

    const settlement = harness.ownership().prepareBackendClosedSettlement(exact);

    expect(settlement?.isCurrent()).toBe(true);
    expect(settlement?.settle(() => undefined)).toBe(true);
    expect(harness.unregister).not.toHaveBeenCalled();
    expect(harness.settleClosedDescriptor).toHaveBeenCalledWith(exact);
    expect(harness.retireRuntimeOwnerClaim).toHaveBeenCalledWith("workspace-a", 1);
    expect(harness.refs.ownedIdsRef.current.has("workspace-a")).toBe(false);
    expect(harness.refs.releasedIdsRef.current.has("workspace-a")).toBe(true);
  });

  it("rejects A1 after A2 but settles confirmed A2 truth during an unrelated open", async () => {
    const harness = renderOwnership();
    const first = descriptor(7);
    await harness.ownership().withManagedLease(first, async (adopt) => adopt());
    const firstSettlement = harness.ownership().prepareBackendClosedSettlement(first);
    const second = descriptor(8);
    await harness.ownership().withManagedLease(second, async (adopt) => adopt());

    expect(firstSettlement?.isCurrent()).toBe(false);
    expect(harness.ownership().prepareBackendClosedSettlement(first)).toBeNull();
    const secondSettlement = harness.ownership().prepareBackendClosedSettlement(second);
    harness.registry.issue(9);
    expect(secondSettlement?.isCurrent()).toBe(false);
    expect(secondSettlement?.settle(() => undefined)).toBe(true);
    expect(harness.unregister).not.toHaveBeenCalled();
  });
});
