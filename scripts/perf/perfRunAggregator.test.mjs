import { Buffer } from "node:buffer";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PERF_CAPTURE_CONTRACT, PERF_CAPTURE_CONTRACT_METADATA } from "./perfCaptureContract.mjs";
import { POLICY_DISABLED_REASON } from "./perfScenarios.mjs";
import {
  PERF_AGGREGATE_KIND,
  aggregatePerfRunFiles,
  readCanonicalPerfRun,
} from "./perfRunAggregator.mjs";

const temporaryRoots = [];
const FIXTURE_HASH = "a".repeat(64);

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("perfRunAggregator", () => {
  it("builds a separate closed aggregate and keeps confirmation out of the clean median", async () => {
    const cohort = await writeCohort({
      mutateRun(run, { editor, role, ordinal }) {
        if (editor !== "codevo") return;
        const scenario = scenarioOf(run, "typing-large-5k");
        const value = role === "confirmation" ? 500 : [11, 99, 13][ordinal - 1];
        setSamples(scenario, Array(50).fill(value));
      },
    });

    const aggregate = await aggregatePerfRunFiles(cohort);
    const typing = aggregate.scenarios.find((scenario) => scenario.id === "typing-large-5k");

    expect(Object.keys(aggregate).sort()).toEqual([
      "canonicalCapture",
      "captureContract",
      "environment",
      "fixture",
      "inputs",
      "kind",
      "methodology",
      "scenarios",
      "schemaVersion",
    ]);
    expect(aggregate.kind).toBe(PERF_AGGREGATE_KIND);
    expect(aggregate.canonicalCapture).toBe(false);
    expect(typing.codevo.p50).toEqual({
      median: 13,
      min: 11,
      max: 99,
      spread: 88,
      cleanValues: [11, 99, 13],
      confirmation: 500,
    });
    expect(typing.codevo.evidence).toHaveLength(4);
    expect(typing.codevo.evidence[3]).toMatchObject({
      role: "confirmation",
      sampleCount: 50,
    });
    expect(typing.codevo.evidence[3].targets).toHaveLength(50);
    expect(typing.codevo.evidence[3].samples).toHaveLength(50);
    expect(typing.codevo.evidence[3].samples.every((sample) => sample.ms === 500)).toBe(true);
    expect(aggregate.inputs.codevo.every((input) => !path.isAbsolute(input.file))).toBe(true);
    const codevoCapability = aggregate.scenarios.find(
      (scenario) => scenario.id === "completion-large-100k",
    );
    expect(codevoCapability.codevo.protocol.reason).toBe(POLICY_DISABLED_REASON);
    expect(codevoCapability.codevo.evidence[0]).toMatchObject({
      status: "policy-disabled",
      reason: POLICY_DISABLED_REASON,
      error: null,
    });
  });

  it("rejects the wrong number of clean runs before reading files", async () => {
    await expect(
      aggregatePerfRunFiles({
        codevo: { clean: [], confirmation: "/missing" },
        vscode: { clean: [], confirmation: "/missing" },
      }),
    ).rejects.toThrow(/exactly 3 clean/);
  });

  it("rejects duplicate raw captures even when supplied through aliases", async () => {
    const cohort = await writeCohort();
    cohort.codevo.clean[1] = cohort.codevo.clean[0];

    await expect(aggregatePerfRunFiles(cohort)).rejects.toThrow(/Duplicate input file/);
  });

  it("rejects duplicate timestamps across otherwise distinct captures", async () => {
    const cohort = await writeCohort({
      mutateRun(run, { editor, role, ordinal }) {
        if (editor === "codevo" && role === "clean" && ordinal === 2) {
          run.capturedAt = "2026-08-06T00:00:01.000Z";
          run.environment.capturedAt = run.capturedAt;
        }
      },
    });

    await expect(aggregatePerfRunFiles(cohort)).rejects.toThrow(/Duplicate capture timestamp/);
  });

  it("rejects a top-level timestamp that disagrees with environment provenance", async () => {
    const cohort = await writeCohort({
      mutateRun(run, { editor, role }) {
        if (editor === "codevo" && role === "confirmation") {
          run.capturedAt = "2026-08-06T00:00:09.000Z";
        }
      },
    });

    await expect(aggregatePerfRunFiles(cohort)).rejects.toThrow(/mismatched top-level/);
  });

  it("requires confirmation to follow all clean captures", async () => {
    const cohort = await writeCohort({
      mutateRun(run, { editor, role }) {
        if (editor === "vscode" && role === "confirmation") {
          run.capturedAt = "2026-08-05T23:59:59.000Z";
          run.environment.capturedAt = run.capturedAt;
        }
      },
    });

    await expect(aggregatePerfRunFiles(cohort)).rejects.toThrow(
      /confirmation must be captured after/,
    );
  });

  it("rejects semantically invalid timestamps even when they match the contract regex", async () => {
    const cohort = await writeCohort({
      mutateRun(run, { editor, role }) {
        if (editor === "codevo" && role === "confirmation") {
          run.capturedAt = "2026-99-99T99:99:99.000Z";
          run.environment.capturedAt = run.capturedAt;
        }
      },
    });

    await expect(aggregatePerfRunFiles(cohort)).rejects.toThrow(/non-canonical capture timestamp/);
  });

  it.each([
    ["host", (run) => (run.environment.hostArch = "x64"), /shared measurement environment/],
    ["editor version", (run) => (run.environment.version = "9.9.9"), /editor\/source environment/],
    [
      "source revision",
      (run) => (run.environment.sourceRevision = "b".repeat(40)),
      /editor\/source environment/,
    ],
    [
      "artifact",
      (run) => (run.environment.artifactSha256 = "b".repeat(64)),
      /editor\/source environment/,
    ],
    [
      "window size",
      (run) => (run.environment.windowSize.width = 1200),
      /editor\/source environment/,
    ],
    [
      "fixture",
      (run) => (run.fixtureHashes["large-files/test.ts"] = "b".repeat(64)),
      /fixtureHashes/,
    ],
    [
      "target order",
      (run) => scenarioOf(run, "typing-large-5k").targets.reverse(),
      /scenario protocol/,
    ],
    [
      "sample count",
      (run) => setSamples(scenarioOf(run, "typing-large-5k"), [5, 5, 5, 5]),
      /must record exactly 50 samples/,
    ],
  ])("rejects mixed %s cohorts", async (_label, mutate, expected) => {
    const cohort = await writeCohort({
      mutateRun(run, { editor, role, ordinal }) {
        if (editor === "codevo" && role === "clean" && ordinal === 2) mutate(run);
      },
    });

    await expect(aggregatePerfRunFiles(cohort)).rejects.toThrow(expected);
  });

  it("rejects diagnostic and non-comparable status misuse", async () => {
    const cohort = await writeCohort({
      mutateRun(run, { editor, role, ordinal }) {
        if (editor === "codevo" && role === "clean" && ordinal === 1) {
          const scenario = scenarioOf(run, "typing-large-5k");
          scenario.status = "non-comparable";
          delete scenario.samples;
          delete scenario.p50;
          delete scenario.p95;
        }
      },
    });

    await expect(aggregatePerfRunFiles(cohort)).rejects.toThrow(/diagnostic\/non-comparable/);
  });

  it("rejects swapped Codevo and VS Code 100k capability semantics", async () => {
    const codevoInversion = await writeCohort({
      mutateRun(run, { editor }) {
        if (editor !== "codevo") return;
        for (const scenario of capabilityScenarios(run)) setVscodeCapabilityResult(scenario);
      },
    });
    await expect(aggregatePerfRunFiles(codevoInversion)).rejects.toThrow(
      /Codevo scenario .*metrics-derived editing-only/,
    );

    const vscodeInversion = await writeCohort({
      mutateRun(run, { editor }) {
        if (editor !== "vscode") return;
        for (const scenario of capabilityScenarios(run)) setCodevoCapabilityResult(scenario);
      },
    });
    await expect(aggregatePerfRunFiles(vscodeInversion)).rejects.toThrow(
      /VS Code scenario .*bounded provider no-result/,
    );
  });

  it("accepts exact VS Code no-result capability observations without treating them as latency", async () => {
    const cohort = await writeCohort({
      mutateRun(run, { editor, role }) {
        if (editor !== "vscode") return;
        for (const scenario of capabilityScenarios(run)) {
          setVscodeNoResult(scenario);
        }
        if (role === "confirmation") {
          scenarioOf(run, "completion-large-100k").error =
            "large-100k.ts contains no bounded blank-line anchor for completion capability";
        }
      },
    });

    const aggregate = await aggregatePerfRunFiles(cohort);
    const capability = aggregate.scenarios.find(
      (scenario) => scenario.id === "completion-large-100k",
    );
    expect(capability.vscode).toMatchObject({ status: "no-result", p50: null, p95: null });
    expect(capability.vscode.evidence.every((entry) => entry.sampleCount === 0)).toBe(true);
    expect(capability.vscode.evidence.every((entry) => entry.reason === null)).toBe(true);
    expect(capability.vscode.evidence.map((entry) => entry.error)).toEqual([
      "provider capability returned no result",
      "provider capability returned no result",
      "provider capability returned no result",
      "large-100k.ts contains no bounded blank-line anchor for completion capability",
    ]);
  });

  it("rejects missing timing provenance and marks coarse measurements unscoreable", async () => {
    const missing = await writeCohort({
      mutateRun(run, { editor, role, ordinal }) {
        if (editor === "vscode" && role === "clean" && ordinal === 1) {
          delete run.environment.timerQuantizationMs;
        }
      },
    });
    await expect(aggregatePerfRunFiles(missing)).rejects.toThrow(
      /timerQuantizationMs must be finite, strictly positive/,
    );

    const zero = await writeCohort({
      mutateRun(run, { editor, role, ordinal }) {
        if (editor === "vscode" && role === "clean" && ordinal === 1) {
          run.environment.timerQuantizationMs = 0;
        }
      },
    });
    await expect(aggregatePerfRunFiles(zero)).rejects.toThrow(
      /timerQuantizationMs must be finite, strictly positive/,
    );

    const coarse = await writeCohort({
      mutateRun(run, { editor, role, ordinal }) {
        if (editor === "codevo" && role === "clean" && ordinal === 1) {
          run.environment.timerQuantizationMs = 100;
        }
      },
    });
    const aggregate = await aggregatePerfRunFiles(coarse);
    const typing = aggregate.scenarios.find((scenario) => scenario.id === "typing-large-5k");
    expect(typing.codevo.quantizationLimited).toBe(true);
    expect(typing.parityEligibility).toEqual({
      eligible: false,
      reason: "timer-quantization-limited on codevo",
    });
  });

  it.each(["codevo", "vscode"])(
    "rejects an entirely underwarmed 3+1 %s cohort",
    async (underwarmedEditor) => {
      const cohort = await writeCohort({
        mutateRun(run, { editor }) {
          if (editor === underwarmedEditor) {
            scenarioOf(run, "typing-large-5k").warmups = 0;
          }
        },
      });

      await expect(aggregatePerfRunFiles(cohort)).rejects.toThrow(
        /must record exactly 10 warmups for its completed protocol observation/,
      );
    },
  );

  it("accepts actual Codevo/VS environment shapes and rejects cross-editor protocol drift", async () => {
    const compatible = await writeCohort();
    const aggregate = await aggregatePerfRunFiles(compatible);
    const typing = aggregate.scenarios.find((scenario) => scenario.id === "typing-large-5k");
    expect(aggregate.environment).toMatchObject({
      codevo: { strictMode: true, windowMode: "focus-only" },
      vscode: { windowMode: "unknown" },
    });
    expect(aggregate.environment.vscode).not.toHaveProperty("strictMode");
    expect(aggregate.environment.vscode).not.toHaveProperty("windowSize");
    expect(typing.parityEligibility).toEqual({
      eligible: false,
      reason: "timer-quantization-limited on codevo",
    });

    const drifted = await writeCohort({
      mutateRun(run, { editor }) {
        if (editor === "vscode") {
          scenarioOf(run, "typing-large-5k").targets = Array.from(
            { length: 50 },
            (_, index) => `different-${index}.ts`,
          );
        }
      },
    });
    await expect(aggregatePerfRunFiles(drifted)).rejects.toThrow(/incompatible work protocol/);
  });

  it("rejects a canonical diagnostic capture even when its scenarios say ok", async () => {
    const cohort = await writeCohort({
      mutateRun(run, { editor, role, ordinal }) {
        if (editor === "codevo" && role === "clean" && ordinal === 1) {
          run.environment.windowMode = "always-on-top-diagnostic";
          Object.assign(run.environment, {
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
          });
        }
      },
    });

    await expect(aggregatePerfRunFiles(cohort)).rejects.toThrow(/strict focus-only/);
  });

  it("rejects failed paths and incomplete scenario statuses", async () => {
    const withFailure = await writeCohort({
      mutateRun(run, { editor, role, ordinal }) {
        if (editor === "codevo" && role === "clean" && ordinal === 1) {
          run.failedPaths.push("fixture.ts");
        }
      },
    });
    await expect(aggregatePerfRunFiles(withFailure)).rejects.toThrow(/failed paths/);

    const incomplete = await writeCohort({
      mutateRun(run, { editor, role, ordinal }) {
        if (editor === "vscode" && role === "clean" && ordinal === 1) {
          const scenario = scenarioOf(run, "typing-large-5k");
          scenario.status = "not-run";
          scenario.reason = "not run";
          delete scenario.samples;
          delete scenario.p50;
          delete scenario.p95;
        }
      },
    });
    await expect(aggregatePerfRunFiles(incomplete)).rejects.toThrow(/run is not clean/);
  });

  it("delegates duplicate-key and forged-percentile rejection to the canonical parser", async () => {
    const root = await temporaryRoot();
    const duplicatePath = path.join(root, "duplicate.json");
    await writeFile(duplicatePath, '{"capturedAt":"a","capturedAt":"b"}', "utf8");
    await expect(readCanonicalPerfRun(duplicatePath, "codevo")).rejects.toThrow(
      /duplicate object key/,
    );

    const forged = makeRun("codevo", "2026-08-06T00:00:01.000Z", 1);
    scenarioOf(forged, "typing-large-5k").p95 += 1;
    const forgedPath = path.join(root, "forged.json");
    await writeFile(forgedPath, JSON.stringify(forged), "utf8");
    await expect(readCanonicalPerfRun(forgedPath, "codevo")).rejects.toThrow(/exactly match/);
  });

  it("delegates unknown fields, wrong editor and stale work-scope rejection to the canonical parser", async () => {
    const root = await temporaryRoot();
    const cases = [
      ["unknown", (run) => (run.unknown = true), /unknown top-level/],
      ["wrong-editor", (run) => (run.environment.editor = "vscode"), /must be "codevo"/],
      [
        "work-scope",
        (run) => (scenarioOf(run, "typing-large-5k").workScope = "different-work"),
        /workScope must be/,
      ],
      [
        "retired-frame-settle-floor",
        (run) => (scenarioOf(run, "typing-large-5k").frameSettleFloorMs = 33),
        /scenario with unknown fields/,
      ],
    ];

    for (const [name, mutate, expected] of cases) {
      const run = makeRun("codevo", "2026-08-06T00:00:01.000Z", 1);
      mutate(run);
      const filePath = path.join(root, `${name}.json`);
      await writeFile(filePath, JSON.stringify(run), "utf8");
      await expect(readCanonicalPerfRun(filePath, "codevo")).rejects.toThrow(expected);
    }
  });

  it("rejects invalid UTF-8 before canonical JSON parsing", async () => {
    const root = await temporaryRoot();
    const filePath = path.join(root, "invalid-utf8.json");
    await writeFile(filePath, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]));

    await expect(readCanonicalPerfRun(filePath, "codevo")).rejects.toThrow(/not valid UTF-8/);
  });
});

async function writeCohort({ mutateRun = () => {} } = {}) {
  const root = await temporaryRoot();
  const cohort = {
    codevo: { clean: [], confirmation: null },
    vscode: { clean: [], confirmation: null },
  };

  for (const [editor, minute] of [
    ["codevo", 0],
    ["vscode", 10],
  ]) {
    for (let ordinal = 1; ordinal <= 4; ordinal += 1) {
      const role = ordinal === 4 ? "confirmation" : "clean";
      const capturedAt = `2026-08-06T00:${String(minute).padStart(2, "0")}:0${ordinal}.000Z`;
      const run = makeRun(editor, capturedAt, ordinal);
      mutateRun(run, { editor, role, ordinal: role === "clean" ? ordinal : 1 });
      const filePath = path.join(root, `${editor}-${role}-${ordinal}.json`);
      await writeFile(filePath, JSON.stringify(run), "utf8");
      if (role === "clean") cohort[editor].clean.push(filePath);
      else cohort[editor].confirmation = filePath;
    }
  }

  return cohort;
}

function makeRun(editor, capturedAt, ordinal) {
  const environment = {
    editor,
    version: editor === "codevo" ? "0.1.0" : "1.132.0",
    sourceRevision: editor === "codevo" ? "1".repeat(40) : "2".repeat(40),
    artifactSha256: editor === "codevo" ? "3".repeat(64) : "4".repeat(64),
    bundleMode: "production",
    captureFlavor: "production-instrumented",
    launchState: "cold-fresh-profile",
    workspaceState: "fixture-clean",
    hostPlatform: "darwin",
    hostArch: "arm64",
    osRelease: "25.6.0",
    windowMode: editor === "codevo" ? "focus-only" : "unknown",
    ...(editor === "codevo" ? { windowSize: { width: 1600, height: 1000 }, strictMode: true } : {}),
    timerQuantizationMs: editor === "codevo" ? 1 : 0.001,
    capturedAt,
  };
  if (editor === "codevo") environment.bundleManifestSha256 = "5".repeat(64);

  return {
    captureContract: { ...PERF_CAPTURE_CONTRACT_METADATA },
    capturedAt,
    fixtureVersion: "fixture-v1",
    fixtureHashes: { "large-files/test.ts": FIXTURE_HASH },
    environment,
    failedPaths: [],
    scenarios: PERF_CAPTURE_CONTRACT.scenarios
      .filter((contract) => contract.cutPointByEditor[editor] !== null)
      .map((contract, index) => makeScenario(contract, editor, index + ordinal)),
  };
}

function makeScenario(contract, editor, seed) {
  const scenario = {
    id: contract.id,
    cutPoint: contract.cutPointByEditor[editor],
    comparisonKind: contract.comparisonKind,
    cacheState: contract.cacheState,
    workScope: contract.workScope,
    status: "ok",
  };
  if (contract.id === "memory-sample") {
    scenario.unit = "bytes/count";
    scenario.retainedCounts = { editors: 1, models: 2 };
    scenario.memorySample = { usedJsHeapBytes: 1024 };
    return scenario;
  }
  if (contract.maxSamples === 0) {
    if (editor === "codevo") setCodevoCapabilityResult(scenario);
    else setVscodeCapabilityResult(scenario);
    return scenario;
  }

  scenario.unit = "ms";
  scenario.warmups = contract.requiredWarmups;
  scenario.targets = Array.from(
    { length: contract.requiredTargets },
    (_, index) => `fixture-${index}.ts`,
  );
  scenario.method = "test-method";
  scenario.languageServerStatus = "running";
  setSamples(
    scenario,
    Array.from({ length: contract.minSamples }, (_, index) => seed + (index % 3)),
  );
  return scenario;
}

function capabilityScenarios(run) {
  return run.scenarios.filter((scenario) =>
    ["completion", "definition", "references", "rename"].some(
      (kind) => scenario.id === `${kind}-large-100k`,
    ),
  );
}

function setCodevoCapabilityResult(scenario) {
  clearCapabilityFields(scenario);
  Object.assign(scenario, {
    unit: "observation",
    samples: [],
    targets: [],
    warmups: 0,
    method: "metrics-derived-effective-tier",
    status: "policy-disabled",
    reason: POLICY_DISABLED_REASON,
  });
}

function setVscodeCapabilityResult(scenario) {
  clearCapabilityFields(scenario);
  Object.assign(scenario, {
    unit: "observation",
    samples: [],
    targets: [],
    warmups: 0,
    method: vscodeCapabilityMethod(scenario.id),
    resultCount: 1,
    languageServerStatus: "running",
    status: "ok",
  });
}

function setVscodeNoResult(scenario) {
  clearCapabilityFields(scenario);
  Object.assign(scenario, {
    status: "no-result",
    error: "provider capability returned no result",
    warmups: 0,
    samples: [],
    targets: [],
  });
}

function clearCapabilityFields(scenario) {
  for (const key of [
    "error",
    "languageServerStatus",
    "method",
    "reason",
    "resultCount",
    "samples",
    "targets",
    "unit",
    "warmups",
  ]) {
    delete scenario[key];
  }
}

function vscodeCapabilityMethod(id) {
  if (id === "completion-large-100k") return "executeCompletionItemProvider";
  if (id === "definition-large-100k") return "executeDefinitionProvider";
  if (id === "references-large-100k") return "executeReferenceProvider";
  return "executeDocumentRenameProvider";
}

function setSamples(scenario, values) {
  scenario.samples = values.map((ms) => ({ ms, resultCount: 10 }));
  scenario.p50 = percentile(values, 0.5);
  scenario.p95 = percentile(values, 0.95);
  scenario.resultCount = 10;
}

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  if (quantile === 0.5) {
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  }
  return sorted[Math.ceil(sorted.length * quantile) - 1];
}

function scenarioOf(run, id) {
  return run.scenarios.find((scenario) => scenario.id === id);
}

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "codevo-perf-aggregate-test-"));
  temporaryRoots.push(root);
  return root;
}
