import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import {
  MAX_CAPTURE_JSON_BYTES,
  PERF_CAPTURE_CONTRACT,
  PERF_CAPTURE_CONTRACT_METADATA,
  parseCaptureRunJson,
} from "./perfCaptureContract.mjs";
import { POLICY_DISABLED_REASON } from "./perfScenarios.mjs";

export const CLEAN_RUN_COUNT = 3;
export const CONFIRMATION_RUN_COUNT = 1;
export const PERF_AGGREGATE_KIND = "codevo-vscode-production-multirun";

const DIAGNOSTIC_ENVIRONMENT_KEYS = [
  "appActivationTransitions",
  "diagnosticSpaceLease",
  "domWindowSignalCount",
  "keyTransitions",
  "minimizeTransitions",
  "occlusionTransitions",
  "onActiveSpaceAtRelease",
  "transitionOverflow",
  "windowInterruptionCount",
  "windowInterruptionStages",
  "windowRecoveryInterventionCount",
  "windowStability",
  "windowStabilityEpoch",
];
const COMMON_ENVIRONMENT_KEYS = [
  "bundleMode",
  "captureFlavor",
  "hostArch",
  "hostPlatform",
  "launchState",
  "osRelease",
  "workspaceState",
];
const SIDE_ENVIRONMENT_KEYS = [
  ...COMMON_ENVIRONMENT_KEYS,
  "arch",
  "artifactIdentity",
  "artifactSha256",
  "bundleManifestSha256",
  "commit",
  "editor",
  "executableIdentity",
  "platform",
  "sourceRevision",
  "strictMode",
  "version",
  "windowMode",
  "windowSize",
];
const SCENARIO_PROTOCOL_KEYS = [
  "cacheState",
  "comparisonKind",
  "cutPoint",
  "languageServerStatus",
  "method",
  "status",
  "targets",
  "unit",
  "warmups",
  "windowNote",
  "workScope",
];
const CAPABILITY_IDS = new Set(
  PERF_CAPTURE_CONTRACT.scenarios
    .filter((scenario) => scenario.comparisonKind === "capability")
    .map((scenario) => scenario.id),
);
const LARGE_100K_CAPABILITY_METHODS = new Map([
  ["completion-large-100k", "executeCompletionItemProvider"],
  ["definition-large-100k", "executeDefinitionProvider"],
  ["references-large-100k", "executeReferenceProvider"],
  ["rename-large-100k", "executeDocumentRenameProvider"],
]);
const CODEVO_CAPABILITY_KEYS = [
  "cacheState",
  "comparisonKind",
  "cutPoint",
  "id",
  "method",
  "reason",
  "samples",
  "status",
  "targets",
  "unit",
  "warmups",
  "workScope",
];
const VSCODE_CAPABILITY_OK_KEYS = [
  "cacheState",
  "comparisonKind",
  "cutPoint",
  "id",
  "languageServerStatus",
  "method",
  "resultCount",
  "samples",
  "status",
  "targets",
  "unit",
  "warmups",
  "workScope",
];
const VSCODE_CAPABILITY_NO_RESULT_KEYS = [
  "cacheState",
  "comparisonKind",
  "cutPoint",
  "error",
  "id",
  "samples",
  "status",
  "targets",
  "warmups",
  "workScope",
];

export async function aggregatePerfRunFiles(input) {
  const normalized = assertInputShape(input);
  const loaded = {
    codevo: await loadSide("codevo", normalized.codevo),
    vscode: await loadSide("vscode", normalized.vscode),
  };

  assertDistinctRuns(loaded);
  assertCompatibleCohort(loaded);
  return buildAggregateArtifact(loaded);
}

export async function readCanonicalPerfRun(filePath, expectedEditor) {
  if (typeof filePath !== "string" || filePath.length === 0 || !path.isAbsolute(filePath)) {
    throw new Error(`${expectedEditor} capture paths must be explicit absolute paths.`);
  }

  const canonicalPath = await realpath(filePath);
  const descriptor = await open(canonicalPath, "r");

  try {
    const stat = await descriptor.stat();
    if (!stat.isFile()) {
      throw new Error(`Perf capture ${canonicalPath} is not a regular file.`);
    }
    if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > MAX_CAPTURE_JSON_BYTES) {
      throw new Error(
        `Perf capture ${canonicalPath} is ${String(stat.size)} bytes, above the ${MAX_CAPTURE_JSON_BYTES} byte bound.`,
      );
    }

    const rawBytes = await readBoundedDescriptor(descriptor);
    let raw;
    try {
      raw = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
    } catch {
      throw new Error(`Perf capture ${canonicalPath} is not valid UTF-8.`);
    }
    const run = parseCaptureRunJson(raw, { expectedEditor });
    return {
      canonicalPath,
      rawSha256: createHash("sha256").update(rawBytes).digest("hex"),
      run,
    };
  } finally {
    await descriptor.close();
  }
}

function assertInputShape(input) {
  if (!exactKeys(input, ["codevo", "vscode"])) {
    throw new Error("Aggregate input must be a closed {codevo, vscode} object.");
  }

  for (const editor of ["codevo", "vscode"]) {
    const side = input[editor];
    if (!exactKeys(side, ["clean", "confirmation"])) {
      throw new Error(`${editor} input must be a closed {clean, confirmation} object.`);
    }
    if (!Array.isArray(side.clean) || side.clean.length !== CLEAN_RUN_COUNT) {
      throw new Error(`${editor} requires exactly ${CLEAN_RUN_COUNT} clean capture paths.`);
    }
    if (typeof side.confirmation !== "string" || side.confirmation.length === 0) {
      throw new Error(`${editor} requires exactly one confirmation capture path.`);
    }
  }

  return input;
}

async function loadSide(editor, input) {
  const clean = await Promise.all(
    input.clean.map(async (filePath, index) => ({
      ...(await readCanonicalPerfRun(filePath, editor)),
      ordinal: index + 1,
      role: "clean",
    })),
  );
  const confirmation = {
    ...(await readCanonicalPerfRun(input.confirmation, editor)),
    ordinal: 1,
    role: "confirmation",
  };

  return { clean, confirmation };
}

async function readBoundedDescriptor(descriptor) {
  const chunks = [];
  let total = 0;

  while (total <= MAX_CAPTURE_JSON_BYTES) {
    const remaining = MAX_CAPTURE_JSON_BYTES + 1 - total;
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
    const { bytesRead } = await descriptor.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) return Buffer.concat(chunks, total);
    chunks.push(buffer.subarray(0, bytesRead));
    total += bytesRead;
  }

  throw new Error(
    `Perf capture grew above the ${MAX_CAPTURE_JSON_BYTES} byte bound while reading.`,
  );
}

function assertDistinctRuns(loaded) {
  const all = allRecords(loaded);
  assertUnique(all, (record) => record.canonicalPath, "input file");
  assertUnique(all, (record) => record.rawSha256, "raw capture identity");
  assertUnique(all, (record) => capturedAtOf(record), "capture timestamp");

  for (const record of all) {
    if (record.run.capturedAt !== record.run.environment.capturedAt) {
      throw new Error(
        `${record.run.environment.editor} capture ${record.canonicalPath} has mismatched top-level and environment capturedAt.`,
      );
    }
  }

  const timestamps = new Map(
    all.map((record) => [record, canonicalTimestampMillis(capturedAtOf(record), record)]),
  );

  for (const editor of ["codevo", "vscode"]) {
    const side = loaded[editor];
    const latestClean = Math.max(...side.clean.map((record) => timestamps.get(record)));
    if (timestamps.get(side.confirmation) <= latestClean) {
      throw new Error(`${editor} confirmation must be captured after all three clean runs.`);
    }
  }
}

function assertCompatibleCohort(loaded) {
  const all = allRecords(loaded);
  const first = all[0].run;

  for (const record of all) {
    assertCleanRun(record);
    assertEqual(
      record.run.captureContract,
      first.captureContract,
      "capture contract metadata",
      record,
    );
    assertEqual(record.run.fixtureVersion, first.fixtureVersion, "fixtureVersion", record);
    assertEqual(record.run.fixtureHashes, first.fixtureHashes, "fixtureHashes", record);
  }

  const commonEnvironment = projection(first.environment, COMMON_ENVIRONMENT_KEYS);
  for (const record of all.slice(1)) {
    assertEqual(
      projection(record.run.environment, COMMON_ENVIRONMENT_KEYS),
      commonEnvironment,
      "shared measurement environment",
      record,
    );
  }

  for (const editor of ["codevo", "vscode"]) {
    const records = sideRecords(loaded[editor]);
    const sideEnvironment = projection(records[0].run.environment, SIDE_ENVIRONMENT_KEYS);
    const scenarioProtocols = scenarioProtocolMap(records[0].run);
    for (const record of records.slice(1)) {
      assertEqual(
        projection(record.run.environment, SIDE_ENVIRONMENT_KEYS),
        sideEnvironment,
        `${editor} editor/source environment`,
        record,
      );
      assertEqual(
        scenarioProtocolMap(record.run),
        scenarioProtocols,
        `${editor} scenario protocol`,
        record,
      );
    }
  }

  assertCrossEditorScenarioCompatibility(loaded);
}

function assertCleanRun(record) {
  const { run } = record;
  const editor = run.environment.editor;
  if (
    (editor === "codevo" && run.environment.windowMode !== "focus-only") ||
    (editor === "vscode" && !["focus-only", "unknown"].includes(run.environment.windowMode)) ||
    (editor === "codevo" && run.environment.strictMode !== true) ||
    run.environment.strictMode === false
  ) {
    throw new Error(`${editor} ${record.role} run is not a strict focus-only production capture.`);
  }
  const diagnosticKey = DIAGNOSTIC_ENVIRONMENT_KEYS.find((key) =>
    Object.hasOwn(run.environment, key),
  );
  if (diagnosticKey !== undefined) {
    throw new Error(`${editor} ${record.role} run contains diagnostic environment metadata.`);
  }
  if (!Array.isArray(run.failedPaths) || run.failedPaths.length !== 0) {
    throw new Error(`${editor} ${record.role} run contains failed paths.`);
  }
  if (!finitePositive(run.environment.timerQuantizationMs)) {
    throw new Error(
      `${editor} ${record.role} run has no finite positive timer quantization provenance.`,
    );
  }

  for (const scenario of run.scenarios) {
    if (scenario.status === "non-comparable" || scenario.diagnosticEvidence !== undefined) {
      throw new Error(`Scenario "${scenario.id}" contains diagnostic/non-comparable evidence.`);
    }
    if (LARGE_100K_CAPABILITY_METHODS.has(scenario.id)) {
      assertLarge100kCapabilitySemantics(editor, scenario);
      continue;
    }
    if (scenario.status === "policy-disabled") {
      if (!CAPABILITY_IDS.has(scenario.id)) {
        throw new Error(`Scenario "${scenario.id}" misuses policy-disabled status.`);
      }
      continue;
    }
    if (scenario.status !== "ok") {
      throw new Error(
        `Scenario "${scenario.id}" is ${JSON.stringify(scenario.status)}, so the run is not clean.`,
      );
    }
  }
}

function assertLarge100kCapabilitySemantics(editor, scenario) {
  if (editor === "codevo") {
    if (
      !exactKeys(scenario, CODEVO_CAPABILITY_KEYS) ||
      scenario.status !== "policy-disabled" ||
      scenario.unit !== "observation" ||
      scenario.method !== "metrics-derived-effective-tier" ||
      scenario.reason !== POLICY_DISABLED_REASON ||
      scenario.warmups !== 0 ||
      !emptyDenseArray(scenario.samples) ||
      !emptyDenseArray(scenario.targets)
    ) {
      throw new Error(
        `Codevo scenario "${scenario.id}" does not prove the metrics-derived editing-only/full-sync-utf16-limit capability.`,
      );
    }
    return;
  }

  if (scenario.status === "ok") {
    if (
      !exactKeys(scenario, VSCODE_CAPABILITY_OK_KEYS) ||
      scenario.unit !== "observation" ||
      scenario.method !== LARGE_100K_CAPABILITY_METHODS.get(scenario.id) ||
      scenario.languageServerStatus !== "running" ||
      !Number.isSafeInteger(scenario.resultCount) ||
      scenario.resultCount <= 0 ||
      scenario.warmups !== 0 ||
      !emptyDenseArray(scenario.samples) ||
      !emptyDenseArray(scenario.targets)
    ) {
      throw new Error(
        `VS Code scenario "${scenario.id}" does not match its bounded provider capability probe.`,
      );
    }
    return;
  }

  if (
    scenario.status !== "no-result" ||
    !exactKeys(scenario, VSCODE_CAPABILITY_NO_RESULT_KEYS) ||
    scenario.warmups !== 0 ||
    !emptyDenseArray(scenario.samples) ||
    !emptyDenseArray(scenario.targets) ||
    !validVscodeCapabilityNoResult(scenario)
  ) {
    throw new Error(
      `VS Code scenario "${scenario.id}" does not match an explicit bounded provider no-result.`,
    );
  }
}

function validVscodeCapabilityNoResult(scenario) {
  if (scenario.error === "provider capability returned no result") return true;
  if (scenario.id === "completion-large-100k") {
    return (
      scenario.error ===
      "large-100k.ts contains no bounded blank-line anchor for completion capability"
    );
  }
  return (
    scenario.error ===
    "large-100k.ts contains no `*Kind` declaration and field usage within the bounded anchor scan"
  );
}

function emptyDenseArray(value) {
  return Array.isArray(value) && value.length === 0;
}

function assertCrossEditorScenarioCompatibility(loaded) {
  const codevo = loaded.codevo.clean[0].run;
  const vscode = loaded.vscode.clean[0].run;

  for (const contract of PERF_CAPTURE_CONTRACT.scenarios) {
    if (contract.comparisonKind !== "cross-editor") continue;
    const codevoScenario = codevo.scenarios.find((scenario) => scenario.id === contract.id);
    const vscodeScenario = vscode.scenarios.find((scenario) => scenario.id === contract.id);
    if (codevoScenario === undefined || vscodeScenario === undefined) {
      throw new Error(`Cross-editor scenario "${contract.id}" is absent on one editor side.`);
    }
    const keys = ["cacheState", "comparisonKind", "cutPoint", "unit", "warmups", "workScope"];
    const codevoProtocol = {
      ...projection(codevoScenario, keys),
      targets: codevoScenario.targets ?? [],
      sampleCount: codevoScenario.samples?.length ?? 0,
      sampleResultCounts: codevoScenario.samples?.map((sample) => sample.resultCount ?? null) ?? [],
      resultCount: codevoScenario.resultCount ?? null,
    };
    const vscodeProtocol = {
      ...projection(vscodeScenario, keys),
      targets: vscodeScenario.targets ?? [],
      sampleCount: vscodeScenario.samples?.length ?? 0,
      sampleResultCounts: vscodeScenario.samples?.map((sample) => sample.resultCount ?? null) ?? [],
      resultCount: vscodeScenario.resultCount ?? null,
    };
    if (canonicalJson(codevoProtocol) !== canonicalJson(vscodeProtocol)) {
      throw new Error(`Cross-editor scenario "${contract.id}" has incompatible work protocol.`);
    }
  }
}

function buildAggregateArtifact(loaded) {
  const codevoRecords = sideRecords(loaded.codevo);
  const vscodeRecords = sideRecords(loaded.vscode);
  const scenarioIds = PERF_CAPTURE_CONTRACT.scenarios.map((scenario) => scenario.id);
  const first = codevoRecords[0].run;

  return {
    schemaVersion: 1,
    kind: PERF_AGGREGATE_KIND,
    canonicalCapture: false,
    methodology: {
      cleanRunsPerEditor: CLEAN_RUN_COUNT,
      confirmationRunsPerEditor: CONFIRMATION_RUN_COUNT,
      primaryStatistic: "median-of-three-clean-run-level-percentiles",
      confirmationTreatment: "reported-separately-not-folded-into-clean-median",
      varianceBand: "min-max-of-three-clean-run-level-percentiles",
    },
    captureContract: { ...PERF_CAPTURE_CONTRACT_METADATA },
    fixture: {
      version: first.fixtureVersion,
      hashes: sortedObject(first.fixtureHashes),
    },
    environment: {
      shared: projection(first.environment, COMMON_ENVIRONMENT_KEYS),
      codevo: projection(codevoRecords[0].run.environment, SIDE_ENVIRONMENT_KEYS),
      vscode: projection(vscodeRecords[0].run.environment, SIDE_ENVIRONMENT_KEYS),
    },
    inputs: {
      codevo: codevoRecords.map(runProvenance),
      vscode: vscodeRecords.map(runProvenance),
    },
    scenarios: scenarioIds
      .map((id) => {
        const contract = PERF_CAPTURE_CONTRACT.scenarios.find((scenario) => scenario.id === id);
        const codevo = summarizeScenario(id, loaded.codevo);
        const vscode = summarizeScenario(id, loaded.vscode);
        if (codevo === null && vscode === null) return null;
        return {
          id,
          comparisonKind: contract.comparisonKind,
          workScope: contract.workScope,
          codevo,
          vscode,
          parityEligibility: parityEligibility(contract, codevo, vscode),
        };
      })
      .filter((scenario) => scenario !== null),
  };
}

function summarizeScenario(id, side) {
  const records = sideRecords(side);
  const observations = records
    .map((record) => ({ record, scenario: record.run.scenarios.find((entry) => entry.id === id) }))
    .filter(({ scenario }) => scenario !== undefined);
  if (observations.length === 0) return null;
  if (observations.length !== records.length) {
    throw new Error(`Scenario "${id}" is not present in every run on one editor side.`);
  }

  const evidence = observations.map(({ record, scenario }) => ({
    role: record.role,
    ordinal: record.ordinal,
    runIdentity: record.rawSha256,
    capturedAt: capturedAtOf(record),
    status: scenario.status,
    reason: scenario.reason ?? null,
    error: scenario.error ?? null,
    p50: scenario.p50 ?? null,
    p95: scenario.p95 ?? null,
    timerQuantizationMs: record.run.environment.timerQuantizationMs,
    quantizationLimited:
      scenario.p50 !== undefined && scenario.p50 < 10 * record.run.environment.timerQuantizationMs,
    samples: Array.isArray(scenario.samples)
      ? scenario.samples.map((sample) => ({ ...sample }))
      : [],
    sampleCount: Array.isArray(scenario.samples) ? scenario.samples.length : 0,
    sampleResultCounts: Array.isArray(scenario.samples)
      ? scenario.samples.map((sample) => sample.resultCount ?? null)
      : [],
    resultCount: scenario.resultCount ?? null,
    targets: Array.isArray(scenario.targets) ? [...scenario.targets] : [],
    pairs: Array.isArray(scenario.pairs) ? scenario.pairs.map((pair) => ({ ...pair })) : [],
  }));
  const clean = observations.slice(0, CLEAN_RUN_COUNT);
  const confirmation = observations[CLEAN_RUN_COUNT];
  const protocol = projection(observations[0].scenario, SCENARIO_PROTOCOL_KEYS);
  if (records[0].run.environment.editor === "codevo" && LARGE_100K_CAPABILITY_METHODS.has(id)) {
    protocol.reason = observations[0].scenario.reason;
  }

  return {
    status: observations[0].scenario.status,
    quantizationLimited: evidence.some((entry) => entry.quantizationLimited),
    protocol,
    p50: metricSummary(clean, confirmation, "p50"),
    p95: metricSummary(clean, confirmation, "p95"),
    evidence,
  };
}

function parityEligibility(contract, codevo, vscode) {
  if (contract.comparisonKind !== "cross-editor") {
    return {
      eligible: false,
      reason: `comparisonKind is ${contract.comparisonKind}, not cross-editor`,
    };
  }
  const limitedEditors = [
    ...(codevo?.quantizationLimited ? ["codevo"] : []),
    ...(vscode?.quantizationLimited ? ["vscode"] : []),
  ];
  if (limitedEditors.length > 0) {
    return {
      eligible: false,
      reason: `timer-quantization-limited on ${limitedEditors.join(" and ")}`,
    };
  }
  return { eligible: true, reason: null };
}

function metricSummary(clean, confirmation, key) {
  const values = clean.map(({ scenario }) => scenario[key]);
  if (values.every((value) => value === undefined)) {
    if (confirmation.scenario[key] !== undefined) {
      throw new Error(`Confirmation ${key} exists when clean runs have no ${key}.`);
    }
    return null;
  }
  if (!values.every(finiteNonnegative) || !finiteNonnegative(confirmation.scenario[key])) {
    throw new Error(`Scenario run-level ${key} values are incomplete or invalid.`);
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    median: sorted[1],
    min: sorted[0],
    max: sorted[2],
    spread: sorted[2] - sorted[0],
    cleanValues: values,
    confirmation: confirmation.scenario[key],
  };
}

function runProvenance(record) {
  const environment = record.run.environment;
  return {
    role: record.role,
    ordinal: record.ordinal,
    file: path.basename(record.canonicalPath),
    runIdentity: record.rawSha256,
    capturedAt: capturedAtOf(record),
    artifactSha256: environment.artifactSha256,
    bundleManifestSha256: environment.bundleManifestSha256 ?? null,
    timerQuantizationMs: environment.timerQuantizationMs,
  };
}

function scenarioProtocolMap(run) {
  return Object.fromEntries(
    [...run.scenarios]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((scenario) => [
        scenario.id,
        {
          ...projection(scenario, SCENARIO_PROTOCOL_KEYS),
          sampleCount: Array.isArray(scenario.samples) ? scenario.samples.length : 0,
        },
      ]),
  );
}

function projection(value, keys) {
  return Object.fromEntries(
    keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, cloneJsonValue(value[key])]),
  );
}

function cloneJsonValue(value) {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]),
    );
  }
  return value;
}

function sortedObject(value) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function allRecords(loaded) {
  return [...sideRecords(loaded.codevo), ...sideRecords(loaded.vscode)];
}

function sideRecords(side) {
  return [...side.clean, side.confirmation];
}

function capturedAtOf(record) {
  return record.run.environment.capturedAt;
}

function canonicalTimestampMillis(value, record) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(
      `${record.run.environment.editor} ${record.role} run has a non-canonical capture timestamp.`,
    );
  }
  return timestamp;
}

function assertUnique(records, readValue, label) {
  const seen = new Set();
  for (const record of records) {
    const value = readValue(record);
    if (seen.has(value)) throw new Error(`Duplicate ${label} is not an independent run: ${value}.`);
    seen.add(value);
  }
}

function assertEqual(actual, expected, label, record) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(
      `${record.run.environment.editor} ${record.role} run has incompatible ${label}.`,
    );
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function exactKeys(value, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function finiteNonnegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finitePositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
