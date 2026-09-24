// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type {
  WorkspaceIdentityDescriptor,
  WorkspaceIdentityGateway,
} from "../workspaceIdentityGatewayPort";
import {
  WORKSPACE_RELEASE_RETRY_DELAYS_MS,
  WORKSPACE_RELEASE_STILL_IN_PROGRESS,
} from "../workspaceReleaseRetry";
import {
  ADMISSION_ADOPTION_UNRESOLVED,
  MAX_PENDING_ADMISSION_ROLLBACKS,
  useManagedWorkspaceIdentityOwnership,
} from "./useManagedWorkspaceIdentityOwnership";
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

function renderOwnership(delayMode: "injected" | "scheduled" = "injected") {
  const root = createRoot(document.createElement("div"));
  const registry = new LatestWorkspaceRequestTokenRegistry();
  const unregister = vi.fn<WorkspaceIdentityGateway["unregister"]>(async () => ({
    status: "released",
  }));
  const rollbackAdmission = vi.fn<WorkspaceIdentityGateway["rollbackAdmission"]>(async () => ({
    status: "released",
  }));
  const adoptAdmission = vi.fn<WorkspaceIdentityGateway["adoptAdmission"]>(async () => ({
    status: "adopted",
  }));
  const releaseRetryDelay = vi.fn(async (_delayMs: number) => undefined);
  const settleClosedDescriptor = vi.fn(() => true);
  const retireRuntimeOwnerClaim = vi.fn();
  const reportError = vi.fn();
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
        adoptAdmission,
        rollbackAdmission,
        settleClosedDescriptor,
      },
      releaseRetryDelay: delayMode === "injected" ? releaseRetryDelay : undefined,
      reportError,
      retireRuntimeOwnerClaim,
      runtimeOwnerClaimsRef: { current: { generationFor: () => 1 } },
    });
    return null;
  }

  act(() => root.render(<Host />));
  return {
    adoptAdmission,
    ownership: () => ownership,
    refs,
    registry,
    releaseRetryDelay,
    reportError,
    retireRuntimeOwnerClaim,
    rollbackAdmission,
    settleClosedDescriptor,
    unmount: () => act(() => root.unmount()),
    unregister,
  };
}

describe("useManagedWorkspaceIdentityOwnership backend settlement", () => {
  it("settles only the adopted exact descriptor without legacy unregister", async () => {
    const harness = renderOwnership();
    const exact = descriptor();
    await harness.ownership().withManagedLease(exact, async (adopt) => {
      await adopt();
    });

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
    await harness.ownership().withManagedLease(first, async (adopt) => {
      await adopt();
    });
    const firstSettlement = harness.ownership().prepareBackendClosedSettlement(first);
    const second = descriptor(8);
    await harness.ownership().withManagedLease(second, async (adopt) => {
      await adopt();
    });

    expect(firstSettlement?.isCurrent()).toBe(false);
    expect(harness.ownership().prepareBackendClosedSettlement(first)).toBeNull();
    const secondSettlement = harness.ownership().prepareBackendClosedSettlement(second);
    harness.registry.issue(9);
    expect(secondSettlement?.isCurrent()).toBe(false);
    expect(secondSettlement?.settle(() => undefined)).toBe(true);
    expect(harness.unregister).not.toHaveBeenCalled();
  });
});

describe("useManagedWorkspaceIdentityOwnership owner-scoped release", () => {
  const owner = (admissionToken = 7) => ({
    workspaceId: "workspace-a",
    admissionToken,
    canonicalRootPath: "/private/workspace-a",
  });

  it("releases an owned workspace with its exact admission token and canonical root", async () => {
    const harness = renderOwnership();
    await harness.ownership().withManagedLease(descriptor(7), async (adopt) => {
      await adopt();
    });

    await expect(harness.ownership().releaseOwned("workspace-a", "retryLater")).resolves.toBe(
      "released",
    );

    expect(harness.unregister).toHaveBeenCalledExactlyOnceWith(owner(7));
    expect(harness.refs.releasedIdsRef.current.has("workspace-a")).toBe(true);
  });

  it("rolls back a never-adopted admission even when no older owner exists", async () => {
    const harness = renderOwnership();
    const abandoned = descriptor(9);

    await harness.ownership().withManagedLease(abandoned, async () => undefined);

    expect(harness.rollbackAdmission).toHaveBeenCalledExactlyOnceWith(abandoned);
    expect(harness.unregister).not.toHaveBeenCalled();
    expect(harness.refs.pendingAdmissionsRef.current["workspace-a"]).toBeUndefined();
  });

  it("treats an unknown workspace as an idempotent release", async () => {
    const harness = renderOwnership();
    harness.unregister.mockResolvedValueOnce({ status: "unknownWorkspace" });
    await harness.ownership().withManagedLease(descriptor(7), async (adopt) => {
      await adopt();
    });

    await expect(harness.ownership().releaseOwned("workspace-a", "retryLater")).resolves.toBe(
      "released",
    );
    expect(harness.refs.ownedIdsRef.current.has("workspace-a")).toBe(false);
  });

  it("releases editor ownership but reports runtimes retained by other owners", async () => {
    const harness = renderOwnership();
    harness.unregister.mockResolvedValueOnce({ status: "retainedByOtherOwners" });
    await harness.ownership().withManagedLease(descriptor(7), async (adopt) => {
      await adopt();
    });

    await expect(harness.ownership().releaseOwned("workspace-a", "retryLater")).resolves.toBe(
      "retained",
    );

    expect(harness.refs.ownedIdsRef.current.has("workspace-a")).toBe(false);
    expect(harness.retireRuntimeOwnerClaim).toHaveBeenCalledWith("workspace-a", 1);
  });

  it("never marks a stale owner released", async () => {
    const harness = renderOwnership();
    harness.unregister.mockResolvedValueOnce({ status: "staleOwner" });
    await harness.ownership().withManagedLease(descriptor(7), async (adopt) => {
      await adopt();
    });

    await expect(harness.ownership().releaseOwned("workspace-a", "retryLater")).resolves.toBe(
      "stale",
    );

    expect(harness.refs.ownedIdsRef.current.has("workspace-a")).toBe(true);
    expect(harness.refs.releasedIdsRef.current.has("workspace-a")).toBe(false);
    expect(harness.refs.releaseGenerationByIdRef.current["workspace-a"]).toBeUndefined();
    expect(harness.retireRuntimeOwnerClaim).not.toHaveBeenCalled();
  });

  it("retries a releasing backend release on the backoff schedule until it settles", async () => {
    const harness = renderOwnership();
    harness.unregister
      .mockResolvedValueOnce({ status: "releasing" })
      .mockResolvedValueOnce({ status: "releasing" })
      .mockResolvedValueOnce({ status: "released" });
    await harness.ownership().withManagedLease(descriptor(7), async (adopt) => {
      await adopt();
    });

    await expect(harness.ownership().releaseOwned("workspace-a", "retryLater")).resolves.toBe(
      "released",
    );

    expect(harness.unregister).toHaveBeenCalledTimes(3);
    expect(harness.releaseRetryDelay.mock.calls).toEqual([
      [WORKSPACE_RELEASE_RETRY_DELAYS_MS[0]],
      [WORKSPACE_RELEASE_RETRY_DELAYS_MS[1]],
    ]);
  });

  it("reports a truthful error when the backend stays releasing past the retry bound", async () => {
    const harness = renderOwnership();
    harness.unregister.mockResolvedValue({ status: "releasing" });
    await harness.ownership().withManagedLease(descriptor(7), async (adopt) => {
      await adopt();
    });

    await expect(harness.ownership().releaseOwned("workspace-a", "retryLater")).rejects.toThrow(
      WORKSPACE_RELEASE_STILL_IN_PROGRESS,
    );

    expect(harness.unregister).toHaveBeenCalledTimes(WORKSPACE_RELEASE_RETRY_DELAYS_MS.length + 1);
    expect(harness.refs.releasedIdsRef.current.has("workspace-a")).toBe(false);
    expect(harness.refs.ownedIdsRef.current.has("workspace-a")).toBe(true);
  });

  it("keeps a cleanup without a known release owner deferred instead of dropping it", async () => {
    const harness = renderOwnership();

    await expect(harness.ownership().releaseOwned("workspace-unknown", "retryLater")).resolves.toBe(
      "deferred",
    );
    harness.ownership().flushDeferredCleanup();
    await Promise.resolve();

    expect(harness.unregister).not.toHaveBeenCalled();
    expect(harness.refs.deferredCleanupIdsRef.current.has("workspace-unknown")).toBe(true);
  });

  it("keeps the deferred release owner when cleanup waits for a pending open", async () => {
    const harness = renderOwnership();
    await harness.ownership().withManagedLease(descriptor(7), async (adopt) => {
      await adopt();
    });
    harness.registry.issue(1);

    await expect(harness.ownership().releaseOwned("workspace-a", "retryLater")).resolves.toBe(
      "deferred",
    );
    harness.registry.complete(1);
    harness.ownership().flushDeferredCleanup();

    await vi.waitFor(() => expect(harness.unregister).toHaveBeenCalledExactlyOnceWith(owner(7)));
  });

  it("abandons a deferred release when the caller restores its tab", async () => {
    const harness = renderOwnership();
    await harness.ownership().withManagedLease(descriptor(7), async (adopt) => {
      await adopt();
    });
    harness.registry.issue(1);

    await expect(
      harness.ownership().releaseOwned("workspace-a", "abandonWhenDeferred"),
    ).resolves.toBe("deferred");

    expect(harness.refs.deferredCleanupIdsRef.current.has("workspace-a")).toBe(false);
    expect(harness.refs.releaseGenerationByIdRef.current["workspace-a"]).toBeUndefined();
    harness.registry.complete(1);
    harness.ownership().flushDeferredCleanup();
    await Promise.resolve();
    expect(harness.unregister).not.toHaveBeenCalled();
  });

  it("switches the owned token only after the backend adopts the reopened admission", async () => {
    const harness = renderOwnership();
    await harness.ownership().withManagedLease(descriptor(7), async (adopt) => {
      await adopt();
    });

    await harness.ownership().withManagedLease(descriptor(8), async (adopt) => {
      await expect(adopt()).resolves.toBe(true);
    });

    expect(harness.adoptAdmission).toHaveBeenCalledExactlyOnceWith({
      workspaceId: "workspace-a",
      newToken: 8,
      replacedToken: 7,
    });
    expect(harness.rollbackAdmission).not.toHaveBeenCalled();
    expect(harness.ownership().prepareBackendClosedSettlement(descriptor(7))).toBeNull();
    expect(harness.ownership().prepareBackendClosedSettlement(descriptor(8))).not.toBeNull();
    await harness.ownership().releaseOwned("workspace-a", "retryLater");
    expect(harness.unregister).toHaveBeenCalledExactlyOnceWith(owner(8));
  });

  it.each(["staleAdmission", "unknownWorkspace"] as const)(
    "keeps the old owner and rolls the reopened admission back when adoption is %s",
    async (status) => {
      const harness = renderOwnership();
      await harness.ownership().withManagedLease(descriptor(7), async (adopt) => {
        await adopt();
      });
      harness.adoptAdmission.mockResolvedValueOnce({ status });
      const reopened = descriptor(8);

      await harness.ownership().withManagedLease(reopened, async (adopt) => {
        await expect(adopt()).resolves.toBe(false);
      });

      expect(harness.rollbackAdmission).toHaveBeenCalledExactlyOnceWith(reopened);
      expect(harness.ownership().prepareBackendClosedSettlement(descriptor(7))).not.toBeNull();
    },
  );

  it("surfaces a failed release to its caller without an unhandled rejection", async () => {
    const harness = renderOwnership();
    const failure = new Error("transient unregister failure");
    harness.unregister.mockRejectedValueOnce(failure);
    await harness.ownership().withManagedLease(descriptor(7), async (adopt) => {
      await adopt();
    });

    await expect(harness.ownership().releaseOwned("workspace-a", "retryLater")).rejects.toBe(
      failure,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(harness.refs.ownedIdsRef.current.has("workspace-a")).toBe(true);
    expect(harness.refs.unregisterByIdRef.current["workspace-a"]).toBeUndefined();
  });

  it("retries a releasing or unknown adoption outcome instead of rolling back", async () => {
    const harness = renderOwnership();
    await harness.ownership().withManagedLease(descriptor(7), async (adopt) => {
      await adopt();
    });
    harness.adoptAdmission
      .mockResolvedValueOnce({ status: "releasing" })
      .mockRejectedValueOnce(new Error("adoption timed out"));

    await harness.ownership().withManagedLease(descriptor(8), async (adopt) => {
      await expect(adopt()).resolves.toBe(true);
    });

    expect(harness.adoptAdmission).toHaveBeenCalledTimes(3);
    expect(harness.rollbackAdmission).not.toHaveBeenCalled();
    expect(harness.ownership().prepareBackendClosedSettlement(descriptor(8))).not.toBeNull();
  });

  it("reports an unresolved adoption without rolling the reopened admission back", async () => {
    const harness = renderOwnership();
    await harness.ownership().withManagedLease(descriptor(7), async (adopt) => {
      await adopt();
    });
    harness.adoptAdmission.mockRejectedValue(new Error("transport lost"));

    await expect(
      harness.ownership().withManagedLease(descriptor(8), async (adopt) => {
        await adopt();
      }),
    ).rejects.toThrow(ADMISSION_ADOPTION_UNRESOLVED);

    expect(harness.rollbackAdmission).not.toHaveBeenCalled();
    expect(harness.refs.pendingAdmissionsRef.current["workspace-a"]).toBeUndefined();
    expect(harness.ownership().prepareBackendClosedSettlement(descriptor(7))).not.toBeNull();
  });

  it("lets the latest reopen win when an earlier adoption settles after it", async () => {
    const harness = renderOwnership();
    await harness.ownership().withManagedLease(descriptor(7), async (adopt) => {
      await adopt();
    });
    let settleT2Adoption: () => void = () => undefined;
    harness.adoptAdmission.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settleT2Adoption = () => resolve({ status: "adopted" });
        }),
    );
    const t2 = descriptor(8);
    const t2Result = { adopted: null as boolean | null };
    const reopeningT2 = harness.ownership().withManagedLease(t2, async (adopt) => {
      t2Result.adopted = await adopt();
    });
    await vi.waitFor(() => expect(harness.adoptAdmission).toHaveBeenCalledOnce());

    await harness.ownership().withManagedLease(descriptor(9), async (adopt) => {
      await expect(adopt()).resolves.toBe(true);
    });
    settleT2Adoption();
    await reopeningT2;

    expect(t2Result.adopted).toBe(false);
    expect(harness.rollbackAdmission).toHaveBeenCalledExactlyOnceWith(t2);
    expect(harness.ownership().prepareBackendClosedSettlement(descriptor(9))).not.toBeNull();
  });

  it("does not commit an adoption that settles after unmount", async () => {
    const harness = renderOwnership();
    await harness.ownership().withManagedLease(descriptor(7), async (adopt) => {
      await adopt();
    });
    let settleAdoption: () => void = () => undefined;
    harness.adoptAdmission.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settleAdoption = () => resolve({ status: "adopted" });
        }),
    );
    const reopening = harness.ownership().withManagedLease(descriptor(8), async (adopt) => {
      await expect(adopt()).resolves.toBe(false);
    });
    await vi.waitFor(() => expect(harness.adoptAdmission).toHaveBeenCalledOnce());

    harness.unmount();
    settleAdoption();
    await reopening;

    expect(harness.refs.ownedGenerationByIdRef.current["workspace-a"]).toBe(1);
  });

  it("queues a failed rollback and flushes it before the owner is released", async () => {
    const harness = renderOwnership();
    harness.rollbackAdmission.mockRejectedValueOnce(new Error("rollback transport lost"));
    const abandoned = descriptor(9);
    await harness.ownership().withManagedLease(abandoned, async () => undefined);
    await harness.ownership().withManagedLease(descriptor(10), async (adopt) => {
      await adopt();
    });

    await harness.ownership().releaseOwned("workspace-a", "retryLater");

    expect(harness.rollbackAdmission.mock.calls.map(([rolledBack]) => rolledBack)).toEqual([
      abandoned,
      abandoned,
    ]);
    expect(harness.rollbackAdmission.mock.invocationCallOrder[1]).toBeLessThan(
      harness.unregister.mock.invocationCallOrder[0] ?? 0,
    );
    expect(harness.reportError).not.toHaveBeenCalled();
  });

  it("reports instead of silently evicting when the rollback queue is full", async () => {
    const harness = renderOwnership();
    harness.rollbackAdmission.mockRejectedValue(new Error("rollback transport lost"));

    for (let token = 1; token <= MAX_PENDING_ADMISSION_ROLLBACKS + 1; token += 1) {
      await harness.ownership().withManagedLease(descriptor(token), async () => undefined);
    }

    expect(harness.reportError).toHaveBeenCalledExactlyOnceWith(
      "Workspace",
      expect.objectContaining({
        message: expect.stringContaining("rollback queue is full") as unknown,
      }),
    );
  });

  it("cancels scheduled rollback retries on unmount", async () => {
    vi.useFakeTimers();
    try {
      const harness = renderOwnership("scheduled");
      harness.rollbackAdmission.mockRejectedValue(new Error("rollback transport lost"));
      await act(async () => {
        await harness.ownership().withManagedLease(descriptor(9), async () => undefined);
      });
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      const attemptsBeforeUnmount = harness.rollbackAdmission.mock.calls.length;

      harness.unmount();
      expect(vi.getTimerCount()).toBe(0);
      await vi.runAllTimersAsync();

      expect(harness.rollbackAdmission).toHaveBeenCalledTimes(attemptsBeforeUnmount);
    } finally {
      vi.useRealTimers();
    }
  });
});
