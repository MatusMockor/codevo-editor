import path from "node:path";
import {
  FIXTURE_VERSION,
  PERF_SCENARIOS,
  inPagePerfRunnerSource,
  isKnownScenarioStatus,
} from "./perfScenarios.mjs";

const DEFAULT_WAIT_MS = 10000;
const DEFAULT_INTERVAL_MS = 100;
const MANUAL_RESULT_LABEL = "--from-json file";
const REQUIRED_TRACKER_STATS = ["count", "last", "min", "max", "median", "p95"];
const REQUIRED_ENVIRONMENT_FIELDS = ["editor", "bundleMode", "timerQuantizationMs", "capturedAt"];
const MEMORY_SAMPLE_ID = "memory-sample";
const OK_SCENARIO_STATUS = "ok";
const POLICY_DISABLED_STATUS = "policy-disabled";
const CAPABILITY_SCENARIO_KIND = "capability";

export const SMOKE_SCENARIO_IDS = ["typing-large-5k", "tab-switch-cycle"];
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
  return normalizeRunnerResult(parseJson(raw), MANUAL_RESULT_LABEL);
}

export function normalizeRunnerResult(parsed, label = MANUAL_RESULT_LABEL) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must contain a JSON object.`);
  }

  assertBridgeResults(parsed.bridgeResults, label);
  assertTrackerSnapshot(parsed.trackerSnapshot, label);
  assertScenarioStatuses(parsed.scenarioStatuses, label);
  assertEnvironment(parsed.environment, label);
  assertFailedPaths(parsed.failedPaths, label);

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

  const quantization = value.timerQuantizationMs;

  if (quantization === undefined || isFiniteNonnegativeNumber(quantization)) {
    return;
  }

  throw new Error(
    `${label} "environment.timerQuantizationMs" must be a finite nonnegative number when present.`,
  );
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

  const isValid = everyOwnArrayEntry(
    value,
    (entry) =>
      entry &&
      typeof entry === "object" &&
      typeof entry.id === "string" &&
      Array.isArray(entry.samples) &&
      everyOwnArrayEntry(entry.samples, isFiniteNonnegativeNumber),
  );

  if (isValid) {
    return;
  }

  throw new Error(
    `${label} "bridgeResults" entries must each have a string id and finite nonnegative numeric samples.`,
  );
}

function assertTrackerSnapshot(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} is missing a "trackerSnapshot" array.`);
  }

  const isValid = everyOwnArrayEntry(
    value,
    (entry) =>
      entry &&
      typeof entry === "object" &&
      typeof entry.kind === "string" &&
      entry.stats &&
      typeof entry.stats === "object" &&
      !Array.isArray(entry.stats) &&
      REQUIRED_TRACKER_STATS.every((stat) => isFiniteNonnegativeNumber(entry.stats[stat])),
  );

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

  const isValid = everyOwnArrayEntry(
    value,
    (entry) =>
      entry &&
      typeof entry === "object" &&
      typeof entry.id === "string" &&
      typeof entry.status === "string" &&
      isKnownScenarioStatus(entry.status) &&
      typeof entry.reason === "string",
  );

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

  const isValid = everyOwnArrayEntry(value, (entry) => typeof entry === "string");

  if (isValid) {
    return;
  }

  throw new Error(`${label} "failedPaths" entries must each be a string.`);
}

export function smokeValidationFailure(result) {
  const [typingId, tabSwitchId] = SMOKE_SCENARIO_IDS;
  const typing = result.bridgeResults.find(({ id }) => id === typingId);
  const tabSwitch = result.bridgeResults.find(({ id }) => id === tabSwitchId);
  const hasBridgeSamples = typing?.samples.length >= 1 && tabSwitch?.samples.length >= 1;
  const hasEditor = result.retainedCounts?.editors >= 1;

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
  return shaped.scenarios
    .filter((scenario) => isBlockedScenario(scenario, trackerSnapshot, smoke))
    .map((scenario) => scenario.id);
}

function isBlockedScenario(scenario, trackerSnapshot, smoke) {
  if (scenario.id === MEMORY_SAMPLE_ID) {
    return false;
  }

  if (smoke && !SMOKE_SCENARIO_IDS.includes(scenario.id)) {
    return false;
  }

  if (isDeclaredCapabilityGap(scenario)) {
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

  const blocked = blockedScenarioIds(shaped, result.trackerSnapshot, smoke);

  if (blocked.length > 0) {
    failures.push(
      "Performance run failed: " +
        `${blocked.length} scenario(s) produced no usable measurement (${blocked.join(", ")}). ` +
        "invalid, not-run, skipped, no-result, and non-comparable are failures in the run lane, " +
        "exactly as in the gap-report lane. policy-disabled is exempt only on the declared " +
        "large-file capability scenarios.",
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
