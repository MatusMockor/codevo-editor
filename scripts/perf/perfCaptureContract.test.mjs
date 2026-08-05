import { describe, expect, it } from "vitest";
import {
  PERF_CAPTURE_CONTRACT,
  PERF_CAPTURE_CONTRACT_METADATA,
  PERF_CAPTURE_CONTRACT_SHA256,
  MAX_CAPTURE_JSON_BYTES,
  captureScenarioContract,
  parseCaptureRunJson,
  validateCaptureRun,
} from "./perfCaptureContract.mjs";

const environment = {
  editor: "codevo",
  version: "1.0.0",
  bundleMode: "production",
  captureFlavor: "production-instrumented",
  sourceRevision: "a".repeat(40),
  artifactSha256: "b".repeat(64),
  bundleManifestSha256: "c".repeat(64),
  hostPlatform: "darwin",
  hostArch: "arm64",
  osRelease: "25.0.0",
  launchState: "cold-fresh-profile",
  workspaceState: "fixture-clean",
  capturedAt: "2026-08-04T00:00:00.000Z",
};

function diagnosticEnvironmentOf(overrides = {}) {
  return {
    ...environment,
    windowMode: "always-on-top-diagnostic",
    appActivationTransitions: 0,
    diagnosticSpaceLease: true,
    domWindowSignalCount: 0,
    keyTransitions: 0,
    minimizeTransitions: 0,
    occlusionTransitions: 0,
    onActiveSpaceAtRelease: true,
    transitionOverflow: false,
    windowInterruptionCount: 0,
    windowInterruptionStages: [],
    windowRecoveryInterventionCount: 0,
    windowStability: "diagnostic-space-lease",
    windowStabilityEpoch: 0,
    ...overrides,
  };
}

function runOf(scenarios = []) {
  return { captureContract: PERF_CAPTURE_CONTRACT_METADATA, environment, scenarios };
}

function completeScenarios(editor, overridesById = new Map()) {
  return PERF_CAPTURE_CONTRACT.scenarios
    .filter((scenario) => scenario.cutPointByEditor[editor] !== null)
    .map(
      (scenario) =>
        overridesById.get(scenario.id) ?? {
          id: scenario.id,
          status: "not-run",
          cutPoint: scenario.cutPointByEditor[editor],
          comparisonKind: scenario.comparisonKind,
          cacheState: scenario.cacheState,
          workScope: scenario.workScope,
        },
    );
}

describe("production capture contract", () => {
  it("loads one bounded canonical contract with a stable sha256 identity", () => {
    expect(PERF_CAPTURE_CONTRACT.schemaVersion).toBe(1);
    expect(PERF_CAPTURE_CONTRACT.scenarios.length).toBeLessThanOrEqual(
      PERF_CAPTURE_CONTRACT.limits.maxScenarios,
    );
    expect(PERF_CAPTURE_CONTRACT_SHA256).toMatch(/^[a-f\d]{64}$/);
    expect(captureScenarioContract("file-search-engine")).toMatchObject({
      cutPointByEditor: { codevo: "file-search-engine", vscode: "file-search-engine" },
      cacheState: "warm-explicit",
    });
  });

  it("accepts a canonical production-instrumented scenario", () => {
    const scenario = captureScenarioContract("file-search-engine");
    const measured = {
      id: scenario.id,
      status: "ok",
      cutPoint: scenario.cutPointByEditor.codevo,
      comparisonKind: scenario.comparisonKind,
      cacheState: scenario.cacheState,
      workScope: scenario.workScope,
      samples: [{ ms: 1, resultCount: 2 }],
      p50: 1,
      p95: 1,
      targets: ["index"],
    };
    expect(
      validateCaptureRun(runOf(completeScenarios("codevo", new Map([[scenario.id, measured]]))), {
        expectedEditor: "codevo",
      }),
    ).toEqual([]);
  });

  it.each([
    ["dev bundle", { bundleMode: "dev" }, "environment.bundleMode"],
    ["wrong capture flavor", { captureFlavor: "ordinary-release" }, "captureFlavor"],
    ["reused profile", { launchState: "warm-reused-profile" }, "launchState"],
    ["dirty workspace", { workspaceState: "dirty" }, "workspaceState"],
    ["missing source", { sourceRevision: undefined }, "sourceRevision"],
    ["missing artifact", { artifactSha256: undefined }, "artifactSha256"],
    ["missing bundle manifest", { bundleManifestSha256: undefined }, "bundleManifestSha256"],
    ["malformed bundle manifest", { bundleManifestSha256: "c".repeat(63) }, "bundleManifestSha256"],
  ])("rejects %s", (_label, override, reason) => {
    const reasons = validateCaptureRun(
      { ...runOf(), environment: { ...environment, ...override } },
      { expectedEditor: "codevo" },
    );
    expect(reasons.join(" ")).toContain(reason);
  });

  it("rejects unknown and duplicate scenario ids", () => {
    const unknown = { id: "made-up", samples: [] };
    expect(
      validateCaptureRun(runOf([...completeScenarios("codevo"), unknown]), {
        expectedEditor: "codevo",
      }).join(" "),
    ).toContain("unknown scenario id");

    const known = captureScenarioContract("file-search-engine");
    const scenario = {
      id: known.id,
      status: "ok",
      cutPoint: known.cutPointByEditor.codevo,
      comparisonKind: known.comparisonKind,
      cacheState: known.cacheState,
      workScope: known.workScope,
      samples: [{ ms: 1 }],
    };
    expect(
      validateCaptureRun(runOf([...completeScenarios("codevo"), scenario]), {
        expectedEditor: "codevo",
      }).join(" "),
    ).toContain("duplicate scenario id");
  });

  it("rejects a known scenario that the editor is not permitted to capture", () => {
    const codevoOnly = captureScenarioContract("quickopen-ui");
    const reasons = validateCaptureRun(
      runOf([
        ...completeScenarios("vscode"),
        {
          id: codevoOnly.id,
          status: "ok",
          cutPoint: "forged-vscode-ui-cut-point",
          comparisonKind: codevoOnly.comparisonKind,
          cacheState: codevoOnly.cacheState,
          workScope: codevoOnly.workScope,
          samples: [{ ms: 1 }],
        },
      ]),
      { expectedEditor: "vscode" },
    );
    expect(reasons).toContain(
      'Scenario "quickopen-ui" is not permitted in a canonical vscode capture.',
    );
  });

  it("rejects cache, cut-point, work-scope, and sample-bound drift", () => {
    const reasons = validateCaptureRun(
      runOf(
        completeScenarios(
          "codevo",
          new Map([
            [
              "file-search-engine",
              {
                id: "file-search-engine",
                status: "ok",
                cutPoint: "ui-render",
                comparisonKind: "cross-editor",
                cacheState: "cold-fresh-process",
                workScope: "unbounded",
                samples: Array.from({ length: 21 }, () => ({ ms: 1 })),
              },
            ],
          ]),
        ),
      ),
      { expectedEditor: "codevo" },
    ).join(" ");

    expect(reasons).toContain("cutPoint");
    expect(reasons).toContain("cacheState");
    expect(reasons).toContain("workScope");
    expect(reasons).toContain("above its 20 sample bound");
  });

  it("rejects an implicit status and enforces the scenario maximum without status ok", () => {
    const contract = captureScenarioContract("completion-bounded");
    const invalid = {
      id: contract.id,
      cutPoint: contract.cutPointByEditor.codevo,
      comparisonKind: contract.comparisonKind,
      cacheState: contract.cacheState,
      workScope: contract.workScope,
      samples: Array.from({ length: 100 }, () => ({ ms: 1 })),
    };
    const reasons = validateCaptureRun(
      runOf(completeScenarios("codevo", new Map([[contract.id, invalid]]))),
      { expectedEditor: "codevo" },
    ).join(" ");

    expect(reasons).toContain("must record one explicit closed status");
    expect(reasons).toContain("above its 20 sample bound");
  });

  it("rejects an altered contract identity and a scenario count above the global bound", () => {
    const tooMany = Array.from(
      { length: PERF_CAPTURE_CONTRACT.limits.maxScenarios + 1 },
      (_, index) => ({ id: `made-up-${index}` }),
    );
    const reasons = validateCaptureRun(
      {
        ...runOf(tooMany),
        captureContract: { ...PERF_CAPTURE_CONTRACT_METADATA, sha256: "0".repeat(64) },
      },
      { expectedEditor: "codevo" },
    ).join(" ");

    expect(reasons).toContain("canonical capture contract");
    expect(reasons).toContain("above the 32 scenario bound");
  });

  it("parses a bounded valid capture and rejects duplicate JSON keys before JSON.parse can hide them", () => {
    expect(
      parseCaptureRunJson(JSON.stringify(runOf(completeScenarios("codevo"))), {
        expectedEditor: "codevo",
      }),
    ).toMatchObject({ captureContract: PERF_CAPTURE_CONTRACT_METADATA });

    const duplicateEnvironment = JSON.stringify(runOf()).replace(
      '"editor":"codevo"',
      '"editor":"codevo","editor":"vscode"',
    );
    expect(() => parseCaptureRunJson(duplicateEnvironment, { expectedEditor: "codevo" })).toThrow(
      /duplicate object key "editor"/,
    );
  });

  it("rejects an oversized capture before parsing", () => {
    const raw = `{"padding":"${"x".repeat(MAX_CAPTURE_JSON_BYTES)}"}`;
    expect(() => parseCaptureRunJson(raw, { expectedEditor: "codevo" })).toThrow(
      /above the 8388608 byte bound/,
    );
  });

  it.each([
    ["run", { extra: true }, "unknown top-level"],
    [
      "capture metadata",
      { captureContract: { ...PERF_CAPTURE_CONTRACT_METADATA, extra: true } },
      "closed",
    ],
    ["environment", { environment: { ...environment, extra: true } }, "environment has unknown"],
  ])("rejects unknown fields at the %s level", (_label, override, reason) => {
    expect(
      validateCaptureRun(
        { ...runOf(completeScenarios("codevo")), ...override },
        { expectedEditor: "codevo" },
      ).join(" "),
    ).toContain(reason);
  });

  it.each([
    ["scenario", { extra: true }],
    ["sample", { samples: [{ ms: 1, extra: true }], p50: 1, p95: 1 }],
    ["retainedCounts", { retainedCounts: { editors: 1, models: 1, extra: true } }],
    ["memorySample", { memorySample: { usedJsHeapBytes: 1, extra: true } }],
    [
      "pairs",
      {
        pairs: [
          { fromBasename: "a.ts", toBasename: "b.ts", count: 1, p50: 1, p95: 1, extra: true },
        ],
      },
    ],
  ])("rejects unknown fields in nested %s records", (_label, override) => {
    const contract = captureScenarioContract("file-search-engine");
    const scenario = {
      id: contract.id,
      status: "ok",
      cutPoint: contract.cutPointByEditor.codevo,
      comparisonKind: contract.comparisonKind,
      cacheState: contract.cacheState,
      workScope: contract.workScope,
      samples: [{ ms: 1 }],
      p50: 1,
      p95: 1,
      ...override,
    };
    const reasons = validateCaptureRun(
      runOf(completeScenarios("codevo", new Map([[contract.id, scenario]]))),
      { expectedEditor: "codevo" },
    );
    expect(reasons.length).toBeGreaterThan(0);
  });

  it.each([
    ["primitive", [1]],
    ["missing ms", [{ resultCount: 1 }]],
    ["NaN", [{ ms: Number.NaN }]],
    ["infinity", [{ ms: Number.POSITIVE_INFINITY }]],
    ["negative", [{ ms: -1 }]],
    ["fractional result count", [{ ms: 1, resultCount: 1.5 }]],
    ["negative result count", [{ ms: 1, resultCount: -1 }]],
  ])("rejects malformed %s samples", (_label, samples) => {
    const contract = captureScenarioContract("file-search-engine");
    const measured = {
      id: contract.id,
      status: "ok",
      cutPoint: contract.cutPointByEditor.codevo,
      comparisonKind: contract.comparisonKind,
      cacheState: contract.cacheState,
      workScope: contract.workScope,
      samples,
      p50: 1,
      p95: 1,
    };
    expect(
      validateCaptureRun(runOf(completeScenarios("codevo", new Map([[contract.id, measured]]))), {
        expectedEditor: "codevo",
      }).join(" "),
    ).toContain("samples must be dense closed finite nonnegative records");
  });

  it("rejects sparse samples and forged persisted percentiles", () => {
    const contract = captureScenarioContract("file-search-engine");
    const sparse = new Array(2);
    sparse[1] = { ms: 2 };
    const base = {
      id: contract.id,
      status: "ok",
      cutPoint: contract.cutPointByEditor.codevo,
      comparisonKind: contract.comparisonKind,
      cacheState: contract.cacheState,
      workScope: contract.workScope,
    };
    const sparseReasons = validateCaptureRun(
      runOf(completeScenarios("codevo", new Map([[contract.id, { ...base, samples: sparse }]]))),
      { expectedEditor: "codevo" },
    ).join(" ");
    expect(sparseReasons).toContain("samples must be dense");

    const percentileReasons = validateCaptureRun(
      runOf(
        completeScenarios(
          "codevo",
          new Map([[contract.id, { ...base, samples: [{ ms: 1 }, { ms: 3 }], p50: 99, p95: 99 }]]),
        ),
      ),
      { expectedEditor: "codevo" },
    ).join(" ");
    expect(percentileReasons).toContain("must exactly match");
  });

  it.each([
    ["pair count", { pairs: [{ fromBasename: "a", toBasename: "b", count: 101, p50: 1, p95: 1 }] }],
    ["retained model count", { retainedCounts: { editors: 1, models: 1_000_001 } }],
    ["heap bytes", { memorySample: { usedJsHeapBytes: 2 ** 50 + 1 } }],
  ])("rejects an out-of-bound %s", (_label, override) => {
    const contract = captureScenarioContract("file-search-engine");
    const measured = {
      id: contract.id,
      status: "ok",
      cutPoint: contract.cutPointByEditor.codevo,
      comparisonKind: contract.comparisonKind,
      cacheState: contract.cacheState,
      workScope: contract.workScope,
      samples: [{ ms: 1 }],
      p50: 1,
      p95: 1,
      ...override,
    };
    expect(
      validateCaptureRun(runOf(completeScenarios("codevo", new Map([[contract.id, measured]]))), {
        expectedEditor: "codevo",
      }),
    ).not.toEqual([]);
  });

  it("preserves explicit diagnostic non-comparable samples while rejecting forged evidence", () => {
    const contract = captureScenarioContract("typing-large-5k");
    const diagnostic = {
      id: contract.id,
      status: "non-comparable",
      reason: "diagnostic window",
      diagnosticEvidence: "diagnostic-smoke-raw-bridge-samples-v1",
      cutPoint: contract.cutPointByEditor.codevo,
      comparisonKind: contract.comparisonKind,
      cacheState: contract.cacheState,
      workScope: contract.workScope,
      unit: "ms",
      samples: [{ ms: 2 }],
      p50: 2,
      p95: 2,
    };
    expect(
      validateCaptureRun(
        {
          ...runOf(completeScenarios("codevo", new Map([[contract.id, diagnostic]]))),
          environment: diagnosticEnvironmentOf(),
        },
        { expectedEditor: "codevo" },
      ),
    ).toEqual([]);
    expect(
      validateCaptureRun(runOf(completeScenarios("codevo", new Map([[contract.id, diagnostic]]))), {
        expectedEditor: "codevo",
      }).join(" "),
    ).toContain("invalid diagnostic non-comparable evidence");
    expect(
      validateCaptureRun(
        runOf(
          completeScenarios(
            "codevo",
            new Map([[contract.id, { ...diagnostic, diagnosticEvidence: "forged" }]]),
          ),
        ),
        { expectedEditor: "codevo" },
      ).join(" "),
    ).toContain("invalid diagnostic non-comparable evidence");
  });

  it("rejects non-comparable samples without exact diagnostic authority", () => {
    const contract = captureScenarioContract("typing-large-5k");
    const scenario = {
      id: contract.id,
      status: "non-comparable",
      reason: "diagnostic window",
      cutPoint: contract.cutPointByEditor.codevo,
      comparisonKind: contract.comparisonKind,
      cacheState: contract.cacheState,
      workScope: contract.workScope,
      samples: [{ ms: 2 }],
      p50: 2,
      p95: 2,
    };
    expect(
      validateCaptureRun(runOf(completeScenarios("codevo", new Map([[contract.id, scenario]]))), {
        expectedEditor: "codevo",
      }).join(" "),
    ).toContain("require exact diagnostic evidence");
  });

  it.each(["01.2.3", "1.02.3", "1.2.03", "1.2.3-01", "1.2.3-.."])(
    "rejects non-canonical semantic version %s",
    (version) => {
      expect(
        validateCaptureRun(
          { ...runOf(completeScenarios("codevo")), environment: { ...environment, version } },
          { expectedEditor: "codevo" },
        ).join(" "),
      ).toContain("canonical semantic version");
    },
  );

  it.each(["../escape.ts", "./dot.ts", "a//b.ts", "\\absolute.ts", "a/../b.ts", "a\0b.ts"])(
    "rejects unsafe fixture hash key %s",
    (key) => {
      expect(
        validateCaptureRun(
          { ...runOf(completeScenarios("codevo")), fixtureHashes: { [key]: "d".repeat(64) } },
          { expectedEditor: "codevo" },
        ).join(" "),
      ).toContain("fixtureHashes");
    },
  );

  it("binds a Codevo capture to the trusted expected bundle manifest digest", () => {
    expect(
      validateCaptureRun(runOf(completeScenarios("codevo")), {
        expectedEditor: "codevo",
        expectedBundleManifestSha256: "d".repeat(64),
      }).join(" "),
    ).toContain("trusted bundle identity");
  });

  it("fails closed without throwing on malformed complete diagnostic metadata", () => {
    const diagnosticEnvironment = diagnosticEnvironmentOf({ windowInterruptionStages: null });
    expect(
      validateCaptureRun(
        { ...runOf(completeScenarios("codevo")), environment: diagnosticEnvironment },
        { expectedEditor: "codevo" },
      ).join(" "),
    ).toContain("windowInterruptionStages");
  });

  it("rejects unbounded duration evidence and failure-only measurement summaries", () => {
    const contract = captureScenarioContract("file-search-engine");
    const base = {
      id: contract.id,
      cutPoint: contract.cutPointByEditor.codevo,
      comparisonKind: contract.comparisonKind,
      cacheState: contract.cacheState,
      workScope: contract.workScope,
    };
    const unbounded = {
      ...base,
      status: "ok",
      samples: [{ ms: 3_600_001 }],
      p50: 3_600_001,
      p95: 3_600_001,
    };
    expect(
      validateCaptureRun(runOf(completeScenarios("codevo", new Map([[contract.id, unbounded]]))), {
        expectedEditor: "codevo",
      }).join(" "),
    ).toContain("samples must be dense");

    const failed = { ...base, status: "not-run", reason: "not measured", p50: 1, p95: 1 };
    expect(
      validateCaptureRun(runOf(completeScenarios("codevo", new Map([[contract.id, failed]]))), {
        expectedEditor: "codevo",
      }).join(" "),
    ).toContain("must not carry measurement percentiles");
  });

  it("keeps memory-sample on its closed scenario-specific schema", () => {
    const contract = captureScenarioContract("memory-sample");
    const invalid = {
      id: contract.id,
      status: "ok",
      cutPoint: contract.cutPointByEditor.codevo,
      comparisonKind: contract.comparisonKind,
      cacheState: contract.cacheState,
      workScope: contract.workScope,
      unit: "count-bytes",
      retainedCounts: { editors: 1, models: 1 },
      memorySample: { usedJsHeapBytes: 1 },
      p50: 1,
    };
    expect(
      validateCaptureRun(runOf(completeScenarios("codevo", new Map([[contract.id, invalid]]))), {
        expectedEditor: "codevo",
      }).join(" "),
    ).toContain("closed memory schema");
  });
});
