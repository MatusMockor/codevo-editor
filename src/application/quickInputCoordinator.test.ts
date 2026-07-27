import { describe, expect, it, vi } from "vitest";
import { QuickInputCoordinator } from "./quickInputCoordinator";

describe("QuickInputCoordinator", () => {
  it("serializes requests and settles each request exactly once", async () => {
    const coordinator = new QuickInputCoordinator();
    const listener = vi.fn();
    coordinator.subscribe(listener);

    const first = coordinator.prompt("First", "one");
    const firstRequest = coordinator.getSnapshot();
    const second = coordinator.prompt("Second", "two");

    expect(firstRequest).toEqual({ defaultValue: "one", message: "First" });
    coordinator.resolveActive(firstRequest!, "chosen");

    const secondRequest = coordinator.getSnapshot();
    expect(secondRequest).toEqual({ defaultValue: "two", message: "Second" });
    coordinator.resolveActive(firstRequest!, "stale");
    coordinator.resolveActive(secondRequest!, null);

    await expect(first).resolves.toBe("chosen");
    await expect(second).resolves.toBeNull();
    expect(coordinator.getSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("cancels the active and queued requests when their host scope is lost", async () => {
    const coordinator = new QuickInputCoordinator();
    const first = coordinator.prompt("First");
    const second = coordinator.prompt("Second");

    coordinator.cancelAll();

    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();
    expect(coordinator.getSnapshot()).toBeNull();
  });

  it("does not let an obsolete StrictMode host cleanup cancel a replacement host", async () => {
    const coordinator = new QuickInputCoordinator();
    const releaseFirstHost = coordinator.acquireHostLease();
    coordinator.acquireHostLease();
    const pending = coordinator.prompt("Name");

    releaseFirstHost();
    await Promise.resolve();
    expect(coordinator.getSnapshot()?.message).toBe("Name");

    coordinator.cancelAll();
    await expect(pending).resolves.toBeNull();
  });

  it("bounds queued input requests", async () => {
    const coordinator = new QuickInputCoordinator();
    const requests = Array.from({ length: 18 }, (_, index) =>
      coordinator.prompt(`Request ${index}`),
    );

    await expect(requests[16]).resolves.toBeNull();
    await expect(requests[17]).resolves.toBeNull();
    coordinator.cancelAll();
    await expect(Promise.all(requests.slice(0, 16))).resolves.toEqual(
      Array.from({ length: 16 }, () => null),
    );
  });

  it("rejects oversized request metadata instead of retaining it", async () => {
    const coordinator = new QuickInputCoordinator();

    await expect(coordinator.prompt("x".repeat(257))).rejects.toThrow(
      "message must contain 1-256 characters",
    );
    await expect(coordinator.prompt("Name", "x".repeat(4097))).rejects.toThrow(
      "default value must not exceed 4096 characters",
    );
    expect(coordinator.getSnapshot()).toBeNull();
  });

  it("fails a pending request closed across an exact workspace owner replacement", async () => {
    const coordinator = new QuickInputCoordinator();
    coordinator.setWorkspaceScope("owner-a");
    const pending = coordinator.prompt("Name");
    const staleRequest = coordinator.getSnapshot();

    coordinator.setWorkspaceScope("owner-b");
    coordinator.setWorkspaceScope("owner-a-reopened");
    coordinator.resolveActive(staleRequest!, "stale");

    await expect(pending).resolves.toBeNull();
    expect(coordinator.getSnapshot()).toBeNull();
  });
});
