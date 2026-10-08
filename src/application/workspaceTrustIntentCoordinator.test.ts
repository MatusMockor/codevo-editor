import { describe, expect, it, vi } from "vitest";
import type { WorkspaceTrustGateway } from "../domain/trust";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import {
  openedProjectRevocation,
  WorkspaceTrustIntentCoordinator,
} from "./workspaceTrustIntentCoordinator";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("WorkspaceTrustIntentCoordinator", () => {
  it("serializes writes per owner and persists the latest requested intent", async () => {
    const coordinator = new WorkspaceTrustIntentCoordinator();
    const owner = createWorkspaceRuntimeOwner("workspace-1", "/workspace");
    const grant = deferred<{ rootPath: string; trusted: boolean }>();
    const gateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(),
      setTrust: vi
        .fn()
        .mockImplementationOnce(() => grant.promise)
        .mockImplementationOnce(async (rootPath, trusted) => ({
          rootPath,
          trusted,
        })),
    };

    coordinator.request(owner, "/workspace", true);
    const firstPersistence = coordinator.persist(owner.ownerKey, gateway);
    coordinator.request(owner, "/workspace", false);
    const sharedPersistence = coordinator.persist(owner.ownerKey, gateway);

    expect(sharedPersistence).toBe(firstPersistence);
    expect(gateway.setTrust).toHaveBeenCalledExactlyOnceWith("/workspace", true);

    grant.resolve({ rootPath: "/workspace", trusted: true });

    await expect(firstPersistence).resolves.toMatchObject({
      intent: { trusted: false },
      trust: { rootPath: "/workspace", trusted: false },
    });
    expect(gateway.setTrust).toHaveBeenLastCalledWith("/workspace", false);
  });

  it("scopes desired trust to the exact owner execution root and requested root", () => {
    const coordinator = new WorkspaceTrustIntentCoordinator();
    const owner = createWorkspaceRuntimeOwner("workspace-1", "/workspace");
    coordinator.request(owner, "/workspace", true);

    expect(coordinator.desiredTrust(owner, "/workspace")).toBe(true);
    expect(
      coordinator.desiredTrust(
        createWorkspaceRuntimeOwner("workspace-1", "/replacement"),
        "/workspace",
      ),
    ).toBeNull();
    expect(coordinator.desiredTrust(owner, "/other")).toBeNull();

    coordinator.release(owner.ownerKey);
    expect(coordinator.desiredTrust(owner, "/workspace")).toBeNull();
  });

  it("allows retrying the current intent after persistence fails", async () => {
    const coordinator = new WorkspaceTrustIntentCoordinator();
    const owner = createWorkspaceRuntimeOwner("workspace-1", "/workspace");
    const gateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(),
      setTrust: vi
        .fn()
        .mockRejectedValueOnce(new Error("trust store unavailable"))
        .mockImplementationOnce(async (rootPath, trusted) => ({
          rootPath,
          trusted,
        })),
    };
    coordinator.request(owner, "/workspace", true);

    await expect(coordinator.persist(owner.ownerKey, gateway)).rejects.toThrow(
      "trust store unavailable",
    );

    const retry = coordinator.request(owner, "/workspace", true);
    await expect(coordinator.persist(owner.ownerKey, gateway)).resolves.toEqual({
      intent: retry,
      trust: { rootPath: "/workspace", trusted: true },
    });
  });

  it("revokes an opened project through its captured identity instead of its path", async () => {
    const coordinator = new WorkspaceTrustIntentCoordinator();
    const owner = createWorkspaceRuntimeOwner("workspace-1", "/alias");
    const opened = { workspaceId: "workspace-1", admissionToken: 7, canonicalRoot: "/real" };
    const gateway = {
      getTrust: vi.fn(),
      setTrust: vi.fn(async (rootPath: string, trusted: boolean) => ({ rootPath, trusted })),
      revokeOpenedProject: vi.fn(async () => ({ rootPath: "/real", trusted: false })),
    } satisfies WorkspaceTrustGateway;

    const revocation = coordinator.request(owner, "/alias", false, opened);
    await expect(coordinator.persist(owner.ownerKey, gateway)).resolves.toEqual({
      intent: revocation,
      trust: { rootPath: "/real", trusted: false },
    });
    expect(gateway.revokeOpenedProject).toHaveBeenCalledExactlyOnceWith(opened);
    expect(gateway.setTrust).not.toHaveBeenCalled();

    coordinator.request(owner, "/alias", true, opened);
    await coordinator.persist(owner.ownerKey, gateway);
    expect(gateway.setTrust).toHaveBeenCalledExactlyOnceWith("/alias", true);
    expect(gateway.revokeOpenedProject).toHaveBeenCalledTimes(1);
  });

  it("revokes by path only when no identity was captured or the gateway cannot use one", async () => {
    const coordinator = new WorkspaceTrustIntentCoordinator();
    const owner = createWorkspaceRuntimeOwner("workspace-1", "/workspace");
    const opened = { workspaceId: "workspace-1", admissionToken: 7, canonicalRoot: "/workspace" };
    const identityGateway = {
      getTrust: vi.fn(),
      setTrust: vi.fn(async (rootPath: string, trusted: boolean) => ({ rootPath, trusted })),
      revokeOpenedProject: vi.fn(),
    } satisfies WorkspaceTrustGateway;
    const pathGateway = {
      getTrust: vi.fn(),
      setTrust: vi.fn(async (rootPath: string, trusted: boolean) => ({ rootPath, trusted })),
    } satisfies WorkspaceTrustGateway;

    coordinator.request(owner, "/workspace", false);
    await coordinator.persist(owner.ownerKey, identityGateway);
    coordinator.request(owner, "/workspace", false, opened);
    await coordinator.persist(owner.ownerKey, pathGateway);

    expect(identityGateway.setTrust).toHaveBeenCalledExactlyOnceWith("/workspace", false);
    expect(identityGateway.revokeOpenedProject).not.toHaveBeenCalled();
    expect(pathGateway.setTrust).toHaveBeenCalledExactlyOnceWith("/workspace", false);
  });

  it("reports a rejected identity without falling back to the path", async () => {
    const coordinator = new WorkspaceTrustIntentCoordinator();
    const owner = createWorkspaceRuntimeOwner("workspace-1", "/workspace");
    const opened = { workspaceId: "workspace-1", admissionToken: 7, canonicalRoot: "/workspace" };
    const gateway = {
      getTrust: vi.fn(),
      setTrust: vi.fn(),
      revokeOpenedProject: vi.fn().mockRejectedValue(new Error("identity was replaced")),
    } satisfies WorkspaceTrustGateway;

    coordinator.request(owner, "/workspace", false, opened);

    await expect(coordinator.persist(owner.ownerKey, gateway)).rejects.toThrow(
      "identity was replaced",
    );
    expect(gateway.setTrust).not.toHaveBeenCalled();
    expect(coordinator.desiredTrust(owner, "/workspace")).toBeNull();
  });

  it("captures the identity only for the exact admitted owner", () => {
    const owner = createWorkspaceRuntimeOwner("workspace-1", "/alias");
    const identity = { workspaceId: "workspace-1", admissionToken: 7, canonicalRoot: "/real" };

    expect(openedProjectRevocation(identity, owner)).toEqual({
      workspaceId: "workspace-1",
      admissionToken: 7,
      canonicalRoot: "/real",
    });
    const widerDescriptor = { ...identity, selectedPath: "/alias" };
    expect(openedProjectRevocation(widerDescriptor, owner)).toEqual(identity);
    expect(openedProjectRevocation(null, owner)).toBeNull();
    expect(openedProjectRevocation({ ...identity, workspaceId: "workspace-2" }, owner)).toBeNull();
    expect(
      openedProjectRevocation({ workspaceId: "workspace-1", canonicalRoot: "/real" }, owner),
    ).toBeNull();
  });
});
