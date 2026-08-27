import { describe, expect, it, vi } from "vitest";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";
import { CloseCoordinator } from "./closeCoordinator";
import {
  prepareRegisteredWorkspaceClose,
  RegisteredWorkspaceCloseCoordinator,
} from "./registeredWorkspaceCloseCoordinator";

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
});
