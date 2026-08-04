import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  shapeRunResult,
  CAPABILITY_SCENARIO_IDS,
  POLICY_DISABLED_REASON,
} from "./perfScenarios.mjs";
import {
  CAPABILITY_GAP_SCENARIO_IDS,
  blockedScenarioIds,
  buildRunnerOptions,
  buildSnippetExpression,
  environmentAnomaly,
  environmentWarning,
  evaluateRunOutcome,
  failedPathsMessage,
  hasBlockingScenario,
  isBlockingStatus,
  isDeclaredCapabilityGap,
  normalizeRunnerResult,
  parseManualResult,
  resultFileName,
  scenarioSummary,
  smokeValidationFailure,
} from "./runPerfScenariosCli.mjs";

const COMPLETE_ENVIRONMENT = {
  editor: "codevo",
  version: "0.1.0",
  bundleMode: "dev",
  strictMode: false,
  timerQuantizationMs: 1,
  platform: "darwin",
  capturedAt: "2026-08-03T00:00:00.000Z",
};

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
      trackerSnapshot: [
        {
          kind: "completion",
          stats: { count: 1, last: 3, min: 1, max: 3, median: 2, p95: 3 },
        },
      ],
      retainedCounts: { models: 1, editors: 1 },
      memorySample: { usedJsHeapBytes: 100 },
      failedPaths: [],
    });

    const parsed = parseManualResult(raw);

    expect(parsed.bridgeResults).toEqual([{ id: "typing-large-5k", samples: [1, 2] }]);
    expect(parsed.trackerSnapshot).toEqual([
      {
        kind: "completion",
        stats: { count: 1, last: 3, min: 1, max: 3, median: 2, p95: 3 },
      },
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

  it.each([
    ["numeric strings", ["1"]],
    ["negative samples", [-1]],
    ["null samples", [null]],
  ])("rejects bridgeResults containing %s", (_description, samples) => {
    const raw = JSON.stringify({
      bridgeResults: [{ id: "typing-large-5k", samples }],
      trackerSnapshot: [],
      failedPaths: [],
    });

    expect(() => parseManualResult(raw)).toThrow(/finite nonnegative numeric samples/);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite bridge sample %s at the normalized result boundary",
    (sample) => {
      expect(() =>
        normalizeRunnerResult({
          bridgeResults: [{ id: "typing-large-5k", samples: [sample] }],
          trackerSnapshot: [],
          failedPaths: [],
        }),
      ).toThrow(/finite nonnegative numeric samples/);
    },
  );

  it("rejects a sparse samples array at the normalized result boundary", () => {
    expect(() =>
      normalizeRunnerResult({
        bridgeResults: [{ id: "typing-large-5k", samples: new Array(1) }],
        trackerSnapshot: [],
        failedPaths: [],
      }),
    ).toThrow(/finite nonnegative numeric samples/);
  });

  it("rejects sparse bridgeResults and trackerSnapshot arrays", () => {
    expect(() =>
      normalizeRunnerResult({
        bridgeResults: new Array(1),
        trackerSnapshot: [],
        failedPaths: [],
      }),
    ).toThrow(/bridgeResults/);

    expect(() =>
      normalizeRunnerResult({
        bridgeResults: [],
        trackerSnapshot: new Array(1),
        failedPaths: [],
      }),
    ).toThrow(/trackerSnapshot/);
  });

  it("rejects malformed trackerSnapshot entries", () => {
    const raw = JSON.stringify({
      bridgeResults: [],
      trackerSnapshot: [{ kind: "completion" }],
      failedPaths: [],
    });
    expect(() => parseManualResult(raw)).toThrow(/trackerSnapshot/);
  });

  it.each(["count", "last", "min", "max", "median", "p95"])(
    "rejects tracker stats missing required %s",
    (missingStat) => {
      const stats = { count: 1, last: 1, min: 1, max: 1, median: 1, p95: 1 };
      delete stats[missingStat];
      const raw = JSON.stringify({
        bridgeResults: [],
        trackerSnapshot: [{ kind: "completion", stats }],
        failedPaths: [],
      });

      expect(() => parseManualResult(raw)).toThrow(/finite nonnegative numeric stats/);
    },
  );

  it.each([
    ["numeric string", "1"],
    ["negative number", -1],
    ["null", null],
  ])("rejects a tracker stat containing a %s", (_description, value) => {
    const raw = JSON.stringify({
      bridgeResults: [],
      trackerSnapshot: [
        {
          kind: "completion",
          stats: { count: value, last: 1, min: 1, max: 1, median: 1, p95: 1 },
        },
      ],
      failedPaths: [],
    });

    expect(() => parseManualResult(raw)).toThrow(/finite nonnegative numeric stats/);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite tracker stat %s at the normalized result boundary",
    (value) => {
      expect(() =>
        normalizeRunnerResult({
          bridgeResults: [],
          trackerSnapshot: [
            {
              kind: "completion",
              stats: { count: 1, last: value, min: 1, max: 1, median: 1, p95: 1 },
            },
          ],
          failedPaths: [],
        }),
      ).toThrow(/finite nonnegative numeric stats/);
    },
  );

  it("rejects a non-string failedPaths entry", () => {
    const raw = JSON.stringify({ bridgeResults: [], trackerSnapshot: [], failedPaths: [42] });
    expect(() => parseManualResult(raw)).toThrow(/failedPaths/);
  });

  it("keeps the run's capability and readiness statuses", () => {
    const scenarioStatuses = [
      { id: "completion-large-20k", status: "policy-disabled", reason: POLICY_DISABLED_REASON },
    ];
    const raw = JSON.stringify({
      bridgeResults: [],
      trackerSnapshot: [],
      scenarioStatuses,
      failedPaths: [],
    });

    expect(parseManualResult(raw).scenarioStatuses).toEqual(scenarioStatuses);
  });

  it("defaults scenarioStatuses to an empty list for older result files", () => {
    const raw = JSON.stringify({ bridgeResults: [], trackerSnapshot: [], failedPaths: [] });

    expect(parseManualResult(raw).scenarioStatuses).toEqual([]);
  });

  it("rejects malformed scenarioStatuses entries", () => {
    const raw = JSON.stringify({
      bridgeResults: [],
      trackerSnapshot: [],
      scenarioStatuses: [{ id: "completion-large-20k", status: "policy-disabled" }],
      failedPaths: [],
    });
    expect(() => parseManualResult(raw)).toThrow(/scenarioStatuses/);
  });

  it("rejects scenarioStatuses entries carrying a status outside the closed set", () => {
    const raw = JSON.stringify({
      bridgeResults: [],
      trackerSnapshot: [],
      scenarioStatuses: [
        {
          id: "completion-large-20k",
          status: "totally-unrecognized-status",
          reason: "hand-carried JSON from an ad-hoc manual run",
        },
      ],
      failedPaths: [],
    });
    expect(() => parseManualResult(raw)).toThrow(/scenarioStatuses/);
    expect(() => parseManualResult(raw)).toThrow(/status/i);
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

describe("hasBlockingScenario / scenarioSummary", () => {
  it("flags a bridge scenario with zero samples", () => {
    const shaped = shapeRunResult({
      capturedAt: "2026-07-31T00:00:00.000Z",
      bridgeResults: [
        { id: "typing-large-5k", samples: [] },
        { id: "tab-switch-cycle", samples: [1] },
      ],
    });
    expect(hasBlockingScenario(shaped, [], false)).toBe(true);
    expect(blockedScenarioIds(shaped, [], false)).toContain("typing-large-5k");
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
    expect(hasBlockingScenario(shaped, [], true)).toBe(false);
  });

  it("never treats the memory-sample scenario as blocking", () => {
    const shaped = shapeRunResult({
      capturedAt: "2026-07-31T00:00:00.000Z",
      retainedCounts: { models: 1, editors: 1 },
      memorySample: { usedJsHeapBytes: 10 },
    });
    const memory = shaped.scenarios.find((scenario) => scenario.id === "memory-sample");

    expect(hasBlockingScenario({ scenarios: [memory] }, [], false)).toBe(false);
  });

  it.each(["invalid", "no-result", "non-comparable", "not-run", "policy-disabled", "skipped"])(
    "blocks the run lane for a %s scenario exactly as the report lane does",
    (status) => {
      const scenario = { id: "rename-medium-2k", unit: "ms", status, reason: `reported ${status}` };

      expect(isBlockingStatus(status)).toBe(true);
      expect(hasBlockingScenario({ scenarios: [scenario] }, [], false)).toBe(true);
      expect(scenarioSummary(scenario, [])).toBe(`${status}: reported ${status}`);
    },
  );

  it("exempts the declared large-file capability rows from the run-lane gate", () => {
    const shaped = shapeRunResult({
      capturedAt: "2026-07-31T00:00:00.000Z",
      scenarioStatuses: CAPABILITY_SCENARIO_IDS.map((id) => ({
        id,
        status: "policy-disabled",
        reason: POLICY_DISABLED_REASON,
      })),
    });
    const capabilityRows = shaped.scenarios.filter((scenario) =>
      CAPABILITY_SCENARIO_IDS.includes(scenario.id),
    );

    expect(capabilityRows).toHaveLength(CAPABILITY_SCENARIO_IDS.length);
    expect(capabilityRows.every(isDeclaredCapabilityGap)).toBe(true);
    expect(hasBlockingScenario({ scenarios: capabilityRows }, [], false)).toBe(false);
  });

  it("keeps an unexpected policy-disabled status on a comparable fixture blocking", () => {
    const scenario = {
      id: "definition-medium-2k",
      unit: "ms",
      status: "policy-disabled",
      reason: "unexpected policy verdict on the canonical fixture",
    };

    expect(isDeclaredCapabilityGap(scenario)).toBe(false);
    expect(hasBlockingScenario({ scenarios: [scenario] }, [], false)).toBe(true);
  });

  it("derives the carve-out from the capability scenario registry", () => {
    expect(CAPABILITY_GAP_SCENARIO_IDS).toEqual(CAPABILITY_SCENARIO_IDS);
  });

  it("stops accepting a skipped scenario as a successful run", () => {
    const shaped = shapeRunResult({ capturedAt: "2026-07-31T00:00:00.000Z" });
    const rename = shaped.scenarios.find((scenario) => scenario.id === "rename-medium-2k");

    expect(rename.status).toBe("skipped");
    expect(hasBlockingScenario({ scenarios: [rename] }, [], false)).toBe(true);
    expect(blockedScenarioIds({ scenarios: [rename] }, [], false)).toEqual(["rename-medium-2k"]);
  });

  it("still summarizes a declared capability row truthfully while exempting it", () => {
    const shaped = shapeRunResult({
      capturedAt: "2026-07-31T00:00:00.000Z",
      scenarioStatuses: [
        {
          id: "completion-large-20k",
          status: "policy-disabled",
          reason: POLICY_DISABLED_REASON,
        },
      ],
    });
    const capability = shaped.scenarios.find((s) => s.id === "completion-large-20k");

    expect(hasBlockingScenario({ scenarios: [capability] }, [], false)).toBe(false);
    expect(scenarioSummary(capability, [])).toBe(`policy-disabled: ${POLICY_DISABLED_REASON}`);
  });

  it("leaves an ok scenario carrying samples unblocked", () => {
    const scenario = { id: "typing", unit: "ms", status: "ok", samples: [1, 2, 3] };

    expect(isBlockingStatus("ok")).toBe(false);
    expect(hasBlockingScenario({ scenarios: [scenario] }, [], false)).toBe(false);
    expect(scenarioSummary(scenario, [])).toBe(3);
  });
});

describe("evaluateRunOutcome", () => {
  it("returns no failures when every scenario carries samples under an ok status", () => {
    const result = {
      bridgeResults: [{ id: "typing", samples: [1] }],
      trackerSnapshot: [],
      failedPaths: [],
    };
    const shaped = {
      failedPaths: [],
      environment: COMPLETE_ENVIRONMENT,
      scenarios: [
        { id: "typing", unit: "ms", status: "ok", samples: [1, 2] },
        { id: "definition", unit: "ms", status: "ok", samples: [3] },
        { id: "memory-sample", unit: "count-bytes", retainedCounts: null, memorySample: null },
      ],
    };

    expect(evaluateRunOutcome({ result, shaped, smoke: false })).toEqual([]);
  });

  it("fails the run lane for the same statuses the report lane fails", () => {
    const result = { bridgeResults: [], trackerSnapshot: [], failedPaths: [] };
    const shaped = shapeRunResult({
      capturedAt: "2026-07-31T00:00:00.000Z",
      bridgeResults: [{ id: "typing-large-5k", samples: [1] }],
      scenarioStatuses: CAPABILITY_SCENARIO_IDS.map((id) => ({
        id,
        status: "policy-disabled",
        reason: POLICY_DISABLED_REASON,
      })),
      failedPaths: [],
    });
    const [failure] = evaluateRunOutcome({ result, shaped, smoke: false });

    expect(failure).toMatch(/produced no usable measurement/);
    expect(failure).toContain("rename-medium-2k");
    expect(failure).not.toContain("completion-large-20k");
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
    expect(failures[2]).toMatch(/produced no usable measurement/);
  });
});

describe("environment anomaly gate", () => {
  const okScenario = { id: "typing", unit: "ms", status: "ok", samples: [1, 2] };

  function outcomeFor({ environment, smoke }) {
    const shaped = { failedPaths: [], scenarios: [okScenario] };
    const withEnvironment = environment === undefined ? shaped : { ...shaped, environment };
    const result = {
      bridgeResults: [
        { id: "typing-large-5k", samples: [1] },
        { id: "tab-switch-cycle", samples: [1] },
      ],
      trackerSnapshot: [],
      retainedCounts: { editors: 1 },
      failedPaths: [],
    };

    return {
      failures: evaluateRunOutcome({ result, shaped: withEnvironment, smoke }),
      warning: environmentWarning(withEnvironment, smoke),
      anomaly: environmentAnomaly(withEnvironment),
    };
  }

  it("passes a full run whose environment block is complete", () => {
    const { failures, warning, anomaly } = outcomeFor({
      environment: COMPLETE_ENVIRONMENT,
      smoke: false,
    });

    expect(anomaly).toBeNull();
    expect(warning).toBeNull();
    expect(failures).toEqual([]);
  });

  it("fails a full run whose result records no environment block", () => {
    const { failures } = outcomeFor({ environment: undefined, smoke: false });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/records no environment block/);
    expect(failures[0]).toMatch(
      /gap report rejects any pair whose environment metadata is missing/,
    );
  });

  it.each([
    ["editor", "editor"],
    ["bundleMode", "bundleMode"],
    ["timerQuantizationMs", "timerQuantizationMs"],
    ["capturedAt", "capturedAt"],
  ])("fails a full run whose environment block is missing %s", (_label, field) => {
    const environment = { ...COMPLETE_ENVIRONMENT };
    delete environment[field];
    const { failures } = outcomeFor({ environment, smoke: false });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/environment block is incomplete/);
    expect(failures[0]).toContain(field);
  });

  it.each([
    ["an empty editor string", { editor: "" }],
    ["a non-string bundleMode", { bundleMode: 1 }],
    ["a non-numeric timerQuantizationMs", { timerQuantizationMs: "1" }],
    ["a negative timerQuantizationMs", { timerQuantizationMs: -1 }],
  ])("fails a full run whose environment block carries %s", (_label, override) => {
    const { failures } = outcomeFor({
      environment: { ...COMPLETE_ENVIRONMENT, ...override },
      smoke: false,
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/environment block is incomplete/);
  });

  it("only warns in smoke mode and never fails the smoke lane on it", () => {
    const missing = outcomeFor({ environment: undefined, smoke: true });
    const incomplete = outcomeFor({
      environment: { editor: "codevo", bundleMode: "dev" },
      smoke: true,
    });

    expect(missing.failures).toEqual([]);
    expect(missing.warning).toMatch(/records no environment block/);
    expect(missing.warning).toMatch(/Smoke runs are exempt from this gate; a full run is not\./);
    expect(incomplete.failures).toEqual([]);
    expect(incomplete.warning).toContain("timerQuantizationMs, capturedAt");
  });

  it("stays silent in smoke mode when the environment block is complete", () => {
    expect(environmentWarning({ environment: COMPLETE_ENVIRONMENT }, true)).toBeNull();
    expect(environmentWarning({ environment: undefined }, false)).toBeNull();
  });

  it("rejects an environment block that is not a plain object", () => {
    expect(environmentAnomaly({ environment: [] })).toMatch(/records no environment block/);
    expect(environmentAnomaly({ environment: "darwin" })).toMatch(/records no environment block/);
  });
});

describe("environment metadata pass-through", () => {
  it("carries the in-page environment block onto the normalized result", () => {
    const environment = {
      editor: "codevo",
      version: "0.1.0",
      bundleMode: "dev",
      strictMode: false,
      timerQuantizationMs: 1,
      platform: "darwin",
      capturedAt: "2026-08-03T00:00:00.000Z",
    };
    const raw = JSON.stringify({
      bridgeResults: [],
      trackerSnapshot: [],
      environment,
      failedPaths: [],
    });

    expect(parseManualResult(raw).environment).toEqual(environment);
  });

  it("defaults the environment to null for payloads that record none", () => {
    const raw = JSON.stringify({ bridgeResults: [], trackerSnapshot: [], failedPaths: [] });

    expect(parseManualResult(raw).environment).toBeNull();
  });

  it.each([
    ["an array", []],
    ["a string", "darwin"],
  ])("rejects an environment that is %s", (_label, environment) => {
    expect(() =>
      normalizeRunnerResult({
        bridgeResults: [],
        trackerSnapshot: [],
        environment,
        failedPaths: [],
      }),
    ).toThrow(/"environment" must be an object/);
  });

  it("rejects a non-numeric timer quantization", () => {
    expect(() =>
      normalizeRunnerResult({
        bridgeResults: [],
        trackerSnapshot: [],
        environment: { timerQuantizationMs: "1" },
        failedPaths: [],
      }),
    ).toThrow(/timerQuantizationMs/);
  });
});

describe("resultFileName", () => {
  it("replaces colons and dots in the ISO timestamp for filesystem safety", () => {
    expect(resultFileName("2026-07-31T00:00:00.000Z")).toBe("codevo-2026-07-31T00-00-00-000Z.json");
  });
});
