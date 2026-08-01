import path from "node:path";
import { FIXTURE_VERSION, inPagePerfRunnerSource } from "./perfScenarios.mjs";

const DEFAULT_WAIT_MS = 10000;
const DEFAULT_INTERVAL_MS = 100;

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
  const parsed = parseJson(raw);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--from-json file must contain a JSON object.");
  }

  assertBridgeResults(parsed.bridgeResults);
  assertTrackerSnapshot(parsed.trackerSnapshot);
  assertFailedPaths(parsed.failedPaths);

  return {
    bridgeResults: parsed.bridgeResults,
    trackerSnapshot: parsed.trackerSnapshot,
    retainedCounts: parsed.retainedCounts ?? null,
    memorySample: parsed.memorySample ?? null,
    failedPaths: parsed.failedPaths,
  };
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`--from-json file is not valid JSON: ${detail}`);
  }
}

function assertBridgeResults(value) {
  if (!Array.isArray(value)) {
    throw new Error('--from-json file is missing a "bridgeResults" array.');
  }

  const isValid = value.every(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      typeof entry.id === "string" &&
      Array.isArray(entry.samples),
  );

  if (isValid) {
    return;
  }

  throw new Error(
    '--from-json "bridgeResults" entries must each be {id: string, samples: number[]}.',
  );
}

function assertTrackerSnapshot(value) {
  if (!Array.isArray(value)) {
    throw new Error('--from-json file is missing a "trackerSnapshot" array.');
  }

  const isValid = value.every(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      typeof entry.kind === "string" &&
      entry.stats &&
      typeof entry.stats === "object",
  );

  if (isValid) {
    return;
  }

  throw new Error(
    '--from-json "trackerSnapshot" entries must each be {kind: string, stats: object}.',
  );
}

function assertFailedPaths(value) {
  if (!Array.isArray(value)) {
    throw new Error('--from-json file is missing a "failedPaths" array.');
  }

  const isValid = value.every((entry) => typeof entry === "string");

  if (isValid) {
    return;
  }

  throw new Error('--from-json "failedPaths" entries must each be a string.');
}

export function smokeValidationFailure(result) {
  const typing = result.bridgeResults.find(({ id }) => id === "typing-large-5k");
  const tabSwitch = result.bridgeResults.find(({ id }) => id === "tab-switch-cycle");
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
  if (scenario.status === "skipped") {
    return `skipped: ${scenario.reason}`;
  }

  if (scenario.status === "not-run") {
    return `not-run: ${scenario.reason}`;
  }

  if (scenario.id === "memory-sample") {
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

export function hasEmptyNonSkippedScenario(shaped, trackerSnapshot, smoke) {
  return shaped.scenarios.some((scenario) => {
    if (scenario.status === "skipped") {
      return false;
    }

    if (scenario.id === "memory-sample") {
      return false;
    }

    if (smoke && !["typing-large-5k", "tab-switch-cycle"].includes(scenario.id)) {
      return false;
    }

    if (scenario.status === "not-run") {
      return true;
    }

    return scenarioSummary(scenario, trackerSnapshot) === 0;
  });
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

  if (hasEmptyNonSkippedScenario(shaped, result.trackerSnapshot, smoke)) {
    failures.push("Performance run failed: one or more non-skipped scenarios have zero samples.");
  }

  return failures;
}

export function resultFileName(capturedAt) {
  return `codevo-${capturedAt.replace(/[:.]/g, "-")}.json`;
}
