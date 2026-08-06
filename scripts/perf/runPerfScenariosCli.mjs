import path from "node:path";
import { Buffer } from "node:buffer";
import {
  DIAGNOSTIC_SMOKE_EVIDENCE,
  FIXTURE_VERSION,
  LANGUAGE_SERVER_STATUS_KINDS,
  PERF_SMOKE_SCENARIO_IDS,
  PERF_SCENARIOS,
  inPagePerfRunnerSource,
  isKnownScenarioStatus,
} from "./perfScenarios.mjs";
import { PERF_CAPTURE_CONTRACT, assertBoundedCaptureJson } from "./perfCaptureContract.mjs";

const DEFAULT_WAIT_MS = 10000;
const DEFAULT_INTERVAL_MS = 100;
const MANUAL_RESULT_LABEL = "--from-json file";
const REQUIRED_TRACKER_STATS = ["count", "last", "min", "max", "median", "p95"];
const REQUIRED_ENVIRONMENT_FIELDS = [
  "editor",
  "bundleMode",
  "windowMode",
  "hostPlatform",
  "hostArch",
  "timerQuantizationMs",
  "capturedAt",
];
const MEMORY_SAMPLE_ID = "memory-sample";
const OK_SCENARIO_STATUS = "ok";
const POLICY_DISABLED_STATUS = "policy-disabled";
const NON_COMPARABLE_STATUS = "non-comparable";
const DIAGNOSTIC_WINDOW_MODE = "always-on-top-diagnostic";
const CAPABILITY_SCENARIO_KIND = "capability";
const MAX_RETAINED_EDITOR_OBJECTS = 1_000_000;
const MAX_REPORTED_HEAP_BYTES = 2 ** 50;
const MAX_TIMER_QUANTIZATION_MS = 1_000;
const SHA256 = /^[a-f0-9]{64}$/;
const RUNNER_RESULT_KEYS = [
  "bridgeResults",
  "environment",
  "failedPaths",
  "memorySample",
  "retainedCounts",
  "scenarioStatuses",
  "trackerSnapshot",
];
const ENVIRONMENT_KEYS = new Set([
  "appActivationTransitions",
  "artifactSha256",
  "bundleManifestSha256",
  "bundleMode",
  "captureFlavor",
  "capturedAt",
  "diagnosticSpaceLease",
  "domWindowSignalCount",
  "editor",
  "hostArch",
  "hostPlatform",
  "keyTransitions",
  "launchState",
  "minimizeTransitions",
  "occlusionTransitions",
  "onActiveSpaceAtRelease",
  "osRelease",
  "platform",
  "sourceRevision",
  "strictMode",
  "timerQuantizationMs",
  "transitionOverflow",
  "version",
  "windowInterruptionCount",
  "windowInterruptionStages",
  "windowMode",
  "windowRecoveryInterventionCount",
  "windowSize",
  "windowStability",
  "windowStabilityEpoch",
  "workspaceState",
]);
const BRIDGE_RESULT_KEYS = new Set([
  "cutPoint",
  "id",
  "languageServerStatus",
  "previousSwitchPath",
  "resultCounts",
  "samples",
  "switchPaths",
  "targets",
  "warmups",
  "windowNote",
]);

export const SMOKE_SCENARIO_IDS = PERF_SMOKE_SCENARIO_IDS;
export const CAPABILITY_GAP_SCENARIO_IDS = capabilityGapScenarioIds();

const CAPABILITY_GAP_SCENARIO_ID_SET = new Set(CAPABILITY_GAP_SCENARIO_IDS);

function capabilityGapScenarioIds() {
  if (!Array.isArray(PERF_SCENARIOS)) {
    return [];
  }

  return PERF_SCENARIOS.filter((scenario) => scenario?.kind === CAPABILITY_SCENARIO_KIND)
    .map((scenario) => scenario.id)
    .filter((id) => typeof id === "string");
}

export function isDeclaredCapabilityGap(scenario) {
  return (
    scenario?.status === POLICY_DISABLED_STATUS && CAPABILITY_GAP_SCENARIO_ID_SET.has(scenario.id)
  );
}

export function buildRunnerOptions({ smoke, repoRoot }) {
  return {
    smoke,
    largeFilesRoot: path.join(repoRoot, "perf/fixtures/large-files"),
    monorepoRoot: path.join(repoRoot, "perf/fixtures/monorepo"),
    fixtureVersion: FIXTURE_VERSION,
    waitMs: DEFAULT_WAIT_MS,
    intervalMs: DEFAULT_INTERVAL_MS,
  };
}

export function buildSnippetExpression(options) {
  return `(${inPagePerfRunnerSource()})(${JSON.stringify(options)})`;
}

export function parseManualResult(raw) {
  assertBoundedCaptureJson(raw);
  return normalizeRunnerResult(parseJson(raw), MANUAL_RESULT_LABEL);
}

export function capturedAtForImportedResult(result) {
  const capturedAt = result?.environment?.capturedAt;

  if (
    typeof capturedAt !== "string" ||
    capturedAt.length === 0 ||
    !Number.isFinite(Date.parse(capturedAt))
  ) {
    throw new Error(
      "--from-json requires environment.capturedAt from the measurement itself; ingestion time is not capture provenance.",
    );
  }

  return capturedAt;
}

export function normalizeRunnerResult(parsed, label = MANUAL_RESULT_LABEL) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  if (!Object.keys(parsed).every((key) => RUNNER_RESULT_KEYS.includes(key))) {
    throw new Error(`${label} contains an unknown top-level result field.`);
  }

  assertBridgeResults(parsed.bridgeResults, label);
  assertTrackerSnapshot(parsed.trackerSnapshot, label);
  assertScenarioStatuses(parsed.scenarioStatuses, label);
  assertEnvironment(parsed.environment, label);
  assertFailedPaths(parsed.failedPaths, label);
  assertRetainedCounts(parsed.retainedCounts, label);
  assertMemorySample(parsed.memorySample, label);

  return {
    bridgeResults: parsed.bridgeResults,
    trackerSnapshot: parsed.trackerSnapshot,
    scenarioStatuses: parsed.scenarioStatuses ?? [],
    environment: parsed.environment ?? null,
    retainedCounts: parsed.retainedCounts ?? null,
    memorySample: parsed.memorySample ?? null,
    failedPaths: parsed.failedPaths,
  };
}

function assertEnvironment(value, label) {
  if (value === undefined || value === null) {
    return;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} "environment" must be an object when present.`);
  }

  if (!Object.keys(value).every((key) => ENVIRONMENT_KEYS.has(key))) {
    throw new Error(`${label} "environment" contains an unknown field.`);
  }

  for (const [field, fieldValue] of Object.entries(value)) {
    if (!validEnvironmentField(field, fieldValue)) {
      throw new Error(`${label} "environment.${field}" is invalid or exceeds its bound.`);
    }
  }
}

function validEnvironmentField(field, value) {
  if (field === "editor") return value === "codevo";
  if (field === "bundleMode") return value === "dev" || value === "production";
  if (field === "captureFlavor") return value === "production-instrumented";
  if (field === "artifactSha256" || field === "bundleManifestSha256") {
    return typeof value === "string" && SHA256.test(value);
  }
  if (field === "windowMode") {
    return value === "focus-only" || value === "always-on-top-diagnostic" || value === "unknown";
  }
  if (field === "windowStability") {
    return value === "diagnostic-space-lease" || value === "recovered-diagnostic";
  }
  if (
    field === "strictMode" ||
    field === "diagnosticSpaceLease" ||
    field === "onActiveSpaceAtRelease" ||
    field === "transitionOverflow"
  ) {
    return typeof value === "boolean";
  }
  if (field === "timerQuantizationMs") {
    return isFiniteNonnegativeNumber(value) && value <= MAX_TIMER_QUANTIZATION_MS;
  }
  if (field === "windowSize") {
    return (
      exactObjectKeys(value, ["height", "width"]) &&
      isBoundedNonnegativeSafeInteger(value.width, 100_000) &&
      isBoundedNonnegativeSafeInteger(value.height, 100_000)
    );
  }
  if (field === "windowInterruptionStages") {
    return (
      Array.isArray(value) &&
      value.length <= 3 &&
      everyOwnArrayEntry(
        value,
        (stage) =>
          typeof stage === "string" && stage.length > 0 && Buffer.byteLength(stage, "utf8") <= 64,
      )
    );
  }
  if (field === "domWindowSignalCount") {
    return isBoundedNonnegativeSafeInteger(value, 64);
  }
  if (field === "windowInterruptionCount" || field === "windowRecoveryInterventionCount") {
    return isBoundedNonnegativeSafeInteger(value, 3);
  }
  if (
    field === "appActivationTransitions" ||
    field === "keyTransitions" ||
    field === "minimizeTransitions" ||
    field === "occlusionTransitions" ||
    field === "windowStabilityEpoch"
  ) {
    return isBoundedNonnegativeSafeInteger(value, 1_024);
  }
  if (field === "capturedAt") {
    return boundedMetadataString(value) && Number.isFinite(Date.parse(value));
  }
  return boundedMetadataString(value);
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${MANUAL_RESULT_LABEL} is not valid JSON: ${detail}`);
  }
}

function assertBridgeResults(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} is missing a "bridgeResults" array.`);
  }

  if (value.length > PERF_CAPTURE_CONTRACT.limits.maxScenarios) {
    throw new Error(`${label} "bridgeResults" exceeds the scenario count bound.`);
  }

  const ids = new Set();

  const isValid = everyOwnArrayEntry(value, (entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !Object.keys(entry).every((key) => BRIDGE_RESULT_KEYS.has(key)) ||
      !boundedMetadataString(entry.id) ||
      ids.has(entry.id) ||
      !Array.isArray(entry.samples) ||
      entry.samples.length > PERF_CAPTURE_CONTRACT.limits.maxSamplesPerScenario ||
      !everyOwnArrayEntry(entry.samples, isFiniteNonnegativeNumber) ||
      !validOptionalResultCounts(entry.resultCounts, entry.samples.length) ||
      !validOptionalBoundedStringArray(entry.targets) ||
      !validOptionalBoundedString(entry.windowNote) ||
      !validOptionalBoundedString(entry.cutPoint) ||
      !validOptionalWarmups(entry.warmups) ||
      !validOptionalSwitchPaths(entry.switchPaths, entry.samples.length) ||
      !validOptionalBoundedString(entry.previousSwitchPath) ||
      !validOptionalLanguageServerStatus(entry.languageServerStatus) ||
      (entry.targets !== undefined && entry.targets.length !== entry.samples.length)
    ) {
      return false;
    }
    ids.add(entry.id);
    return true;
  });

  if (isValid) {
    return;
  }

  throw new Error(
    `${label} "bridgeResults" entries must have unique bounded ids, dense bounded finite ` +
      "nonnegative numeric samples, and bounded targets/window metadata.",
  );
}

function assertTrackerSnapshot(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} is missing a "trackerSnapshot" array.`);
  }

  if (value.length > PERF_CAPTURE_CONTRACT.limits.maxScenarios) {
    throw new Error(`${label} "trackerSnapshot" exceeds the tracker count bound.`);
  }

  const kinds = new Set();

  const isValid = everyOwnArrayEntry(value, (entry) => {
    if (!(
      entry &&
      typeof entry === "object" &&
      exactObjectKeys(entry, ["kind", "stats"]) &&
      boundedMetadataString(entry.kind) &&
      !kinds.has(entry.kind) &&
      entry.stats &&
      typeof entry.stats === "object" &&
      !Array.isArray(entry.stats) &&
      exactObjectKeys(entry.stats, REQUIRED_TRACKER_STATS) &&
      REQUIRED_TRACKER_STATS.every((stat) => isFiniteNonnegativeNumber(entry.stats[stat]))
    )) {
      return false;
    }
    kinds.add(entry.kind);
    return true;
  });

  if (isValid) {
    return;
  }

  throw new Error(
    `${label} "trackerSnapshot" entries must each have a string kind and finite nonnegative numeric stats: ${REQUIRED_TRACKER_STATS.join(", ")}.`,
  );
}

function isFiniteNonnegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isBoundedNonnegativeSafeInteger(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function boundedMetadataString(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= PERF_CAPTURE_CONTRACT.limits.maxMetadataStringBytes
  );
}

function validOptionalBoundedString(value) {
  return value === undefined || boundedMetadataString(value);
}

function validOptionalBoundedStringArray(value) {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= PERF_CAPTURE_CONTRACT.limits.maxTargetsPerScenario &&
      everyOwnArrayEntry(value, boundedMetadataString))
  );
}

function validOptionalResultCounts(value, sampleCount) {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length === sampleCount &&
      everyOwnArrayEntry(value, (count) =>
        isBoundedNonnegativeSafeInteger(count, Number.MAX_SAFE_INTEGER),
      ))
  );
}

function validOptionalWarmups(value) {
  return (
    value === undefined ||
    isBoundedNonnegativeSafeInteger(value, PERF_CAPTURE_CONTRACT.limits.maxSamplesPerScenario)
  );
}

function validOptionalSwitchPaths(value, sampleCount) {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length === sampleCount &&
      value.length <= PERF_CAPTURE_CONTRACT.limits.maxTargetsPerScenario &&
      everyOwnArrayEntry(value, boundedMetadataString))
  );
}

function validOptionalLanguageServerStatus(value) {
  if (value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    return LANGUAGE_SERVER_STATUS_KINDS.has(value);
  }
  return (
    exactObjectKeys(value, ["kind", "running"]) &&
    LANGUAGE_SERVER_STATUS_KINDS.has(value.kind) &&
    typeof value.running === "boolean"
  );
}

function everyOwnArrayEntry(value, predicate) {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index) || !predicate(value[index])) {
      return false;
    }
  }

  return true;
}

function assertScenarioStatuses(value, label) {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${label} "scenarioStatuses" must be an array when present.`);
  }

  if (value.length > PERF_CAPTURE_CONTRACT.limits.maxScenarios) {
    throw new Error(`${label} "scenarioStatuses" exceeds the scenario count bound.`);
  }

  const ids = new Set();

  const isValid = everyOwnArrayEntry(value, (entry) => {
    if (!(
      entry &&
      typeof entry === "object" &&
      exactObjectKeys(entry, ["id", "reason", "status"]) &&
      boundedMetadataString(entry.id) &&
      !ids.has(entry.id) &&
      typeof entry.status === "string" &&
      isKnownScenarioStatus(entry.status) &&
      boundedMetadataString(entry.reason)
    )) {
      return false;
    }
    ids.add(entry.id);
    return true;
  });

  if (isValid) {
    return;
  }

  throw new Error(
    `${label} "scenarioStatuses" entries must each be {id: string, status: <known scenario status>, reason: string}.`,
  );
}

function assertFailedPaths(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} is missing a "failedPaths" array.`);
  }

  const isValid =
    value.length <= PERF_CAPTURE_CONTRACT.limits.maxScenarios &&
    everyOwnArrayEntry(value, boundedMetadataString);

  if (isValid) {
    return;
  }

  throw new Error(`${label} "failedPaths" must contain only dense bounded strings.`);
}

function assertRetainedCounts(value, label) {
  if (value === undefined || value === null) {
    return;
  }
  if (!validRetainedCounts(value)) {
    throw new Error(
      `${label} "retainedCounts" must be exactly {editors, models} with nonnegative safe ` +
        `integers at or below ${MAX_RETAINED_EDITOR_OBJECTS}.`,
    );
  }
}

function validRetainedCounts(value) {
  return (
    exactObjectKeys(value, ["editors", "models"]) &&
    isBoundedNonnegativeSafeInteger(value.editors, MAX_RETAINED_EDITOR_OBJECTS) &&
    isBoundedNonnegativeSafeInteger(value.models, MAX_RETAINED_EDITOR_OBJECTS)
  );
}

function assertMemorySample(value, label) {
  if (value === undefined || value === null) {
    return;
  }
  if (
    !exactObjectKeys(value, ["usedJsHeapBytes"]) ||
    (value.usedJsHeapBytes !== null &&
      !isBoundedNonnegativeSafeInteger(value.usedJsHeapBytes, MAX_REPORTED_HEAP_BYTES))
  ) {
    throw new Error(
      `${label} "memorySample" must be exactly {usedJsHeapBytes}, with null for unavailable ` +
        `or a nonnegative safe integer at or below ${MAX_REPORTED_HEAP_BYTES}.`,
    );
  }
}

function exactObjectKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

export function smokeValidationFailure(result) {
  const hasBridgeSamples = validatedSmokeBridgeEvidence(result?.bridgeResults) !== null;
  const hasEditor =
    validRetainedCounts(result?.retainedCounts) && result.retainedCounts.editors >= 1;

  if (hasBridgeSamples && hasEditor) {
    return null;
  }

  return "Performance smoke failed: typing-large-5k and tab-switch-cycle need samples, and retainedCounts.editors must be at least 1.";
}

export function failedPathsMessage(failedPaths) {
  if (failedPaths.length === 0) {
    return null;
  }

  const lines = [
    `Performance run failed: ${failedPaths.length} fixture path(s) could not be opened:`,
  ];

  for (const failedPath of failedPaths) {
    lines.push(`  ${failedPath}`);
  }

  return lines.join("\n");
}

export function scenarioSummary(scenario, trackerSnapshot) {
  if (isBlockingStatus(scenario.status)) {
    return `${scenario.status}: ${scenario.reason ?? "no reason recorded"}`;
  }

  if (scenario.id === MEMORY_SAMPLE_ID) {
    return memorySampleSummary(scenario);
  }

  if (scenario.samples) {
    return scenario.samples.length;
  }

  const tracker = trackerSnapshot.find(({ kind }) => kind === scenario.trackerKind);
  return tracker?.stats.count ?? 0;
}

export function memorySampleSummary(scenario) {
  const models = scenario.retainedCounts?.models ?? "-";
  const editors = scenario.retainedCounts?.editors ?? "-";
  const heap = scenario.memorySample?.usedJsHeapBytes ?? "unavailable";

  return `models ${models}, editors ${editors}, heap ${heap}`;
}

export function isBlockingStatus(status) {
  return typeof status === "string" && status !== OK_SCENARIO_STATUS;
}

export function blockedScenarioIds(shaped, trackerSnapshot, smoke) {
  return blockedScenarioIdsWithEvidence(shaped, trackerSnapshot, smoke, null);
}

function blockedScenarioIdsWithEvidence(shaped, trackerSnapshot, smoke, result) {
  const diagnosticSmokeEvidence = authenticatedDiagnosticSmokeEvidence(shaped, result, smoke);

  return shaped.scenarios
    .filter((scenario) =>
      isBlockedScenario(scenario, trackerSnapshot, smoke, diagnosticSmokeEvidence),
    )
    .map((scenario) => scenario.id);
}

function isBlockedScenario(scenario, trackerSnapshot, smoke, diagnosticSmokeEvidence) {
  if (scenario.id === MEMORY_SAMPLE_ID) {
    return false;
  }

  if (smoke && !SMOKE_SCENARIO_IDS.includes(scenario.id)) {
    return false;
  }

  if (isDeclaredCapabilityGap(scenario)) {
    return false;
  }

  if (
    scenario.status === NON_COMPARABLE_STATUS &&
    scenario.diagnosticEvidence === DIAGNOSTIC_SMOKE_EVIDENCE &&
    diagnosticSmokeEvidence?.has(scenario.id)
  ) {
    return false;
  }

  if (isBlockingStatus(scenario.status)) {
    return true;
  }

  return scenarioSummary(scenario, trackerSnapshot) === 0;
}

export function hasBlockingScenario(shaped, trackerSnapshot, smoke) {
  return blockedScenarioIds(shaped, trackerSnapshot, smoke).length > 0;
}

function validatedSmokeBridgeEvidence(bridgeResults) {
  if (!Array.isArray(bridgeResults)) {
    return null;
  }

  const evidence = new Map();
  for (let index = 0; index < bridgeResults.length; index += 1) {
    if (!Object.hasOwn(bridgeResults, index)) {
      return null;
    }
    const entry = bridgeResults[index];
    if (!entry || typeof entry !== "object" || !SMOKE_SCENARIO_IDS.includes(entry.id)) {
      continue;
    }
    if (evidence.has(entry.id) || !validSmokeSamples(entry.id, entry.samples)) {
      return null;
    }
    evidence.set(entry.id, entry.samples);
  }

  return SMOKE_SCENARIO_IDS.every((id) => evidence.has(id)) ? evidence : null;
}

function authenticatedDiagnosticSmokeEvidence(shaped, result, smoke) {
  if (
    smoke !== true ||
    result?.environment?.windowMode !== DIAGNOSTIC_WINDOW_MODE ||
    shaped?.environment?.windowMode !== DIAGNOSTIC_WINDOW_MODE
  ) {
    return null;
  }

  const evidence = validatedSmokeBridgeEvidence(result.bridgeResults);
  if (evidence === null || !Array.isArray(result.scenarioStatuses)) {
    return null;
  }

  for (const id of SMOKE_SCENARIO_IDS) {
    const rawStatuses = result.scenarioStatuses.filter((entry) => entry?.id === id);
    const shapedScenarios = shaped.scenarios.filter((scenario) => scenario?.id === id);
    const rawSamples = evidence.get(id);
    if (
      rawStatuses.length !== 1 ||
      rawStatuses[0].status !== NON_COMPARABLE_STATUS ||
      shapedScenarios.length !== 1 ||
      !shapedDiagnosticEvidenceMatches(shapedScenarios[0], rawSamples)
    ) {
      return null;
    }
  }

  return evidence;
}

function shapedDiagnosticEvidenceMatches(scenario, rawSamples) {
  if (
    scenario.status !== NON_COMPARABLE_STATUS ||
    scenario.diagnosticEvidence !== DIAGNOSTIC_SMOKE_EVIDENCE ||
    !Array.isArray(scenario.samples) ||
    scenario.samples.length !== rawSamples.length
  ) {
    return false;
  }

  for (let index = 0; index < scenario.samples.length; index += 1) {
    const sample = scenario.samples[index];
    if (
      !Object.hasOwn(scenario.samples, index) ||
      sample === null ||
      typeof sample !== "object" ||
      Object.keys(sample).length !== 1 ||
      !Object.hasOwn(sample, "ms") ||
      sample.ms !== rawSamples[index]
    ) {
      return false;
    }
  }

  return true;
}

function validSmokeSamples(id, samples) {
  if (!SMOKE_SCENARIO_IDS.includes(id) || !Array.isArray(samples)) {
    return false;
  }
  if (samples.length < 1 || samples.length > PERF_CAPTURE_CONTRACT.limits.maxSamplesPerScenario) {
    return false;
  }
  return everyOwnArrayEntry(samples, isFiniteNonnegativeNumber);
}

export function environmentAnomaly(shaped) {
  const environment = shaped?.environment;

  if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
    return (
      "Performance run anomaly: the written result records no environment block, so nothing " +
      "identifies the editor, bundle mode, or timer resolution that produced these numbers. " +
      "The gap report rejects any pair whose environment metadata is missing."
    );
  }

  const missing = REQUIRED_ENVIRONMENT_FIELDS.filter(
    (field) => !hasEnvironmentField(environment, field),
  );

  if (missing.length === 0) {
    return null;
  }

  return (
    `Performance run anomaly: the written result's environment block is incomplete (missing ${missing.join(", ")}). ` +
    "The gap report rejects any pair whose environment metadata is missing."
  );
}

function hasEnvironmentField(environment, field) {
  if (field === "timerQuantizationMs") {
    return isFiniteNonnegativeNumber(environment[field]);
  }

  return typeof environment[field] === "string" && environment[field] !== "";
}

export function evaluateRunOutcome({ result, shaped, smoke }) {
  const failures = [];
  const smokeFailure = smoke ? smokeValidationFailure(result) : null;

  if (smokeFailure) {
    failures.push(smokeFailure);
  }

  const pathsFailure = failedPathsMessage(shaped.failedPaths);

  if (pathsFailure) {
    failures.push(pathsFailure);
  }

  const blocked = blockedScenarioIdsWithEvidence(shaped, result.trackerSnapshot, smoke, result);

  if (blocked.length > 0) {
    failures.push(
      "Performance run failed: " +
        `${blocked.length} scenario(s) produced no usable measurement (${blocked.join(", ")}). ` +
        "invalid, not-run, skipped, no-result, and non-comparable are normally failures in the " +
        "run lane. The only non-comparable exception is bounded diagnostic smoke evidence; the " +
        "gap-report lane remains strict. policy-disabled is exempt only on the declared large-file " +
        "capability scenarios.",
    );
  }

  const environmentFailure = smoke ? null : environmentAnomaly(shaped);

  if (environmentFailure) {
    failures.push(environmentFailure);
  }

  return failures;
}

export function environmentWarning(shaped, smoke) {
  if (!smoke) {
    return null;
  }

  const anomaly = environmentAnomaly(shaped);

  if (anomaly === null) {
    return null;
  }

  return `${anomaly} Smoke runs are exempt from this gate; a full run is not.`;
}

export function resultFileName(capturedAt) {
  return `codevo-${capturedAt.replace(/[:.]/g, "-")}.json`;
}
