import { describe, expect, it } from "vitest";
import {
  BLOCKED_TABLE_HEADER,
  CAPABILITY_GAP_SCENARIO_IDS,
  COMPARABLE_TABLE_HEADER,
  DEFAULT_TOLERANCES,
  NON_COMPARABLE_TABLE_HEADER,
  buildGapReport,
  renderGapReportMarkdown,
} from "./gapReport.mjs";
import { PERF_SCENARIOS } from "./perfScenarios.mjs";
import {
  PERF_CAPTURE_CONTRACT,
  PERF_CAPTURE_CONTRACT_METADATA,
  captureScenarioContract,
} from "./perfCaptureContract.mjs";

const FIXTURE_VERSION = "large-files@v4:medium-2k";
const FIXTURE_HASHES = {
  "large-files/medium-2k.ts": "a".repeat(64),
  "monorepo/": "b".repeat(64),
};
const TEN_TARGETS = Array.from({ length: 10 }, (_, index) => `AlphaKind${index}`);
const TOLERANCES = [{ pattern: /^definition$/, budget: 1.25 }];

function samplesOf({ ms, count = 10, resultCount }) {
  return Array.from({ length: count }, () =>
    resultCount === undefined ? { ms } : { ms, resultCount },
  );
}

function scenarioOf(overrides = {}) {
  const {
    id = "definition",
    cutPoint = "provider-ui-ready",
    warmups = 2,
    targets = TEN_TARGETS,
    ms = 100,
    count = 10,
    resultCount,
    ...rest
  } = overrides;

  const samples = rest.samples ?? samplesOf({ ms, count, resultCount });
  const values = samples.map((sample) => sample.ms).sort((left, right) => left - right);
  const middle = Math.floor(values.length / 2);
  const p50 = values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];
  const p95 = values[Math.ceil(values.length * 0.95) - 1];

  return {
    id,
    cutPoint,
    warmups,
    targets,
    samples,
    p50,
    p95,
    status: "ok",
    ...rest,
  };
}

function runOf(overrides = {}) {
  const {
    scenarios = [],
    fixtureVersion = FIXTURE_VERSION,
    fixtureHashes = FIXTURE_HASHES,
    timerQuantizationMs = 1,
    environment,
    failedPaths = [],
  } = overrides;

  return {
    captureContract: PERF_CAPTURE_CONTRACT_METADATA,
    fixtureVersion,
    fixtureHashes,
    environment:
      environment === undefined
        ? {
            bundleMode: "production",
            captureFlavor: "production-instrumented",
            version: "1.0.0",
            sourceRevision: "a".repeat(40),
            artifactSha256: "b".repeat(64),
            bundleManifestSha256: "c".repeat(64),
            capturedAt: "2026-08-03T00:00:00.000Z",
            hostPlatform: "darwin",
            hostArch: "arm64",
            osRelease: "25.0.0",
            launchState: "cold-fresh-profile",
            workspaceState: "fixture-clean",
            timerQuantizationMs,
          }
        : environment,
    failedPaths,
    scenarios,
  };
}

function reportOf({
  codevoScenarios,
  baselineScenarios,
  tolerances = TOLERANCES,
  codevo,
  baseline,
  requiredScenarioIds = [],
}) {
  const withEditor = (run, editor) => ({
    ...run,
    environment: { ...run.environment, editor: run.environment?.editor ?? editor },
  });

  return buildGapReport({
    codevo: withEditor(codevo ?? runOf({ scenarios: codevoScenarios }), "codevo"),
    baseline: withEditor(
      baseline ?? runOf({ scenarios: baselineScenarios, timerQuantizationMs: 0.001 }),
      "vscode",
    ),
    tolerances,
    requiredScenarioIds,
    enforceCaptureContract: false,
  });
}

function rowOf(report, id) {
  return report.rows.find((row) => row.id === id);
}

function comparablePair(overrides = {}) {
  const { codevo = {}, baseline = {}, ...shared } = overrides;

  return {
    codevoScenarios: [scenarioOf({ ...shared, ...codevo })],
    baselineScenarios: [scenarioOf({ ...shared, ...baseline })],
  };
}

function canonicalScenarioOf(editor, id, overrides = {}) {
  const contract = captureScenarioContract(id);
  return scenarioOf({
    id,
    cutPoint: contract.cutPointByEditor[editor],
    comparisonKind: contract.comparisonKind,
    cacheState: contract.cacheState,
    workScope: contract.workScope,
    ...overrides,
  });
}

function canonicalRunOf(editor, scenarios) {
  const seen = new Set(scenarios.map((scenario) => scenario.id));
  const missing = PERF_CAPTURE_CONTRACT.scenarios
    .filter((contract) => contract.cutPointByEditor[editor] !== null && !seen.has(contract.id))
    .map((contract) => ({
      id: contract.id,
      status: "not-run",
      reason: "not measured in this focused contract test",
      cutPoint: contract.cutPointByEditor[editor],
      comparisonKind: contract.comparisonKind,
      cacheState: contract.cacheState,
      workScope: contract.workScope,
    }));
  const run = runOf({ scenarios: [...scenarios, ...missing] });
  return { ...run, environment: { ...run.environment, editor } };
}

describe("run-level fixture verification", () => {
  it("scores only a canonical cross-editor production scenario", () => {
    const id = "file-search-engine";
    const report = buildGapReport({
      codevo: canonicalRunOf("codevo", [canonicalScenarioOf("codevo", id, { resultCount: 10 })]),
      baseline: canonicalRunOf("vscode", [
        canonicalScenarioOf("vscode", id, { ms: 90, resultCount: 10 }),
      ]),
      tolerances: DEFAULT_TOLERANCES,
    });

    expect(report.verification).toMatchObject({
      comparable: true,
      canonicalContractRequired: true,
    });
    expect(rowOf(report, id).status).toBe("pass");
  });

  it("fails the whole run closed for duplicate or unknown scenario ids", () => {
    const fileSearch = canonicalScenarioOf("codevo", "file-search-engine", { resultCount: 10 });
    const duplicate = buildGapReport({
      codevo: canonicalRunOf("codevo", [fileSearch, fileSearch]),
      baseline: canonicalRunOf("vscode", [
        canonicalScenarioOf("vscode", "file-search-engine", { resultCount: 10 }),
      ]),
      tolerances: DEFAULT_TOLERANCES,
    });
    expect(duplicate.verification.reasons.join(" ")).toContain("duplicate scenario id");
    expect(rowOf(duplicate, "file-search-engine").status).toBe("non-comparable");

    const unknown = buildGapReport({
      codevo: canonicalRunOf("codevo", [{ ...fileSearch, id: "unknown-scenario" }]),
      baseline: canonicalRunOf("vscode", []),
      tolerances: DEFAULT_TOLERANCES,
    });
    expect(unknown.verification.reasons.join(" ")).toContain("unknown scenario id");
    expect(unknown.failures[0]).toMatchObject({ id: "run-comparability", status: "invalid" });
  });

  it("keeps a truthfully asymmetric canonical cut point informational", () => {
    const id = "tab-switch-cycle";
    const report = buildGapReport({
      codevo: canonicalRunOf("codevo", [canonicalScenarioOf("codevo", id)]),
      baseline: canonicalRunOf("vscode", [canonicalScenarioOf("vscode", id, { ms: 90 })]),
      tolerances: DEFAULT_TOLERANCES,
    });
    const row = rowOf(report, id);

    expect(report.verification.comparable).toBe(true);
    expect(row.status).toBe("non-comparable");
    expect(row.nonComparableReasons).toContain(
      'capture contract declares comparisonKind "informational-asymmetric"',
    );
  });

  it("accepts a pair whose fixtureVersion, fixtureHashes, and timer metadata agree", () => {
    const report = reportOf(comparablePair({ ms: 100, baseline: { ms: 90 } }));

    expect(report.verification.comparable).toBe(true);
    expect(report.verification.reasons).toEqual([]);
    expect(rowOf(report, "definition").status).toBe("pass");
    expect(renderGapReportMarkdown(report)).toContain(
      "Run comparability: fixture, bundle, platform/architecture, and timer metadata match on both sides.",
    );
  });

  it("fails closed for the historical Codevo dev versus VS Code production comparison", () => {
    const report = reportOf({
      codevo: runOf({
        scenarios: [scenarioOf({})],
        environment: {
          bundleMode: "dev",
          hostPlatform: "darwin",
          hostArch: "arm64",
          timerQuantizationMs: 1,
        },
      }),
      baseline: runOf({ scenarios: [scenarioOf({})], timerQuantizationMs: 0.001 }),
    });

    expect(report.verification.comparable).toBe(false);
    expect(report.verification.reasons).toContain(
      'environment.bundleMode mismatch: Codevo "dev" vs VS Code "production".',
    );
    expect(rowOf(report, "definition").status).toBe("non-comparable");
    expect(renderGapReportMarkdown(report)).not.toContain("| pass |");
  });

  it.each([
    ["version", undefined, "environment.version"],
    ["version", "", "environment.version"],
    ["capturedAt", undefined, "environment.capturedAt"],
    ["capturedAt", "not-a-timestamp", "environment.capturedAt"],
  ])("fails closed when both sides have invalid %s metadata", (field, value, reasonField) => {
    const codevo = runOf({ scenarios: [scenarioOf({})] });
    const baseline = runOf({ scenarios: [scenarioOf({})], timerQuantizationMs: 0.001 });
    codevo.environment = { ...codevo.environment, [field]: value };
    baseline.environment = { ...baseline.environment, [field]: value };
    const report = reportOf({ codevo, baseline });

    expect(report.verification.comparable).toBe(false);
    expect(report.verification.reasons.some((reason) => reason.includes(reasonField))).toBe(true);
    expect(rowOf(report, "definition").status).toBe("non-comparable");
    expect(renderGapReportMarkdown(report)).not.toContain("| pass |");
  });

  it.each([
    ["codevo", "version", "   ", "Codevo"],
    ["baseline", "version", "unknown", "VS Code"],
    ["codevo", "version", "not-a-version", "Codevo"],
    ["baseline", "version", "1.2", "VS Code"],
    ["codevo", "capturedAt", "0", "Codevo"],
    ["baseline", "capturedAt", "2026", "VS Code"],
    ["codevo", "capturedAt", "2026-02-30T00:00:00.000Z", "Codevo"],
    ["baseline", "capturedAt", "2026-08-03T00:00:00Z", "VS Code"],
  ])("fails closed for noncanonical %s-side %s metadata", (side, field, value, label) => {
    const codevo = runOf({ scenarios: [scenarioOf({})] });
    const baseline = runOf({ scenarios: [scenarioOf({})], timerQuantizationMs: 0.001 });
    const target = side === "codevo" ? codevo : baseline;
    target.environment = { ...target.environment, [field]: value };
    const report = reportOf({ codevo, baseline });

    expect(report.verification.comparable).toBe(false);
    expect(report.verification.reasons).toContain(
      field === "version"
        ? `The ${label} run records no valid environment.version.`
        : `The ${label} run records no valid environment.capturedAt.`,
    );
    expect(rowOf(report, "definition").status).toBe("non-comparable");
  });

  it.each([
    ["hostPlatform", "linux"],
    ["hostArch", "x64"],
  ])("fails closed when environment.%s differs", (field, value) => {
    const report = reportOf({
      codevo: runOf({
        scenarios: [scenarioOf({})],
        environment: {
          bundleMode: "production",
          hostPlatform: "darwin",
          hostArch: "arm64",
          timerQuantizationMs: 1,
          [field]: value,
        },
      }),
      baseline: runOf({ scenarios: [scenarioOf({})], timerQuantizationMs: 0.001 }),
    });

    expect(report.verification.comparable).toBe(false);
    expect(report.verification.reasons.join(" ")).toContain(`environment.${field} mismatch`);
  });

  it("rejects swapped or missing editor identities", () => {
    const report = reportOf({
      codevo: runOf({
        scenarios: [scenarioOf({})],
        environment: {
          editor: "vscode",
          bundleMode: "production",
          hostPlatform: "darwin",
          hostArch: "arm64",
          timerQuantizationMs: 1,
        },
      }),
      baseline: runOf({
        scenarios: [scenarioOf({})],
        environment: {
          editor: "codevo",
          bundleMode: "production",
          hostPlatform: "darwin",
          hostArch: "arm64",
          timerQuantizationMs: 0.001,
        },
      }),
    });

    expect(report.verification.comparable).toBe(false);
    expect(report.verification.reasons.join(" ")).toContain(
      'Codevo-side environment.editor must be "codevo"',
    );
    expect(report.verification.reasons.join(" ")).toContain(
      'VS Code-side environment.editor must be "vscode"',
    );
  });

  it("makes the whole comparison non-comparable when fixtureVersion differs", () => {
    const report = reportOf({
      codevo: runOf({ scenarios: [scenarioOf({})], fixtureVersion: "large-files@v3" }),
      baseline: runOf({ scenarios: [scenarioOf({})], timerQuantizationMs: 0.001 }),
    });

    expect(report.verification.comparable).toBe(false);
    expect(rowOf(report, "definition").status).toBe("non-comparable");
    expect(report.failures).toContainEqual(
      expect.objectContaining({ id: "run-comparability", status: "invalid" }),
    );
    expect(renderGapReportMarkdown(report)).toContain("Run comparability: FAILED");
    expect(renderGapReportMarkdown(report)).not.toContain("| pass |");
  });

  it("makes the whole comparison non-comparable when a shared fixture hash differs", () => {
    const report = reportOf({
      codevo: runOf({
        scenarios: [scenarioOf({})],
        fixtureHashes: { ...FIXTURE_HASHES, "large-files/medium-2k.ts": "c".repeat(64) },
      }),
      baseline: runOf({ scenarios: [scenarioOf({})], timerQuantizationMs: 0.001 }),
    });

    expect(report.verification.reasons[0]).toContain("fixtureHash mismatch on 1 of 2");
    expect(rowOf(report, "definition").status).toBe("non-comparable");
    expect(report.failures[0].id).toBe("run-comparability");
  });

  it.each([
    ["codevo", { fixtureHashes: null }, {}],
    ["baseline", {}, { fixtureHashes: null }],
  ])(
    "fails closed when the %s side records no fixtureHashes",
    (_side, codevoOverrides, baselineOverrides) => {
      const report = reportOf({
        codevo: runOf({ scenarios: [scenarioOf({})], ...codevoOverrides }),
        baseline: runOf({
          scenarios: [scenarioOf({})],
          timerQuantizationMs: 0.001,
          ...baselineOverrides,
        }),
      });

      expect(report.verification.comparable).toBe(false);
      expect(report.failures[0].id).toBe("run-comparability");
    },
  );

  it("fails closed when a fixtureHash key exists on only one side", () => {
    const report = reportOf({
      codevo: runOf({
        scenarios: [scenarioOf({})],
        fixtureHashes: { ...FIXTURE_HASHES, "large-files/extra.ts": "e".repeat(64) },
      }),
      baseline: runOf({ scenarios: [scenarioOf({})], timerQuantizationMs: 0.001 }),
    });

    expect(report.verification.reasons).toContain(
      "fixtureHash keys missing from the VS Code baseline: large-files/extra.ts.",
    );
    expect(report.failures[0].id).toBe("run-comparability");
  });

  it("accepts the large-files-plus-aggregate-monorepo key scheme both producers emit", () => {
    const hashes = {
      "large-files/medium-2k.ts": "a".repeat(64),
      "large-files/large-20k.ts": "b".repeat(64),
      "monorepo/": "c".repeat(64),
    };
    const report = reportOf({
      codevo: runOf({ scenarios: [scenarioOf({ ms: 100 })], fixtureHashes: hashes }),
      baseline: runOf({
        scenarios: [scenarioOf({ ms: 90 })],
        fixtureHashes: hashes,
        timerQuantizationMs: 0.001,
      }),
    });

    expect(report.verification.comparable).toBe(true);
    expect(rowOf(report, "definition").status).toBe("pass");
  });

  it("fails closed when the two sides share no fixture path", () => {
    const report = reportOf({
      codevo: runOf({
        scenarios: [scenarioOf({})],
        fixtureHashes: { "large-files/only-here.ts": "d".repeat(64) },
      }),
      baseline: runOf({ scenarios: [scenarioOf({})], timerQuantizationMs: 0.001 }),
    });

    expect(report.verification.reasons).toContain(
      "The Codevo run and the VS Code baseline share no fixture path in fixtureHashes.",
    );
  });

  it.each([
    ["invalid digest", { "large-files/medium-2k.ts": "not-a-sha256" }],
    ["invalid key", { "../large-files/medium-2k.ts": "a".repeat(64) }],
    [
      "partially invalid map",
      { "large-files/medium-2k.ts": "a".repeat(64), "large-files/bad.ts": null },
    ],
  ])("fails closed for an %s fixture hash map", (_label, fixtureHashes) => {
    const report = reportOf({
      codevo: runOf({ scenarios: [scenarioOf({})], fixtureHashes }),
      baseline: runOf({ scenarios: [scenarioOf({})], timerQuantizationMs: 0.001 }),
    });

    expect(report.verification.comparable).toBe(false);
    expect(report.verification.reasons).toContain("The Codevo run records no fixtureHashes.");
  });

  it("fails closed when matching bundle modes are outside the closed schema", () => {
    const environment = {
      bundleMode: "release-ish",
      hostPlatform: "darwin",
      hostArch: "arm64",
      timerQuantizationMs: 1,
    };
    const report = reportOf({
      codevo: runOf({ scenarios: [scenarioOf({})], environment }),
      baseline: runOf({
        scenarios: [scenarioOf({})],
        environment: { ...environment, timerQuantizationMs: 0.001 },
      }),
    });

    expect(report.verification.comparable).toBe(false);
    expect(report.verification.reasons).toContain(
      'Codevo environment.bundleMode is invalid: "release-ish".',
    );
    expect(report.verification.reasons).toContain(
      'VS Code environment.bundleMode is invalid: "release-ish".',
    );
  });

  it("fails closed when a side records no environment.timerQuantizationMs", () => {
    const report = reportOf({
      codevo: runOf({ scenarios: [scenarioOf({})], environment: { platform: "darwin" } }),
      baseline: runOf({ scenarios: [scenarioOf({})], timerQuantizationMs: 0.001 }),
    });

    expect(report.verification.reasons).toContain(
      "The Codevo run records no environment.timerQuantizationMs.",
    );
    expect(report.failures[0].id).toBe("run-comparability");
  });

  it("rejects an old-schema result pair instead of silently comparing it", () => {
    const report = buildGapReport({
      codevo: {
        failedPaths: [],
        fixtureVersion: "large-files@v3:medium-2k+seed2/5/20/100, monorepo@50pkg",
        scenarios: [{ id: "definition", unit: "ms", samples: [7, 8, 9], p50: 8, p95: 9 }],
      },
      baseline: {
        fixtureVersion: "large-files@v3:medium-2k+seed2/5/20/100, monorepo@50pkg",
        scenarios: [{ id: "definition", unit: "ms", samples: [4, 5, 6], p50: 5, p95: 6 }],
      },
      tolerances: TOLERANCES,
    });
    const markdown = renderGapReportMarkdown(report);

    expect(report.verification.comparable).toBe(false);
    expect(report.failures.length).toBeGreaterThan(0);
    expect(markdown).not.toContain("| pass |");
    expect(rowOf(report, "definition").codevoP95).toBeNull();
  });
});

describe("join-time comparability verification", () => {
  it("keeps UI rows non-comparable when window size metadata is absent", () => {
    const report = reportOf(
      comparablePair({ id: "tab-switch-cycle", cutPoint: "tab-switch-rendered" }),
    );
    const row = rowOf(report, "tab-switch-cycle");

    expect(row.status).toBe("non-comparable");
    expect(row.nonComparableReasons).toContain("missing Codevo focus/elevation metadata");
    expect(row.nonComparableReasons).toContain("missing VS Code window-size metadata");
  });

  it("rejects diagnostic elevation even when UI window sizes match", () => {
    const windowSize = { width: 1280, height: 820 };
    const codevo = runOf({
      scenarios: [scenarioOf({ id: "tab-switch-cycle", cutPoint: "tab-switch-rendered" })],
      environment: {
        bundleMode: "production",
        hostPlatform: "darwin",
        hostArch: "arm64",
        timerQuantizationMs: 1,
        windowMode: "always-on-top-diagnostic",
        windowSize,
      },
    });
    const baseline = runOf({
      scenarios: [scenarioOf({ id: "tab-switch-cycle", cutPoint: "tab-switch-rendered" })],
      timerQuantizationMs: 0.001,
      environment: {
        bundleMode: "production",
        hostPlatform: "darwin",
        hostArch: "arm64",
        timerQuantizationMs: 0.001,
        windowMode: "focus-only",
        windowSize,
      },
    });
    const row = rowOf(reportOf({ codevo, baseline }), "tab-switch-cycle");

    expect(row.status).toBe("non-comparable");
    expect(row.nonComparableReasons).toContain(
      'Codevo window mode "always-on-top-diagnostic" is diagnostic and not parity-comparable',
    );
  });

  it("passes a comparable row inside its declared budget and fails it outside", () => {
    const passing = reportOf(comparablePair({ ms: 100, baseline: { ms: 90 } }));
    const failing = reportOf(comparablePair({ ms: 200, baseline: { ms: 90 } }));

    expect(rowOf(passing, "definition")).toMatchObject({ status: "pass", budget: 1.25 });
    expect(passing.failures).toEqual([]);
    expect(rowOf(failing, "definition")).toMatchObject({ status: "fail", budget: 1.25 });
    expect(failing.failures).toContainEqual(expect.objectContaining({ id: "definition" }));
  });

  it("marks a comparable row without a declared budget as no-budget rather than pass", () => {
    const report = reportOf({ ...comparablePair({}), tolerances: [] });

    expect(rowOf(report, "definition")).toMatchObject({
      status: "no-budget",
      budget: null,
      comparable: true,
    });
    expect(report.failures).toContainEqual(
      expect.objectContaining({ id: "definition", status: "no-budget" }),
    );
    expect(renderGapReportMarkdown(report).split("### Non-comparable rows")[0]).toContain(
      "| definition | 100.00 | 100.00 | 1.00 | n/a | no-budget |",
    );
  });

  it("marks a cut-point mismatch non-comparable and names both cut points", () => {
    const report = reportOf(
      comparablePair({
        codevo: { cutPoint: "tab-switch-rendered" },
        baseline: { cutPoint: "tab-switch-open-resolved" },
      }),
    );
    const row = rowOf(report, "definition");

    expect(row.status).toBe("non-comparable");
    expect(row.comparable).toBe(false);
    expect(row.nonComparableReasons).toContain(
      'cut-point mismatch (Codevo "tab-switch-rendered" vs VS Code "tab-switch-open-resolved")',
    );
    expect(report.failures).toEqual([]);
  });

  it.each([
    [
      "the Codevo side",
      { codevo: { cutPoint: null } },
      "missing cut-point metadata on the Codevo side",
    ],
    [
      "the VS Code side",
      { baseline: { cutPoint: null } },
      "missing cut-point metadata on the VS Code side",
    ],
    ["both sides", { cutPoint: null }, "missing cut-point metadata on both sides"],
  ])("treats a cut point missing on %s as asymmetric", (_label, overrides, reason) => {
    const row = rowOf(reportOf(comparablePair(overrides)), "definition");

    expect(row.status).toBe("non-comparable");
    expect(row.nonComparableReasons).toContain(reason);
  });

  it("marks unequal warmups non-comparable", () => {
    const row = rowOf(reportOf(comparablePair({ baseline: { warmups: 5 } })), "definition");

    expect(row.status).toBe("non-comparable");
    expect(row.nonComparableReasons).toContain("warmup mismatch (Codevo 2 vs VS Code 5)");
  });

  it("marks missing warmup metadata non-comparable", () => {
    const row = rowOf(reportOf(comparablePair({ codevo: { warmups: null } })), "definition");

    expect(row.nonComparableReasons).toContain("missing warmup metadata");
  });

  it("marks unequal sample counts non-comparable", () => {
    const row = rowOf(reportOf(comparablePair({ baseline: { count: 5 } })), "definition");

    expect(row.status).toBe("non-comparable");
    expect(row.nonComparableReasons).toContain("sample-count mismatch (Codevo 10 vs VS Code 5)");
  });

  it("marks a rotated-versus-repeated target set non-comparable", () => {
    const repeated = Array.from({ length: 10 }, () => "AlphaKind0");
    const row = rowOf(reportOf(comparablePair({ codevo: { targets: repeated } })), "definition");

    expect(row.status).toBe("non-comparable");
    expect(row.nonComparableReasons).toContain("target-set mismatch (9 of 10 differ in order)");
  });

  it("marks missing target metadata non-comparable", () => {
    const row = rowOf(reportOf(comparablePair({ baseline: { targets: null } })), "definition");

    expect(row.nonComparableReasons).toContain("missing target metadata");
  });
});

describe("count-sensitive scenarios", () => {
  it("keeps a count-sensitive row comparable when result counts agree within 10%", () => {
    const report = reportOf(
      comparablePair({
        id: "references",
        resultCount: 100,
        baseline: { resultCount: 109 },
      }),
    );

    expect(rowOf(report, "references").status).toBe("no-budget");
    expect(rowOf(report, "references").nonComparableReasons).toEqual([]);
  });

  it("marks the unbounded completion row non-comparable-by-counts with an informational ratio", () => {
    const report = reportOf(
      comparablePair({
        id: "completion-unbounded",
        resultCount: 2000,
        baseline: { resultCount: 27759 },
      }),
    );
    const row = rowOf(report, "completion-unbounded");

    expect(row.status).toBe("non-comparable");
    expect(row.nonComparableReasons).toContain(
      "non-comparable-by-counts (10 of 10 targets differ by more than 10%)",
    );
    expect(row.resultCountRatio).toBeCloseTo(2000 / 27759, 10);
    expect(renderGapReportMarkdown(report)).toContain(
      "Result-count ratio (informational): completion-unbounded - Codevo returned 0.07x the VS Code result count",
    );
  });

  it("stays silent about result counts when both sides agree", () => {
    const report = reportOf(
      comparablePair({ id: "references", resultCount: 100, baseline: { resultCount: 109 } }),
    );

    expect(renderGapReportMarkdown(report)).not.toContain("Result-count ratio");
  });

  it("marks a count-sensitive row with no recorded resultCount non-comparable", () => {
    const row = rowOf(
      reportOf(comparablePair({ id: "file-search-engine", resultCount: undefined })),
      "file-search-engine",
    );

    expect(row.status).toBe("non-comparable");
    expect(row.nonComparableReasons).toContain(
      "missing per-sample resultCount metadata on a count-sensitive scenario",
    );
  });

  it("treats a legitimately empty file-search query as parity rather than a divide by zero", () => {
    const emptyQuerySamples = [
      { ms: 50, resultCount: 80 },
      { ms: 60, resultCount: 0 },
      { ms: 70, resultCount: 80 },
    ];
    const report = reportOf({
      codevoScenarios: [scenarioOf({ id: "file-search-engine", samples: emptyQuerySamples })],
      baselineScenarios: [scenarioOf({ id: "file-search-engine", samples: emptyQuerySamples })],
    });
    const row = rowOf(report, "file-search-engine");

    expect(row.nonComparableReasons).toEqual([]);
    expect(row.comparable).toBe(true);
    expect(row.resultCountRatio).toBe(1);
  });

  it("still rejects a target that is empty on one side only", () => {
    const report = reportOf({
      codevoScenarios: [
        { ...scenarioOf({ id: "file-search-engine" }), samples: [{ ms: 5, resultCount: 0 }] },
      ],
      baselineScenarios: [
        { ...scenarioOf({ id: "file-search-engine" }), samples: [{ ms: 5, resultCount: 80 }] },
      ],
    });

    expect(rowOf(report, "file-search-engine").nonComparableReasons).toContain(
      "non-comparable-by-counts (1 of 1 targets differ by more than 10%)",
    );
  });

  it("ignores result-count divergence on a scenario that is not count sensitive", () => {
    const report = reportOf(
      comparablePair({ id: "definition", resultCount: 1, baseline: { resultCount: 40 } }),
    );

    expect(rowOf(report, "definition").status).toBe("pass");
  });
});

describe("timer quantization", () => {
  it("flags a median pinned at zero by a 1 ms clock instead of printing a green pass", () => {
    const quantizedTyping = scenarioOf({
      id: "typing-large-5k",
      cutPoint: "typing-dispatch",
      samples: [
        { ms: 0 },
        { ms: 0 },
        { ms: 0 },
        { ms: 0 },
        { ms: 0 },
        { ms: 0 },
        { ms: 0 },
        { ms: 0 },
        { ms: 1 },
        { ms: 1 },
      ],
    });
    const report = reportOf({
      codevo: runOf({ scenarios: [quantizedTyping], timerQuantizationMs: 1 }),
      baseline: runOf({
        scenarios: [
          scenarioOf({
            id: "typing-large-5k",
            cutPoint: "typing-dispatch",
            samples: Array.from({ length: 10 }, (_, index) => ({ ms: 3 + index * 0.05 })),
          }),
        ],
        timerQuantizationMs: 0.0001,
      }),
      tolerances: [{ pattern: /^typing/, budget: 1.25 }],
    });
    const row = rowOf(report, "typing-large-5k");
    const markdown = renderGapReportMarkdown(report);

    expect(row.codevoMedian).toBe(0);
    expect(row.codevoP95).toBe(1);
    expect(row.ratio).toBeLessThan(1);
    expect(row.quantizationLimited).toEqual(["Codevo"]);
    expect(row.nonComparableReasons).toContain("quantization-limited on the Codevo side");
    expect(row.status).toBe("non-comparable");
    expect(row.comparable).toBe(false);
    expect(row.budget).toBeNull();
    expect(report.failures).toEqual([]);
    expect(markdown).not.toContain("| pass |");
    expect(markdown.split("### Non-comparable rows")[0]).not.toContain("| typing-large-5k |");
    expect(markdown).toContain(
      "Quantization-limited (informational, never pass/fail): typing-large-5k",
    );
  });

  it("flags a zero median on the VS Code side too", () => {
    const report = reportOf({
      codevo: runOf({
        scenarios: [scenarioOf({ samples: [{ ms: 400 }, { ms: 400 }, { ms: 400 }] })],
        timerQuantizationMs: 1,
      }),
      baseline: runOf({
        scenarios: [scenarioOf({ samples: [{ ms: 0 }, { ms: 0 }, { ms: 2 }] })],
        timerQuantizationMs: 1,
      }),
    });
    const row = rowOf(report, "definition");

    expect(row.vscodeMedian).toBe(0);
    expect(row.quantizationLimited).toEqual(["VS Code"]);
    expect(row.nonComparableReasons).toEqual(["quantization-limited on the VS Code side"]);
    expect(row.status).toBe("non-comparable");
  });

  it("does not flag a zero median when the side reports a perfect clock", () => {
    const report = reportOf({
      codevo: runOf({
        scenarios: [scenarioOf({ samples: [{ ms: 0 }, { ms: 0 }, { ms: 90 }] })],
        timerQuantizationMs: 0,
      }),
      baseline: runOf({
        scenarios: [scenarioOf({ samples: [{ ms: 0 }, { ms: 0 }, { ms: 90 }] })],
        timerQuantizationMs: 0,
      }),
    });
    const row = rowOf(report, "definition");

    expect(row.codevoMedian).toBe(0);
    expect(row.quantizationLimited).toEqual([]);
    expect(row.nonComparableReasons).toEqual([]);
    expect(row.status).toBe("pass");
  });

  it("marks a row quantization-limited when a median sits under ten timer ticks", () => {
    const report = reportOf({
      codevo: runOf({ scenarios: [scenarioOf({ ms: 4 })], timerQuantizationMs: 1 }),
      baseline: runOf({ scenarios: [scenarioOf({ ms: 4 })], timerQuantizationMs: 0.001 }),
    });
    const row = rowOf(report, "definition");

    expect(row.quantizationLimited).toEqual(["Codevo"]);
    expect(row.status).toBe("non-comparable");
    expect(row.nonComparableReasons).toContain("quantization-limited on the Codevo side");
    expect(renderGapReportMarkdown(report)).toContain(
      "Quantization-limited (informational, never pass/fail): definition",
    );
  });

  it("never lets a quantization-limited row read as pass or fail", () => {
    const report = reportOf({
      codevo: runOf({ scenarios: [scenarioOf({ ms: 4 })], timerQuantizationMs: 1 }),
      baseline: runOf({ scenarios: [scenarioOf({ ms: 400 })], timerQuantizationMs: 0.001 }),
    });
    const markdown = renderGapReportMarkdown(report);

    expect(rowOf(report, "definition").status).toBe("non-comparable");
    expect(markdown).not.toContain("| pass |");
    expect(markdown).not.toContain("| fail |");
  });

  it("leaves a median well above the quantization floor unflagged", () => {
    const report = reportOf(comparablePair({ ms: 100, baseline: { ms: 90 } }));

    expect(rowOf(report, "definition").quantizationLimited).toEqual([]);
  });
});

describe("reported scenario statuses", () => {
  it.each(["invalid", "not-run", "skipped", "policy-disabled", "no-result"])(
    "treats a reported %s status as a blocking failure",
    (status) => {
      const report = reportOf({
        codevoScenarios: [scenarioOf({ status, reason: `reported ${status}` })],
        baselineScenarios: [scenarioOf({})],
      });
      const row = rowOf(report, "definition");

      expect(row.status).toBe(status);
      expect(row.comparable).toBe(false);
      expect(report.failures).toContainEqual(expect.objectContaining({ id: "definition", status }));
      expect(renderGapReportMarkdown(report)).not.toContain("| pass |");
    },
  );

  it("exempts a declared large-file capability row from the failure gate", () => {
    const [capabilityId] = CAPABILITY_GAP_SCENARIO_IDS;
    const report = reportOf({
      codevoScenarios: [
        {
          id: capabilityId,
          unit: "ms",
          status: "policy-disabled",
          reason: "large-document policy (5000 lines / 256 KiB) disables JS/TS features",
        },
      ],
      baselineScenarios: [scenarioOf({ id: capabilityId, ms: 316, resultCount: 27759 })],
    });
    const row = rowOf(report, capabilityId);
    const markdown = renderGapReportMarkdown(report);

    expect(row).toMatchObject({ capabilityGap: true, status: "non-comparable", comparable: false });
    expect(row.nonComparableReasons).toEqual([
      "declared large-file capability gap: Codevo's large-document policy disables the feature on this fixture by design",
    ]);
    expect(report.failures).toEqual([]);
    expect(markdown.split("### Blocked rows")[1]).toContain("No blocked rows.");
    expect(markdown).toContain(`| ${capabilityId} | disabled | 316.00 |`);
    expect(markdown).toContain(`Capability gap: ${capabilityId} - VS Code measured 316.00 ms`);
    expect(markdown).not.toContain("| pass |");
  });

  it("still fails an unexpected policy-disabled status on a comparable fixture", () => {
    const report = reportOf({
      codevoScenarios: [
        scenarioOf({
          id: "definition-medium-2k",
          status: "policy-disabled",
          reason: "unexpected policy verdict on the canonical fixture",
        }),
      ],
      baselineScenarios: [scenarioOf({ id: "definition-medium-2k" })],
    });
    const row = rowOf(report, "definition-medium-2k");

    expect(row.capabilityGap).toBe(false);
    expect(row.status).toBe("policy-disabled");
    expect(report.failures).toContainEqual(
      expect.objectContaining({ id: "definition-medium-2k", status: "policy-disabled" }),
    );
  });

  it("derives the capability-gap carve-out from the scenario registry, not the status alone", () => {
    expect(CAPABILITY_GAP_SCENARIO_IDS).toEqual(
      PERF_SCENARIOS.filter((scenario) => scenario.kind === "capability").map(
        (scenario) => scenario.id,
      ),
    );
    expect(CAPABILITY_GAP_SCENARIO_IDS.length).toBeGreaterThan(0);
    expect(CAPABILITY_GAP_SCENARIO_IDS.every((id) => id.endsWith("-large-20k"))).toBe(true);
  });

  it("treats a declared non-comparable scenario as informational, not a failure", () => {
    const contract = captureScenarioContract("quickopen-ui");
    const report = reportOf({
      codevoScenarios: [
        {
          id: contract.id,
          status: "non-comparable",
          reason: "not comparable in this lane",
          cutPoint: contract.cutPointByEditor.codevo,
          comparisonKind: contract.comparisonKind,
          cacheState: contract.cacheState,
          workScope: contract.workScope,
        },
      ],
      baselineScenarios: [],
    });
    const row = rowOf(report, "quickopen-ui");

    expect(row.status).toBe("non-comparable");
    expect(row.nonComparableReasons).toContain(
      "the Codevo run declared this scenario non-comparable",
    );
    expect(report.failures).toEqual([]);
  });

  it("never demands a VS Code counterpart for a Codevo-only cut point", () => {
    const report = reportOf({
      codevoScenarios: [scenarioOf({ id: "quickopen-ui", cutPoint: "quickopen-ui" })],
      baselineScenarios: [],
    });
    const row = rowOf(report, "quickopen-ui");

    expect(row.status).toBe("non-comparable");
    expect(row.nonComparableReasons).toContain(
      'Codevo-only absolute-budget row (cut point "quickopen-ui"); the VS Code extension host cannot measure it',
    );
    expect(report.failures).toEqual([]);
  });

  it("keeps demanding a counterpart for a cross-editor cut point", () => {
    const report = reportOf({
      codevoScenarios: [scenarioOf({ id: "typing", cutPoint: "typing-dispatch" })],
      baselineScenarios: [],
    });

    expect(rowOf(report, "typing").status).toBe("no-baseline");
  });

  it("rejects a status outside the contract's closed set", () => {
    const report = reportOf({
      codevoScenarios: [scenarioOf({ status: "totally-unrecognized-status" })],
      baselineScenarios: [scenarioOf({})],
    });

    expect(rowOf(report, "definition").status).toBe("invalid");
    expect(report.failures).toContainEqual(
      expect.objectContaining({ id: "definition", status: "invalid" }),
    );
  });

  it("blocks a row whose VS Code baseline reports a failing status", () => {
    const report = reportOf({
      codevoScenarios: [scenarioOf({})],
      baselineScenarios: [scenarioOf({ status: "not-run", reason: "baseline never ran it" })],
    });

    expect(rowOf(report, "definition").status).toBe("no-baseline");
  });

  it("blocks a Codevo row that has no baseline counterpart and no declaration", () => {
    const report = reportOf({ codevoScenarios: [scenarioOf({})], baselineScenarios: [] });

    expect(rowOf(report, "definition").status).toBe("no-baseline");
    expect(report.failures).toContainEqual(
      expect.objectContaining({ id: "definition", status: "no-baseline" }),
    );
  });

  it("blocks a baseline row the Codevo run never produced", () => {
    const report = reportOf({ codevoScenarios: [], baselineScenarios: [scenarioOf({})] });

    expect(rowOf(report, "definition").status).toBe("no-result");
  });

  it("keeps every registered scenario missing from both inputs as a no-result failure", () => {
    const required = PERF_SCENARIOS.filter((scenario) => scenario.id !== "memory-sample");
    const report = buildGapReport({
      codevo: runOf({ scenarios: [] }),
      baseline: runOf({ scenarios: [], timerQuantizationMs: 0.001 }),
      tolerances: TOLERANCES,
    });

    expect(report.rows).toHaveLength(required.length);
    expect(report.failures.filter((row) => row.status === "no-result")).toHaveLength(
      required.length,
    );
  });

  it("excludes the memory-sample scenario from the joined rows", () => {
    const report = reportOf({
      codevoScenarios: [scenarioOf({}), { id: "memory-sample", retainedCounts: { models: 1 } }],
      baselineScenarios: [scenarioOf({})],
    });

    expect(rowOf(report, "memory-sample")).toBeUndefined();
  });
});

describe("unusable measurements", () => {
  it.each([
    ["numeric samples from the old schema", [7, 8, 9]],
    ["an empty sample list", []],
    ["a sample without a numeric ms", [{ resultCount: 3 }]],
    ["a negative sample", [{ ms: -1 }]],
    ["a sparse sample list", new Array(3)],
  ])("fails closed on %s", (_label, samples) => {
    const report = reportOf({
      codevoScenarios: [{ ...scenarioOf({}), samples }],
      baselineScenarios: [scenarioOf({})],
    });

    expect(rowOf(report, "definition")).toMatchObject({ codevoP95: null, status: "invalid" });
    expect(renderGapReportMarkdown(report)).not.toContain("NaN");
  });

  it("fails closed when the VS Code p95 is not positive", () => {
    const report = reportOf(comparablePair({ baseline: { ms: 0 } }));

    expect(rowOf(report, "definition")).toMatchObject({ vscodeP95: null, status: "invalid" });
  });
});

describe("renderGapReportMarkdown", () => {
  it("separates comparable, non-comparable, and blocked rows into their own tables", () => {
    const report = reportOf({
      codevoScenarios: [
        scenarioOf({ id: "definition", ms: 100 }),
        scenarioOf({ id: "tab-switch", cutPoint: "tab-switch-rendered" }),
        { id: "rename", status: "skipped", reason: "no rename data" },
      ],
      baselineScenarios: [
        scenarioOf({ id: "definition", ms: 90 }),
        scenarioOf({ id: "tab-switch", cutPoint: "tab-switch-open-resolved" }),
        scenarioOf({ id: "rename" }),
      ],
    });
    const markdown = renderGapReportMarkdown(report);

    expect(markdown).toContain("### Comparable rows");
    expect(markdown).toContain(COMPARABLE_TABLE_HEADER);
    expect(markdown).toContain(
      "### Non-comparable rows (informational only - no VS Code parity claim)",
    );
    expect(markdown).toContain(NON_COMPARABLE_TABLE_HEADER);
    expect(markdown).toContain("### Blocked rows (fail closed)");
    expect(markdown).toContain(BLOCKED_TABLE_HEADER);

    const comparableSection = markdown.split("### Non-comparable rows")[0];
    expect(comparableSection).toContain("| definition |");
    expect(comparableSection).not.toContain("| tab-switch |");
    expect(comparableSection).not.toContain("| rename |");
  });

  it("prints a real budget only on comparable rows and never a stale one elsewhere", () => {
    const report = reportOf({
      codevoScenarios: [
        scenarioOf({ id: "definition", ms: 100 }),
        scenarioOf({ id: "tab-switch", cutPoint: "tab-switch-rendered" }),
      ],
      baselineScenarios: [
        scenarioOf({ id: "definition", ms: 90 }),
        scenarioOf({ id: "tab-switch", cutPoint: "tab-switch-open-resolved" }),
      ],
      tolerances: [
        { pattern: /^definition$/, budget: 1.25 },
        { pattern: /^tab-switch$/, budget: 1.5 },
      ],
    });

    expect(rowOf(report, "definition").budget).toBe(1.25);
    expect(rowOf(report, "tab-switch").budget).toBeNull();
    expect(renderGapReportMarkdown(report).split("### Non-comparable rows")[0]).toContain(
      "| definition | 100.00 | 90.00 | 1.11 | 1.25 | pass |",
    );
    expect(renderGapReportMarkdown(report)).toContain(
      "Budget is printed only for comparable rows and only where a tolerance declares one",
    );
    expect(NON_COMPARABLE_TABLE_HEADER).not.toContain("Budget");
  });

  it("keeps the floor-adjusted tab-switch ratio informational with its legend", () => {
    const report = reportOf({
      codevoScenarios: [
        scenarioOf({
          id: "tab-switch",
          cutPoint: "tab-switch-rendered",
          ms: 93,
          frameSettleFloorMs: 33,
        }),
      ],
      baselineScenarios: [
        scenarioOf({ id: "tab-switch", cutPoint: "tab-switch-open-resolved", ms: 37 }),
      ],
    });
    const row = rowOf(report, "tab-switch");
    const markdown = renderGapReportMarkdown(report);

    expect(row.ratio).toBeCloseTo(93 / 37, 10);
    expect(row.floorAdjustedRatio).toBeCloseTo((93 - 33) / 37, 10);
    expect(markdown).toContain("| tab-switch | 93.00 | 37.00 | 2.51 | 1.62 |");
    expect(markdown).toContain(
      "Floor-adj ratio is informational only and never affects Status: it subtracts the scenario's own declared frameSettleFloorMs from the Codevo p95 before dividing",
    );
    expect(markdown).not.toContain("| pass |");
  });

  it("derives the cut-point asymmetry caveat without either side declaring a note", () => {
    const report = reportOf({
      codevoScenarios: [scenarioOf({ id: "tab-switch", cutPoint: "tab-switch-rendered" })],
      baselineScenarios: [scenarioOf({ id: "tab-switch", cutPoint: "tab-switch-open-resolved" })],
    });

    expect(renderGapReportMarkdown(report)).toContain(
      "Cut-point asymmetry: tab-switch - Codevo: tab-switch-rendered; VS Code: tab-switch-open-resolved. The Ratio column compares different measurement windows.",
    );
  });

  it("treats a cut point missing on one side as asymmetric in the rendered caveat", () => {
    const report = reportOf(comparablePair({ id: "typing", baseline: { cutPoint: null } }));

    expect(renderGapReportMarkdown(report)).toContain(
      "Cut-point asymmetry: typing - Codevo: provider-ui-ready; VS Code: no cut point recorded.",
    );
  });

  it("stays silent about cut points when both sides recorded the same one", () => {
    const report = reportOf(comparablePair({ ms: 100, baseline: { ms: 90 } }));

    expect(renderGapReportMarkdown(report)).not.toContain("Cut-point asymmetry:");
  });

  it("carries the recorded language server status as informational text", () => {
    const report = reportOf(
      comparablePair({ id: "typing", codevo: { languageServerStatus: "running" } }),
    );

    expect(rowOf(report, "typing").languageServerStatus).toBe("running");
    expect(renderGapReportMarkdown(report)).toContain(
      "JS/TS language server status at scenario start (informational): typing - running.",
    );
  });

  it("renders the failed-paths note and never a literal NaN", () => {
    const report = reportOf({
      codevo: runOf({ scenarios: [scenarioOf({})], failedPaths: ["src/foo.ts", "src/bar.ts"] }),
      baseline: runOf({ scenarios: [scenarioOf({})], timerQuantizationMs: 0.001 }),
    });
    const markdown = renderGapReportMarkdown(report);

    expect(markdown).toContain("Failed paths: 2 (src/foo.ts, src/bar.ts)");
    expect(markdown).not.toContain("NaN");
  });

  it("keeps the default tolerance table exported for the CLI entry point", () => {
    expect(Array.isArray(DEFAULT_TOLERANCES)).toBe(true);
    expect(DEFAULT_TOLERANCES.every((entry) => entry.pattern instanceof RegExp)).toBe(true);
  });
});
