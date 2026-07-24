import { describe, expect, it, vi } from "vitest";
import type { WorkspaceTrustGateway } from "../domain/trust";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import { WorkspaceTrustIntentCoordinator } from "./workspaceTrustIntentCoordinator";

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
});
