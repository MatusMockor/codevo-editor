// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { MAX_WORKSPACE_GLOB_MATCH_OPERATIONS } from "../domain/workspacePackageGraph";
import {
  processWorkspacePackageGraph,
  WORKSPACE_PACKAGE_PROCESSING_LIMITS,
  type WorkspacePackageManifestSource,
  type WorkspacePackageProcessingRuntime,
} from "./workspacePackageGraphProcessing";

describe("workspace package graph processing", () => {
  it("time-slices a realistic near-limit monorepo instead of parsing it in one UI turn", async () => {
    const sources = realisticMonorepoSources(64, 192 * 1024);
    let yields = 0;
    let sliceStartedAt = performance.now();
    let longestSliceMs = 0;
    const runtime: WorkspacePackageProcessingRuntime = {
      now: () => performance.now(),
      yieldToMainThread: async () => {
        const now = performance.now();
        longestSliceMs = Math.max(longestSliceMs, now - sliceStartedAt);
        sliceStartedAt = now;
        yields += 1;
      },
    };

    const result = await processWorkspacePackageGraph(
      {
        authorityComplete: true,
        manifestSources: sources,
        pnpmWorkspaceYaml: undefined,
      },
      new AbortController().signal,
      runtime,
    );

    expect(result.timedOut).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.packages).toHaveLength(63);
    expect(result.manifests).toHaveLength(64);
    expect(sources.reduce((total, input) => total + input.utf8Bytes, 0)).toBeGreaterThanOrEqual(
      12 * 1024 * 1024,
    );
    expect(yields).toBeGreaterThanOrEqual(64);
    expect(longestSliceMs).toBeLessThan(50);
    expect(WORKSPACE_PACKAGE_PROCESSING_LIMITS).toEqual({
      maxDurationMs: 2_000,
      maxManifestBytesPerSlice: 256 * 1024,
      maxManifestsPerSlice: 8,
      maxSliceMs: 4,
    });
  });

  it("bounds an adversarial 256-package graph to a frame-safe operation slice", async () => {
    const patterns = [
      "packages/*",
      ...Array.from({ length: 127 }, (_, index) => `unmatched-${index}/**`),
    ];
    const sources = Array.from({ length: 256 }, (_, index) =>
      source(
        index === 0 ? "" : `packages/package-${index}`,
        index === 0
          ? JSON.stringify({ name: "root", workspaces: patterns })
          : JSON.stringify({ name: `@repo/package-${index}` }),
      ),
    );
    const phaseDurations: number[] = [];
    let phaseStartedAt = performance.now();
    const runtime: WorkspacePackageProcessingRuntime = {
      now: () => performance.now(),
      yieldToMainThread: async () => {
        const now = performance.now();
        phaseDurations.push(now - phaseStartedAt);
        phaseStartedAt = now;
      },
    };

    const result = await processWorkspacePackageGraph(
      {
        authorityComplete: true,
        manifestSources: sources,
        pnpmWorkspaceYaml: undefined,
      },
      new AbortController().signal,
      runtime,
    );

    const graphPhaseMs = phaseDurations[phaseDurations.length - 1] ?? Number.POSITIVE_INFINITY;
    expect(MAX_WORKSPACE_GLOB_MATCH_OPERATIONS).toBe(4_096);
    expect(result.truncated).toBe(true);
    expect(graphPhaseMs).toBeLessThan(WORKSPACE_PACKAGE_PROCESSING_LIMITS.maxSliceMs);
  });

  it("cancels exactly at a slice boundary without continuing stale parsing", async () => {
    const controller = new AbortController();
    let yields = 0;
    const runtime: WorkspacePackageProcessingRuntime = {
      now: () => 0,
      yieldToMainThread: async () => {
        yields += 1;
        controller.abort();
      },
    };

    await expect(
      processWorkspacePackageGraph(
        {
          authorityComplete: true,
          manifestSources: realisticMonorepoSources(32, 64 * 1024),
          pnpmWorkspaceYaml: undefined,
        },
        controller.signal,
        runtime,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(yields).toBe(1);
  });

  it("publishes a truthful bounded partial result when the CPU deadline expires", async () => {
    let clock = 0;
    const runtime: WorkspacePackageProcessingRuntime = {
      now: () => clock,
      yieldToMainThread: async () => {
        clock = WORKSPACE_PACKAGE_PROCESSING_LIMITS.maxDurationMs;
      },
    };

    const result = await processWorkspacePackageGraph(
      {
        authorityComplete: true,
        manifestSources: realisticMonorepoSources(6, 192 * 1024),
        pnpmWorkspaceYaml: undefined,
      },
      new AbortController().signal,
      runtime,
    );

    expect(result).toEqual(
      expect.objectContaining({
        incompleteDirectories: [
          "packages/package-1",
          "packages/package-2",
          "packages/package-3",
          "packages/package-4",
          "packages/package-5",
        ],
        packages: [],
        timedOut: true,
        truncated: true,
      }),
    );
    expect(result.manifests).toHaveLength(1);
  });

  it("keeps malformed package authority scoped and refuses a complete graph", async () => {
    const result = await processWorkspacePackageGraph(
      {
        authorityComplete: true,
        manifestSources: [
          source("", '{"name":"root","workspaces":["packages/*"]}'),
          source("packages/good", '{"name":"@repo/good"}'),
          source("packages/bad", '{"name":"@repo/bad",}'),
        ],
        pnpmWorkspaceYaml: undefined,
      },
      new AbortController().signal,
      immediateRuntime(),
    );

    expect(result.incompleteDirectories).toEqual(["packages/bad"]);
    expect(result.manifests).toHaveLength(2);
    expect(result.packages).toEqual([]);
    expect(result.truncated).toBe(true);
  });

  it("uses a real browser task boundary before settling with the default runtime", async () => {
    let browserTaskRan = false;
    window.setTimeout(() => {
      browserTaskRan = true;
    }, 0);

    const result = await processWorkspacePackageGraph(
      {
        authorityComplete: true,
        manifestSources: [source("", '{"name":"root"}')],
        pnpmWorkspaceYaml: undefined,
      },
      new AbortController().signal,
    );

    expect(browserTaskRan).toBe(true);
    expect(result.timedOut).toBe(false);
  });

  it("rejects caller-supplied count and byte metadata before parsing", async () => {
    const tooMany = Array.from({ length: 257 }, (_, index) =>
      source(`packages/package-${index}`, `{"name":"package-${index}"}`),
    );
    const countResult = await processWorkspacePackageGraph(
      {
        authorityComplete: true,
        manifestSources: tooMany,
        pnpmWorkspaceYaml: undefined,
      },
      new AbortController().signal,
      immediateRuntime(),
    );
    expect(countResult).toEqual(
      expect.objectContaining({
        manifests: [],
        packages: [],
        truncated: true,
      }),
    );

    const liedAboutBytes = {
      relativeDirPath: "",
      source: `{"name":"root","description":"${"é".repeat(140 * 1024)}"}`,
      utf8Bytes: 1,
    };
    const bytesResult = await processWorkspacePackageGraph(
      {
        authorityComplete: true,
        manifestSources: [liedAboutBytes],
        pnpmWorkspaceYaml: undefined,
      },
      new AbortController().signal,
      immediateRuntime(),
    );
    expect(bytesResult.incompleteDirectories).toEqual([""]);
    expect(bytesResult.manifests).toEqual([]);
  });
});

function realisticMonorepoSources(
  count: number,
  approximateManifestBytes: number,
): readonly WorkspacePackageManifestSource[] {
  return Array.from({ length: count }, (_, index) => {
    const relativeDirPath = index === 0 ? "" : `packages/package-${index}`;
    const fixed =
      index === 0
        ? '{"name":"root","workspaces":["packages/*"],"description":""}'
        : `{"name":"@repo/package-${index}","description":""}`;
    const sourceText = fixed.replace(
      '""}',
      `"${"x".repeat(approximateManifestBytes - fixed.length)}"}`,
    );
    return source(relativeDirPath, sourceText);
  });
}

function source(relativeDirPath: string, sourceText: string): WorkspacePackageManifestSource {
  return {
    relativeDirPath,
    source: sourceText,
    utf8Bytes: new TextEncoder().encode(sourceText).length,
  };
}

function immediateRuntime(): WorkspacePackageProcessingRuntime {
  return {
    now: () => 0,
    yieldToMainThread: () => Promise.resolve(),
  };
}
