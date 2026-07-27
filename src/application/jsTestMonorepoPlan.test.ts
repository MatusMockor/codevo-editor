import { describe, expect, it, vi } from "vitest";
import type { JsTestExplorerTestDiscovery } from "../domain/jsTestExplorerTree";
import { jsTestMonorepoPlan } from "./jsTestMonorepoPlan";
import type { JsTestExecutionRootResolver } from "./jsTestExecutionRootResolver";

describe("jsTestMonorepoPlan", () => {
  it("deduplicates and freezes sibling Jest/Vitest package roots deterministically", async () => {
    const resolveExecutionRoot = vi.fn<JsTestExecutionRootResolver>(async (scope) => ({
      packageRootRelativePath:
        scope.kind !== "all" && scope.relativeFilePath.includes("vitest")
          ? "packages/vitest-app"
          : "packages/jest-app",
    }));

    const plan = await jsTestMonorepoPlan({
      discoveries: [
        discovery("packages/vitest-app/b.test.ts"),
        discovery("packages/jest-app/a.test.ts"),
        discovery("packages/vitest-app/a.test.ts"),
      ],
      discoveryTruncated: false,
      resolveExecutionRoot,
    });

    expect(plan).toEqual({
      packages: [
        { packageRootRelativePath: "packages/jest-app" },
        { packageRootRelativePath: "packages/vitest-app" },
      ],
      status: "available",
    });
    expect(Object.isFrozen(plan)).toBe(true);
    if (plan.status === "available") {
      expect(Object.isFrozen(plan.packages)).toBe(true);
      expect(plan.packages.every(Object.isFrozen)).toBe(true);
    }
  });

  it("fails closed for truncated discovery, ninth root, and nested authority replacement", async () => {
    await expect(
      jsTestMonorepoPlan({
        discoveries: [discovery("a.test.ts")],
        discoveryTruncated: true,
        resolveExecutionRoot: async () => ({ packageRootRelativePath: "" }),
      }),
    ).resolves.toEqual({ reason: "discovery-truncated", status: "unavailable" });

    let index = 0;
    await expect(
      jsTestMonorepoPlan({
        discoveries: Array.from({ length: 9 }, (_, item) => discovery(`${item}/a.test.ts`)),
        discoveryTruncated: false,
        resolveExecutionRoot: async () => ({
          packageRootRelativePath: `packages/${index++}`,
        }),
      }),
    ).resolves.toEqual({ reason: "package-overflow", status: "unavailable" });

    await expect(
      jsTestMonorepoPlan({
        discoveries: [discovery("a.test.ts"), discovery("nested/b.test.ts")],
        discoveryTruncated: false,
        resolveExecutionRoot: async (scope) => ({
          packageRootRelativePath:
            scope.kind !== "all" && scope.relativeFilePath.startsWith("nested/")
              ? "packages/a/nested"
              : "packages/a",
        }),
      }),
    ).resolves.toEqual({ reason: "invalid-discovery", status: "unavailable" });
  });

  it("creates a root fallback plan when discovery is exactly empty", async () => {
    await expect(
      jsTestMonorepoPlan({
        discoveries: [],
        discoveryTruncated: false,
        resolveExecutionRoot: async () => ({ packageRootRelativePath: "" }),
      }),
    ).resolves.toEqual({
      packages: [{ packageRootRelativePath: "" }],
      status: "available",
    });
  });

  it("plans package roots from bounded discovered files even when source declarations are empty", async () => {
    await expect(
      jsTestMonorepoPlan({
        discoveries: [],
        discoveryTruncated: false,
        filePaths: ["packages/a/dynamic.test.ts", "packages/b/generated.test.ts"],
        resolveExecutionRoot: async (scope) => ({
          packageRootRelativePath:
            scope.kind !== "all" && scope.relativeFilePath.startsWith("packages/a/")
              ? "packages/a"
              : "packages/b",
        }),
      }),
    ).resolves.toEqual({
      packages: [
        { packageRootRelativePath: "packages/a" },
        { packageRootRelativePath: "packages/b" },
      ],
      status: "available",
    });
  });

  it("caps discovered inputs and resolves package roots with bounded concurrency", async () => {
    await expect(
      jsTestMonorepoPlan({
        discoveries: [],
        discoveryTruncated: false,
        filePaths: Array.from({ length: 501 }, (_, index) => `${index}/a.test.ts`),
        resolveExecutionRoot: async () => ({ packageRootRelativePath: "packages/a" }),
      }),
    ).resolves.toEqual({ reason: "file-overflow", status: "unavailable" });

    let active = 0;
    let peak = 0;
    const plan = await jsTestMonorepoPlan({
      discoveries: [],
      discoveryTruncated: false,
      filePaths: Array.from({ length: 12 }, (_, index) => `src/${index}/a.test.ts`),
      resolveExecutionRoot: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        return { packageRootRelativePath: "packages/a" };
      },
    });

    expect(plan.status).toBe("available");
    expect(peak).toBe(4);
  });

  it("stops iterating discoveries at the 500-file sentinel without materializing the array", async () => {
    let visited = 0;
    const source = Array.from({ length: 1_000 }, (_, index) => discovery(`${index}/a.test.ts`));
    const discoveries = new Proxy(source, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) {
          visited += 1;
          if (Number(property) > 500) throw new Error("read past bounded sentinel");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    await expect(
      jsTestMonorepoPlan({
        discoveries,
        discoveryTruncated: false,
        resolveExecutionRoot: async () => ({ packageRootRelativePath: "packages/a" }),
      }),
    ).resolves.toEqual({ reason: "file-overflow", status: "unavailable" });
    expect(visited).toBe(501);
  });

  it("resolves one immutable authority representative per directory", async () => {
    const resolveExecutionRoot = vi.fn<JsTestExecutionRootResolver>(async () => ({
      packageRootRelativePath: "packages/a",
    }));

    const plan = await jsTestMonorepoPlan({
      discoveries: [],
      discoveryTruncated: false,
      filePaths: Array.from({ length: 500 }, (_, index) => `packages/a/tests/${index}.test.ts`),
      resolveExecutionRoot,
    });

    expect(plan.status).toBe("available");
    expect(resolveExecutionRoot).toHaveBeenCalledTimes(1);
  });

  it("stops resolving between bounded waves when the planning generation becomes stale", async () => {
    let current = true;
    const resolveExecutionRoot = vi.fn<JsTestExecutionRootResolver>(async () => {
      current = false;
      return { packageRootRelativePath: "packages/a" };
    });

    await expect(
      jsTestMonorepoPlan({
        discoveries: [],
        discoveryTruncated: false,
        filePaths: Array.from({ length: 500 }, (_, index) => `dir-${index}/a.test.ts`),
        isCurrent: () => current,
        resolveExecutionRoot,
      }),
    ).resolves.toEqual({ reason: "stale", status: "unavailable" });

    expect(resolveExecutionRoot).toHaveBeenCalledTimes(4);
  });
});

function discovery(filePath: string): JsTestExplorerTestDiscovery {
  return {
    filePath,
    suitePath: ["suite"],
    target: {
      filter: "works",
      kind: "method",
      label: "Run test",
      match: "description",
      position: { column: 1, lineNumber: 1 },
    },
  };
}
