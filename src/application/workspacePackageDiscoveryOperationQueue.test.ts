import { describe, expect, it, vi } from "vitest";
import {
  MAX_PHYSICAL_WORKSPACE_PACKAGE_DISCOVERY_OPERATIONS,
  WorkspacePackageDiscoveryOperationQueue,
} from "./workspacePackageDiscoveryOperationQueue";

describe("WorkspacePackageDiscoveryOperationQueue", () => {
  it("never exceeds four physical operations during a 1,000-request cancellation storm", async () => {
    const queue = new WorkspacePackageDiscoveryOperationQueue();
    const releases: Array<() => void> = [];
    let active = 0;
    let maximumActive = 0;
    const physical = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          releases.push(() => {
            active -= 1;
            resolve();
          });
        }),
    );

    const retained = Array.from(
      { length: MAX_PHYSICAL_WORKSPACE_PACKAGE_DISCOVERY_OPERATIONS },
      () => queue.run(physical, new AbortController().signal),
    );
    const cancelled = Array.from({ length: 1_000 }, () => {
      const controller = new AbortController();
      const result = queue
        .run(physical, controller.signal)
        .catch((error: unknown) => (error as DOMException).name);
      controller.abort();
      return result;
    });
    await expect(Promise.all(cancelled)).resolves.toEqual(Array(1_000).fill("AbortError"));

    expect(physical).toHaveBeenCalledTimes(MAX_PHYSICAL_WORKSPACE_PACKAGE_DISCOVERY_OPERATIONS);
    expect(maximumActive).toBe(MAX_PHYSICAL_WORKSPACE_PACKAGE_DISCOVERY_OPERATIONS);

    for (const release of releases) release();
    await Promise.all(retained);
  });

  it("retains a physical slot after logical abort until the underlying operation settles", async () => {
    const queue = new WorkspacePackageDiscoveryOperationQueue();
    const controllers = Array.from(
      { length: MAX_PHYSICAL_WORKSPACE_PACKAGE_DISCOVERY_OPERATIONS },
      () => new AbortController(),
    );
    const releases: Array<() => void> = [];
    const physical = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve);
        }),
    );
    const active = controllers.map((controller) =>
      queue.run(physical, controller.signal).catch(() => undefined),
    );
    controllers.forEach((controller) => controller.abort());

    const replacement = queue.run(physical, new AbortController().signal);
    await Promise.resolve();
    expect(physical).toHaveBeenCalledTimes(MAX_PHYSICAL_WORKSPACE_PACKAGE_DISCOVERY_OPERATIONS);

    releases[0]?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(physical).toHaveBeenCalledTimes(MAX_PHYSICAL_WORKSPACE_PACKAGE_DISCOVERY_OPERATIONS + 1);

    releases.slice(1).forEach((release) => release());
    await Promise.all([...active, replacement]);
  });
});
