import { describe, expect, it, vi } from "vitest";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";
import { CloseCoordinator } from "./closeCoordinator";
import {
  prepareRegisteredWorkspaceClose,
  RegisteredWorkspaceCloseCoordinator,
} from "./registeredWorkspaceCloseCoordinator";
import {
  WORKSPACE_RELEASE_RETRY_DELAYS_MS,
  WORKSPACE_RELEASE_STILL_IN_PROGRESS,
} from "./workspaceReleaseRetry";

function identity(
  workspaceId: string,
  admissionToken: number,
  selectedPath: string,
  canonicalRoot: string,
): WorkspaceIdentityDescriptor {
  return {
    workspaceId,
    admissionToken,
    selectedPath,
    canonicalRoot,
    caseSensitive: true,
    unicodeNormalizationPolicy: "preserved",
    policy: { caseSensitive: true, unicodeNormalization: "none" },
  };
}

function authority() {
  let current = true;
  return {
    invalidate: () => {
      current = false;
    },
    isCurrent: () => current,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("RegisteredWorkspaceCloseCoordinator", () => {
  it("closes synced documents before one exact backend teardown", async () => {
    const owner = authority();
    const prepared = prepareRegisteredWorkspaceClose(
      identity("ws-a", 11, "/alias/a", "/real/a"),
      owner.isCurrent,
    );
    if (prepared.status !== "ready") {
      throw new Error("Expected exact close lease");
    }
    const events: string[] = [];
    const disposeRegisteredWorkspace = vi.fn(async () => {
      events.push("backend");
      return { status: "closed" as const };
    });
    const coordinator = new RegisteredWorkspaceCloseCoordinator(new CloseCoordinator(1_000));

    await expect(
      coordinator.close({
        lease: prepared.lease,
        closeDocuments: [
          async () => {
            events.push("php-did-close");
          },
          async () => {
            events.push("typescript-did-close");
          },
        ],
        disposeRegisteredWorkspace,
      }),
    ).resolves.toEqual({ status: "closed" });

    expect(events).toEqual(["php-did-close", "typescript-did-close", "backend"]);
    expect(disposeRegisteredWorkspace).toHaveBeenCalledOnce();
    expect(disposeRegisteredWorkspace).toHaveBeenCalledWith({
      workspaceId: "ws-a",
      admissionToken: 11,
      selectedRootPath: "/alias/a",
      canonicalRootPath: "/real/a",
    });
  });

  it("keeps A and B exact targets isolated", async () => {
    const coordinator = new RegisteredWorkspaceCloseCoordinator(new CloseCoordinator(1_000));
    const calls: string[] = [];
    const close = async (workspaceId: string, root: string) => {
      const owner = authority();
      const prepared = prepareRegisteredWorkspaceClose(
        identity(workspaceId, workspaceId === "ws-a" ? 1 : 2, root, root),
        owner.isCurrent,
      );
      if (prepared.status !== "ready") {
        throw new Error("Expected exact close lease");
      }
      return coordinator.close({
        lease: prepared.lease,
        closeDocuments: [],
        disposeRegisteredWorkspace: async (target) => {
          calls.push(target.workspaceId);
          return { status: "closed" };
        },
      });
    };

    await expect(close("ws-a", "/a")).resolves.toEqual({ status: "closed" });
    await expect(close("ws-b", "/b")).resolves.toEqual({ status: "closed" });
    expect(calls).toEqual(["ws-a", "ws-b"]);
  });

  it("preserves confirmed A1 backend truth across B and A2 replacement authorities", async () => {
    const ownerA1 = authority();
    const ownerB = authority();
    const ownerA2 = authority();
    const first = prepareRegisteredWorkspaceClose(
      identity("ws-a1", 31, "/a", "/real/a"),
      ownerA1.isCurrent,
    );
    const second = prepareRegisteredWorkspaceClose(
      identity("ws-a2", 32, "/a", "/real/a"),
      ownerA2.isCurrent,
    );
    const workspaceB = prepareRegisteredWorkspaceClose(
      identity("ws-b", 7, "/b", "/real/b"),
      ownerB.isCurrent,
    );
    if (first.status !== "ready" || second.status !== "ready" || workspaceB.status !== "ready") {
      throw new Error("Expected exact close leases");
    }
    const backend = deferred<{ status: "closed" }>();
    const backendStarted = deferred<void>();
    const coordinator = new RegisteredWorkspaceCloseCoordinator(new CloseCoordinator(1_000));
    const closing = coordinator.close({
      lease: first.lease,
      closeDocuments: [],
      disposeRegisteredWorkspace: () => {
        backendStarted.resolve();
        return backend.promise;
      },
    });

    await backendStarted.promise;
    ownerA1.invalidate();
    backend.resolve({ status: "closed" });

    await expect(closing).resolves.toEqual({ status: "closed" });
    expect(workspaceB.lease.isCurrent()).toBe(true);
    expect(second.lease.isCurrent()).toBe(true);
  });

  it("returns bounded backend incompleteness without retrying or duplicating teardown", async () => {
    const owner = authority();
    const prepared = prepareRegisteredWorkspaceClose(
      identity("ws-a", 41, "/alias/a", "/real/a"),
      owner.isCurrent,
    );
    if (prepared.status !== "ready") {
      throw new Error("Expected exact close lease");
    }
    const disposeRegisteredWorkspace = vi.fn(async () => ({
      status: "incomplete" as const,
      errors: ["terminal cleanup failed"],
    }));
    const coordinator = new RegisteredWorkspaceCloseCoordinator(new CloseCoordinator(1_000));

    await expect(
      coordinator.close({
        lease: prepared.lease,
        closeDocuments: [],
        disposeRegisteredWorkspace,
      }),
    ).resolves.toEqual({ status: "incomplete", errors: ["terminal cleanup failed"] });
    expect(disposeRegisteredWorkspace).toHaveBeenCalledOnce();
  });

  it("does not start backend teardown after unmount invalidates a pending document close", async () => {
    const owner = authority();
    const prepared = prepareRegisteredWorkspaceClose(
      identity("ws-a", 51, "/a", "/real/a"),
      owner.isCurrent,
    );
    if (prepared.status !== "ready") {
      throw new Error("Expected exact close lease");
    }
    const documentClose = deferred<void>();
    const disposeRegisteredWorkspace = vi.fn(async () => ({ status: "closed" as const }));
    const coordinator = new RegisteredWorkspaceCloseCoordinator(new CloseCoordinator(1_000));
    const closing = coordinator.close({
      lease: prepared.lease,
      closeDocuments: [() => documentClose.promise],
      disposeRegisteredWorkspace,
    });

    owner.invalidate();
    documentClose.resolve();

    await expect(closing).resolves.toEqual({ status: "stale" });
    expect(disposeRegisteredWorkspace).not.toHaveBeenCalled();
  });

  it("preserves legacy descriptors and rejects malformed exact admissions", () => {
    const legacy = identity("ws-a", 1, "/a", "/real/a");
    delete legacy.admissionToken;
    expect(prepareRegisteredWorkspaceClose(legacy, () => true)).toEqual({ status: "legacy" });
    expect(prepareRegisteredWorkspaceClose({ ...legacy, admissionToken: 0 }, () => true)).toEqual({
      status: "invalid",
    });
  });

  it("reports runtimes retained by other owners after one exact backend close", async () => {
    const prepared = prepareRegisteredWorkspaceClose(
      identity("ws-a", 11, "/alias/a", "/real/a"),
      authority().isCurrent,
    );
    expect(prepared.status).toBe("ready");
    if (prepared.status !== "ready") return;
    const disposeRegisteredWorkspace = vi.fn(async () => ({
      status: "retainedByOtherOwners" as const,
    }));
    const coordinator = new RegisteredWorkspaceCloseCoordinator(new CloseCoordinator(1_000));

    await expect(
      coordinator.close({ lease: prepared.lease, closeDocuments: [], disposeRegisteredWorkspace }),
    ).resolves.toEqual({ status: "retainedByOtherOwners" });
    expect(disposeRegisteredWorkspace).toHaveBeenCalledOnce();
  });

  it("treats a backend close of an already gone workspace as closed", async () => {
    const prepared = prepareRegisteredWorkspaceClose(
      identity("ws-a", 11, "/alias/a", "/real/a"),
      authority().isCurrent,
    );
    expect(prepared.status).toBe("ready");
    if (prepared.status !== "ready") return;
    const disposeRegisteredWorkspace = vi.fn(async () => ({ status: "unknownWorkspace" as const }));
    const coordinator = new RegisteredWorkspaceCloseCoordinator(new CloseCoordinator(1_000));

    await expect(
      coordinator.close({ lease: prepared.lease, closeDocuments: [], disposeRegisteredWorkspace }),
    ).resolves.toEqual({ status: "closed" });
  });

  it("retries a releasing backend close on a backoff timer until it settles", async () => {
    vi.useFakeTimers();
    try {
      const prepared = prepareRegisteredWorkspaceClose(
        identity("ws-a", 11, "/alias/a", "/real/a"),
        authority().isCurrent,
      );
      expect(prepared.status).toBe("ready");
      if (prepared.status !== "ready") return;
      const statuses = ["releasing", "releasing", "closed"] as const;
      let call = 0;
      const disposeRegisteredWorkspace = vi.fn(async () => ({ status: statuses[call++]! }));
      const coordinator = new RegisteredWorkspaceCloseCoordinator(new CloseCoordinator(1_000));

      const closing = coordinator.close({
        lease: prepared.lease,
        closeDocuments: [],
        disposeRegisteredWorkspace,
      });
      await vi.advanceTimersByTimeAsync(WORKSPACE_RELEASE_RETRY_DELAYS_MS[0]! - 1);
      expect(disposeRegisteredWorkspace).toHaveBeenCalledOnce();
      await vi.runAllTimersAsync();

      await expect(closing).resolves.toEqual({ status: "closed" });
      expect(disposeRegisteredWorkspace).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a truthful incomplete close when the backend stays releasing past the bound", async () => {
    vi.useFakeTimers();
    try {
      const prepared = prepareRegisteredWorkspaceClose(
        identity("ws-a", 11, "/alias/a", "/real/a"),
        authority().isCurrent,
      );
      expect(prepared.status).toBe("ready");
      if (prepared.status !== "ready") return;
      const disposeRegisteredWorkspace = vi.fn(async () => ({ status: "releasing" as const }));
      const coordinator = new RegisteredWorkspaceCloseCoordinator(new CloseCoordinator(1_000));

      const closing = coordinator.close({
        lease: prepared.lease,
        closeDocuments: [],
        disposeRegisteredWorkspace,
      });
      await vi.runAllTimersAsync();

      await expect(closing).resolves.toEqual({
        status: "incomplete",
        errors: [WORKSPACE_RELEASE_STILL_IN_PROGRESS],
      });
      expect(disposeRegisteredWorkspace).toHaveBeenCalledTimes(
        WORKSPACE_RELEASE_RETRY_DELAYS_MS.length + 1,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops retrying a releasing close once the close lease is no longer current", async () => {
    const owner = authority();
    const prepared = prepareRegisteredWorkspaceClose(
      identity("ws-a", 11, "/alias/a", "/real/a"),
      owner.isCurrent,
    );
    expect(prepared.status).toBe("ready");
    if (prepared.status !== "ready") return;
    const disposeRegisteredWorkspace = vi.fn(async () => {
      owner.invalidate();
      return { status: "releasing" as const };
    });
    const coordinator = new RegisteredWorkspaceCloseCoordinator(
      new CloseCoordinator(1_000),
      async () => undefined,
    );

    await expect(
      coordinator.close({ lease: prepared.lease, closeDocuments: [], disposeRegisteredWorkspace }),
    ).resolves.toEqual({ status: "stale" });
    expect(disposeRegisteredWorkspace).toHaveBeenCalledOnce();
  });
});
