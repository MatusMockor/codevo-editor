import path from "node:path";
import { describe, expect, it } from "vitest";
import { shapeRunResult } from "./perfScenarios.mjs";
import {
  buildRunnerOptions,
  buildSnippetExpression,
  evaluateRunOutcome,
  failedPathsMessage,
  hasEmptyNonSkippedScenario,
  parseManualResult,
  resultFileName,
  scenarioSummary,
  smokeValidationFailure,
} from "./runPerfScenariosCli.mjs";

describe("buildRunnerOptions", () => {
  it("resolves fixture roots to absolute paths under the given repo root", () => {
    const repoRoot = "/repo/root";
    const options = buildRunnerOptions({ smoke: false, repoRoot });

    expect(options.largeFilesRoot).toBe(path.join(repoRoot, "perf/fixtures/large-files"));
    expect(options.monorepoRoot).toBe(path.join(repoRoot, "perf/fixtures/monorepo"));
    expect(path.isAbsolute(options.largeFilesRoot)).toBe(true);
    expect(path.isAbsolute(options.monorepoRoot)).toBe(true);
  });

  it("carries the smoke flag through unchanged", () => {
    expect(buildRunnerOptions({ smoke: true, repoRoot: "/repo" }).smoke).toBe(true);
    expect(buildRunnerOptions({ smoke: false, repoRoot: "/repo" }).smoke).toBe(false);
  });

  it("includes a fixture version and wait/interval timing", () => {
    const options = buildRunnerOptions({ smoke: false, repoRoot: "/repo" });

    expect(options.fixtureVersion).toBeTruthy();
    expect(options.waitMs).toBeGreaterThan(0);
    expect(options.intervalMs).toBeGreaterThan(0);
  });
});

describe("buildSnippetExpression", () => {
  it("produces a self-invoking expression embedding the options", () => {
    const options = buildRunnerOptions({ smoke: true, repoRoot: "/repo" });
    const snippet = buildSnippetExpression(options);

    expect(snippet.startsWith("(async function runCodevoPerfScenarios")).toBe(true);
    expect(snippet).toContain(JSON.stringify(options));
    expect(snippet.trimEnd().endsWith(")")).toBe(true);
  });
});

describe("parseManualResult", () => {
  it("accepts a well-formed in-page runner result", () => {
    const raw = JSON.stringify({
      bridgeResults: [{ id: "typing-large-5k", samples: [1, 2] }],
      trackerSnapshot: [{ kind: "completion", stats: { count: 1, median: 2, p95: 3 } }],
      retainedCounts: { models: 1, editors: 1 },
      memorySample: { usedJsHeapBytes: 100 },
      failedPaths: [],
    });

    const parsed = parseManualResult(raw);

    expect(parsed.bridgeResults).toEqual([{ id: "typing-large-5k", samples: [1, 2] }]);
    expect(parsed.trackerSnapshot).toEqual([
      { kind: "completion", stats: { count: 1, median: 2, p95: 3 } },
    ]);
    expect(parsed.retainedCounts).toEqual({ models: 1, editors: 1 });
    expect(parsed.memorySample).toEqual({ usedJsHeapBytes: 100 });
    expect(parsed.failedPaths).toEqual([]);
  });

  it("defaults retainedCounts and memorySample to null when absent", () => {
    const raw = JSON.stringify({ bridgeResults: [], trackerSnapshot: [], failedPaths: [] });
    const parsed = parseManualResult(raw);

    expect(parsed.retainedCounts).toBeNull();
    expect(parsed.memorySample).toBeNull();
  });

  it("rejects non-JSON input with a clear error", () => {
    expect(() => parseManualResult("not json")).toThrow(/not valid JSON/);
  });

  it("rejects a JSON array at the top level", () => {
    expect(() => parseManualResult("[]")).toThrow(/must contain a JSON object/);
  });

  it("rejects a payload missing bridgeResults", () => {
    const raw = JSON.stringify({ trackerSnapshot: [], failedPaths: [] });
    expect(() => parseManualResult(raw)).toThrow(/bridgeResults/);
  });

  it("rejects malformed bridgeResults entries", () => {
    const raw = JSON.stringify({
      bridgeResults: [{ id: "typing-large-5k" }],
      trackerSnapshot: [],
      failedPaths: [],
    });
    expect(() => parseManualResult(raw)).toThrow(/bridgeResults/);
  });

  it("rejects malformed trackerSnapshot entries", () => {
    const raw = JSON.stringify({
      bridgeResults: [],
      trackerSnapshot: [{ kind: "completion" }],
      failedPaths: [],
    });
    expect(() => parseManualResult(raw)).toThrow(/trackerSnapshot/);
  });

  it("rejects a non-string failedPaths entry", () => {
    const raw = JSON.stringify({ bridgeResults: [], trackerSnapshot: [], failedPaths: [42] });
    expect(() => parseManualResult(raw)).toThrow(/failedPaths/);
  });
});

describe("smokeValidationFailure", () => {
  it("passes when both bridge scenarios have samples and an editor is retained", () => {
    const result = {
      bridgeResults: [
        { id: "typing-large-5k", samples: [1] },
        { id: "tab-switch-cycle", samples: [1] },
      ],
      retainedCounts: { editors: 1 },
    };
    expect(smokeValidationFailure(result)).toBeNull();
  });

  it("fails when typing-large-5k has no samples", () => {
    const result = {
      bridgeResults: [
        { id: "typing-large-5k", samples: [] },
        { id: "tab-switch-cycle", samples: [1] },
      ],
      retainedCounts: { editors: 1 },
    };
    expect(smokeValidationFailure(result)).toMatch(/Performance smoke failed/);
  });

  it("fails when no editor is retained", () => {
    const result = {
      bridgeResults: [
        { id: "typing-large-5k", samples: [1] },
        { id: "tab-switch-cycle", samples: [1] },
      ],
      retainedCounts: { editors: 0 },
    };
    expect(smokeValidationFailure(result)).toMatch(/Performance smoke failed/);
  });
});

describe("failedPathsMessage", () => {
  it("returns null when there are no failed paths", () => {
    expect(failedPathsMessage([])).toBeNull();
  });

  it("lists every failed path indented under a summary line", () => {
    const message = failedPathsMessage(["/a.ts", "/b.ts"]);
    expect(message).toBe(
      "Performance run failed: 2 fixture path(s) could not be opened:\n  /a.ts\n  /b.ts",
    );
  });
});

describe("hasEmptyNonSkippedScenario / scenarioSummary", () => {
  it("flags a bridge scenario with zero samples", () => {
    const shaped = shapeRunResult({
      capturedAt: "2026-07-31T00:00:00.000Z",
      bridgeResults: [
        { id: "typing-large-5k", samples: [] },
        { id: "tab-switch-cycle", samples: [1] },
      ],
    });
    expect(hasEmptyNonSkippedScenario(shaped, [], false)).toBe(true);
  });

  it("ignores empty scenarios outside the smoke subset when smoke is true", () => {
    const shaped = shapeRunResult({
      capturedAt: "2026-07-31T00:00:00.000Z",
      bridgeResults: [
        { id: "typing-large-5k", samples: [1] },
        { id: "tab-switch-cycle", samples: [1] },
      ],
      trackerSnapshot: [],
    });
    expect(hasEmptyNonSkippedScenario(shaped, [], true)).toBe(false);
  });

  it("does not flag skipped or memory-sample scenarios", () => {
    const shaped = shapeRunResult({ capturedAt: "2026-07-31T00:00:00.000Z" });
    expect(hasEmptyNonSkippedScenario(shaped, [], false)).toBe(true);

    const renameScenario = shaped.scenarios.find((s) => s.id === "rename-large-20k");
    expect(renameScenario.status).toBe("skipped");
    expect(scenarioSummary(renameScenario, [])).toMatch(/skipped:/);
  });
});

describe("evaluateRunOutcome", () => {
  it("returns no failures for a clean, non-smoke run", () => {
    const stats = { count: 1, last: 1, min: 1, max: 1, median: 1, p95: 1 };
    const result = {
      bridgeResults: [
        { id: "typing-large-5k", samples: [1] },
        { id: "typing-large-20k", samples: [1] },
        { id: "typing-large-100k", samples: [1] },
        { id: "tab-switch-cycle", samples: [1] },
      ],
      trackerSnapshot: [
        { kind: "completion", stats },
        { kind: "definition", stats },
        { kind: "references", stats },
        { kind: "quickOpen", stats },
      ],
      failedPaths: [],
    };
    const shaped = shapeRunResult({
      capturedAt: "2026-07-31T00:00:00.000Z",
      bridgeResults: result.bridgeResults,
      trackerSnapshot: result.trackerSnapshot,
      failedPaths: result.failedPaths,
    });

    expect(evaluateRunOutcome({ result, shaped, smoke: false })).toEqual([]);
  });

  it("collects the smoke failure, failed-path failure, and empty-scenario failure together", () => {
    const result = {
      bridgeResults: [
        { id: "typing-large-5k", samples: [] },
        { id: "tab-switch-cycle", samples: [] },
      ],
      trackerSnapshot: [],
      retainedCounts: { editors: 0 },
      failedPaths: ["/missing.ts"],
    };
    const shaped = shapeRunResult({
      capturedAt: "2026-07-31T00:00:00.000Z",
      bridgeResults: result.bridgeResults,
      trackerSnapshot: result.trackerSnapshot,
      retainedCounts: result.retainedCounts,
      failedPaths: result.failedPaths,
    });

    const failures = evaluateRunOutcome({ result, shaped, smoke: true });

    expect(failures).toHaveLength(3);
    expect(failures[0]).toMatch(/Performance smoke failed/);
    expect(failures[1]).toMatch(/fixture path\(s\) could not be opened/);
    expect(failures[2]).toMatch(/zero samples/);
  });
});

describe("resultFileName", () => {
  it("replaces colons and dots in the ISO timestamp for filesystem safety", () => {
    expect(resultFileName("2026-07-31T00:00:00.000Z")).toBe("codevo-2026-07-31T00-00-00-000Z.json");
  });
});
