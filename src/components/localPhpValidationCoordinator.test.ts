import { describe, expect, it, vi } from "vitest";
import { LocalPhpValidationCoordinator } from "./localPhpValidationCoordinator";

describe("LocalPhpValidationCoordinator", () => {
  it("runs one validation for a shared model snapshot and fans out the result", async () => {
    const coordinator = new LocalPhpValidationCoordinator<string, string>();
    const validate = vi.fn(() => ({
      immediate: "immediate",
      result: Promise.resolve("validated"),
    }));
    const request = snapshot({ consumerId: "left" });

    const left = coordinator.coordinate(request, validate);
    const right = coordinator.coordinate(
      { ...request, consumerId: "right" },
      validate,
    );

    expect(validate).toHaveBeenCalledOnce();
    expect(left.immediate).toBe("immediate");
    expect(right.immediate).toBe("immediate");
    await expect(left.result).resolves.toBe("validated");
    await expect(right.result).resolves.toBe("validated");
  });

  it.each([
    ["documentPath", "/workspace/other.php"],
    ["workspaceRoot", "/other-workspace"],
    ["content", "<?php echo 2;"],
    ["version", 2],
  ] as const)("does not dedupe a different %s", (field, value) => {
    const coordinator = new LocalPhpValidationCoordinator<string, string>();
    const validate = vi.fn(() => ({
      immediate: "immediate",
      result: Promise.resolve("validated"),
    }));
    const request = snapshot({ consumerId: "left" });

    coordinator.coordinate(request, validate);
    coordinator.coordinate(
      { ...request, consumerId: "right", [field]: value },
      validate,
    );

    expect(validate).toHaveBeenCalledTimes(2);
  });

  it("rejects a stale result after a consumer switches model content", async () => {
    const coordinator = new LocalPhpValidationCoordinator<string, string>();
    let resolveFirst!: (value: string) => void;
    const firstResult = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const first = coordinator.coordinate(snapshot({ consumerId: "left" }), () => ({
      immediate: "first immediate",
      result: firstResult,
    }));

    const current = coordinator.coordinate(
      snapshot({ consumerId: "left", content: "<?php echo 2;", version: 2 }),
      () => ({
        immediate: "current immediate",
        result: Promise.resolve("current"),
      }),
    );
    resolveFirst("stale");

    await expect(first.result).resolves.toBeNull();
    await expect(current.result).resolves.toBe("current");
  });

  it("does not retain a failed validation so the same snapshot can retry", async () => {
    const coordinator = new LocalPhpValidationCoordinator<string, string>();
    const validate = vi
      .fn()
      .mockReturnValueOnce({
        immediate: "immediate",
        result: Promise.reject(new Error("parser unavailable")),
      })
      .mockReturnValueOnce({
        immediate: "immediate",
        result: Promise.resolve("recovered"),
      });
    const request = snapshot({ consumerId: "left" });

    await expect(
      coordinator.coordinate(request, validate).result,
    ).rejects.toThrow("parser unavailable");
    await expect(
      coordinator.coordinate(request, validate).result,
    ).resolves.toBe("recovered");
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it("rejects pending results and clears retained work on teardown", async () => {
    const coordinator = new LocalPhpValidationCoordinator<string, string>();
    let resolve!: (value: string) => void;
    const pending = coordinator.coordinate(snapshot({ consumerId: "left" }), () => ({
      immediate: "immediate",
      result: new Promise<string>((pendingResolve) => {
        resolve = pendingResolve;
      }),
    }));

    coordinator.dispose();
    resolve("late");

    await expect(pending.result).resolves.toBeNull();
    expect(coordinator.size).toBe(0);
  });

  it("retains shared work until the last pane releases it", () => {
    const coordinator = new LocalPhpValidationCoordinator<string, string>();
    const validate = () => ({
      immediate: "immediate",
      result: Promise.resolve("validated"),
    });
    const request = snapshot({ consumerId: "left" });
    coordinator.coordinate(request, validate);
    coordinator.coordinate({ ...request, consumerId: "right" }, validate);

    coordinator.releaseConsumer("left");
    expect(coordinator.size).toBe(1);
    coordinator.releaseConsumer("right");
    expect(coordinator.size).toBe(0);
  });
});

function snapshot(
  overrides: Partial<{
    consumerId: string;
    content: string;
    documentPath: string;
    modelUri: string;
    version: number;
    workspaceRoot: string;
  }> = {},
) {
  return {
    consumerId: "surface",
    content: "<?php echo 1;",
    documentPath: "/workspace/shared.php",
    modelUri: "file:///workspace/shared.php",
    version: 1,
    workspaceRoot: "/workspace",
    ...overrides,
  };
}
