import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const CONTRACT_URL = new URL("../../perf/capture-contract.json", import.meta.url);
const HEX_40_OR_64 = /^(?:[a-f\d]{40}|[a-f\d]{64})$/i;
const SHA256 = /^[a-f\d]{64}$/i;
const SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*|0|[1-9]\d*)(?:\.(?:[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*|0|[1-9]\d*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const CONTRACT_KEYS = ["limits", "requiredEnvironment", "scenarios", "schemaVersion", "version"];
const REQUIRED_ENVIRONMENT_KEYS = ["bundleMode", "captureFlavor", "launchState", "workspaceState"];
const LIMIT_KEYS = [
  "maxCaptureJsonBytes",
  "maxMetadataStringBytes",
  "maxSamplesPerScenario",
  "maxScenarios",
  "maxTargetsPerScenario",
  "maxTimerQuantizationMs",
];
const SCENARIO_KEYS = [
  "cacheState",
  "comparisonKind",
  "cutPointByEditor",
  "id",
  "maxSamples",
  "minSamples",
  "requiredTargets",
  "requiredWarmups",
  "workScope",
];
const CUT_POINT_EDITOR_KEYS = ["codevo", "vscode"];
const COMPARISON_KINDS = new Set([
  "capability",
  "codevo-absolute",
  "cross-editor",
  "informational-asymmetric",
]);
const CAPTURE_SCENARIO_STATUSES = new Set([
  "invalid",
  "non-comparable",
  "not-run",
  "no-result",
  "ok",
  "policy-disabled",
  "skipped",
]);
const RUN_CONTRACT_KEYS = ["sha256", "version"];
const RUN_KEYS = new Set([
  "captureContract",
  "capturedAt",
  "environment",
  "failedPaths",
  "fixtureHashes",
  "fixtureVersion",
  "scenarios",
]);
const ENVIRONMENT_KEYS = new Set([
  "appActivationTransitions",
  "arch",
  "artifactIdentity",
  "artifactSha256",
  "bundleManifestSha256",
  "bundleMode",
  "captureFlavor",
  "capturedAt",
  "commit",
  "diagnosticSpaceLease",
  "domWindowSignalCount",
  "editor",
  "executableIdentity",
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
const SCENARIO_RUN_KEYS = new Set([
  "cacheState",
  "comparisonKind",
  "cutPoint",
  "diagnosticEvidence",
  "error",
  "id",
  "languageServerStatus",
  "memorySample",
  "method",
  "p50",
  "p95",
  "pairs",
  "reason",
  "resultCount",
  "retainedCounts",
  "samples",
  "status",
  "targets",
  "unit",
  "warmups",
  "windowNote",
  "workScope",
]);
const SAMPLE_KEYS = new Set(["ms", "resultCount"]);
const PAIR_KEYS = ["count", "fromBasename", "p50", "p95", "toBasename"];
const DIAGNOSTIC_EVIDENCE = "diagnostic-smoke-raw-bridge-samples-v1";
const DIAGNOSTIC_SCENARIO_IDS = new Set(["tab-switch-cycle", "typing-large-5k"]);
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_RETAINED_EDITOR_OBJECTS = 1_000_000;
const MAX_REPORTED_HEAP_BYTES = 2 ** 50;
const MAX_DURATION_MS = 3_600_000;
const MEMORY_SCENARIO_KEYS = new Set([
  "cacheState",
  "comparisonKind",
  "cutPoint",
  "error",
  "id",
  "memorySample",
  "retainedCounts",
  "reason",
  "status",
  "unit",
  "workScope",
]);
const MAX_CAPTURE_JSON_DEPTH = 32;
const MAX_CAPTURE_JSON_NODES = 200_000;

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function nonEmptyBoundedString(value, maxBytes) {
  return (
    typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= maxBytes
  );
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function finiteNonnegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function nonnegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function hasOnlyKeys(value, allowed) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function denseArrayEvery(value, predicate) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index) || !predicate(value[index], index)) return false;
  }
  return true;
}

function parseCanonicalContract(raw) {
  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid perf capture contract JSON: ${messageOf(error)}`);
  }

  if (!exactKeys(parsed, CONTRACT_KEYS)) {
    throw new Error("Perf capture contract has missing or unknown top-level fields.");
  }

  if (parsed.schemaVersion !== 1 || typeof parsed.version !== "string" || parsed.version === "") {
    throw new Error("Perf capture contract schemaVersion/version is invalid.");
  }

  if (!exactKeys(parsed.requiredEnvironment, REQUIRED_ENVIRONMENT_KEYS)) {
    throw new Error("Perf capture contract requiredEnvironment is not a closed object.");
  }

  if (
    parsed.requiredEnvironment.bundleMode !== "production" ||
    parsed.requiredEnvironment.captureFlavor !== "production-instrumented" ||
    parsed.requiredEnvironment.launchState !== "cold-fresh-profile" ||
    parsed.requiredEnvironment.workspaceState !== "fixture-clean"
  ) {
    throw new Error("Perf capture contract requiredEnvironment contains an unsupported value.");
  }

  if (
    !exactKeys(parsed.limits, LIMIT_KEYS) ||
    !Object.values(parsed.limits).every(positiveInteger)
  ) {
    throw new Error("Perf capture contract limits are not positive integers in a closed object.");
  }

  if (!Array.isArray(parsed.scenarios) || parsed.scenarios.length === 0) {
    throw new Error("Perf capture contract scenarios must be a non-empty array.");
  }

  if (parsed.scenarios.length > parsed.limits.maxScenarios) {
    throw new Error("Perf capture contract declares more scenarios than its own bound.");
  }

  const ids = new Set();

  for (const scenario of parsed.scenarios) {
    if (!exactKeys(scenario, SCENARIO_KEYS)) {
      throw new Error("Perf capture contract scenario has missing or unknown fields.");
    }

    for (const field of ["id", "cacheState", "workScope"]) {
      if (!nonEmptyBoundedString(scenario[field], parsed.limits.maxMetadataStringBytes)) {
        throw new Error(`Perf capture contract scenario ${field} is invalid or unbounded.`);
      }
    }

    if (!COMPARISON_KINDS.has(scenario.comparisonKind)) {
      throw new Error(
        `Perf capture contract scenario "${scenario.id}" has invalid comparisonKind.`,
      );
    }
    if (!exactKeys(scenario.cutPointByEditor, CUT_POINT_EDITOR_KEYS)) {
      throw new Error(
        `Perf capture contract scenario "${scenario.id}" has invalid cutPointByEditor.`,
      );
    }
    for (const editor of CUT_POINT_EDITOR_KEYS) {
      const cutPoint = scenario.cutPointByEditor[editor];
      if (
        cutPoint !== null &&
        !nonEmptyBoundedString(cutPoint, parsed.limits.maxMetadataStringBytes)
      ) {
        throw new Error(
          `Perf capture contract scenario "${scenario.id}" has invalid ${editor} cut point.`,
        );
      }
    }

    if (ids.has(scenario.id)) {
      throw new Error(`Perf capture contract declares duplicate scenario id "${scenario.id}".`);
    }
    ids.add(scenario.id);

    if (
      !Number.isInteger(scenario.minSamples) ||
      scenario.minSamples < 0 ||
      !Number.isInteger(scenario.maxSamples) ||
      scenario.maxSamples < scenario.minSamples ||
      scenario.maxSamples > parsed.limits.maxSamplesPerScenario ||
      scenario.minSamples !== scenario.maxSamples
    ) {
      throw new Error(
        `Perf capture contract scenario "${scenario.id}" must declare one exact valid sample count.`,
      );
    }
    if (
      !nonnegativeSafeInteger(scenario.requiredWarmups) ||
      scenario.requiredWarmups > parsed.limits.maxSamplesPerScenario ||
      !nonnegativeSafeInteger(scenario.requiredTargets) ||
      scenario.requiredTargets > parsed.limits.maxTargetsPerScenario
    ) {
      throw new Error(
        `Perf capture contract scenario "${scenario.id}" has invalid exact warmup/target counts.`,
      );
    }
  }

  return deepFreeze(parsed);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

export const PERF_CAPTURE_CONTRACT = parseCanonicalContract(readFileSync(CONTRACT_URL, "utf8"));
export const MAX_CAPTURE_JSON_BYTES = PERF_CAPTURE_CONTRACT.limits.maxCaptureJsonBytes;
export const PERF_CAPTURE_CONTRACT_SHA256 = createHash("sha256")
  .update(canonicalJson(PERF_CAPTURE_CONTRACT))
  .digest("hex");
export const PERF_CAPTURE_CONTRACT_METADATA = Object.freeze({
  version: PERF_CAPTURE_CONTRACT.version,
  sha256: PERF_CAPTURE_CONTRACT_SHA256,
});

const SCENARIO_BY_ID = new Map(
  PERF_CAPTURE_CONTRACT.scenarios.map((scenario) => [scenario.id, scenario]),
);

export function captureScenarioContract(id) {
  return SCENARIO_BY_ID.get(id) ?? null;
}

export function parseCaptureRunJson(raw, options) {
  assertBoundedCaptureJson(raw);

  const parsed = parseCaptureJson(raw);
  const reasons = validateCaptureRun(parsed, options);
  if (reasons.length > 0) {
    throw new Error(`Perf capture violates the canonical contract: ${reasons.join(" ")}`);
  }
  return parsed;
}

export function assertBoundedCaptureJson(raw) {
  if (typeof raw !== "string") {
    throw new Error("Perf capture JSON must be a string.");
  }
  const bytes = Buffer.byteLength(raw, "utf8");
  if (bytes > MAX_CAPTURE_JSON_BYTES) {
    throw new Error(
      `Perf capture JSON is ${bytes} bytes, above the ${MAX_CAPTURE_JSON_BYTES} byte bound.`,
    );
  }

  rejectDuplicateJsonKeysAndExcessiveShape(raw);
}

function parseCaptureJson(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid perf capture JSON: ${messageOf(error)}`);
  }

  return parsed;
}

function rejectDuplicateJsonKeysAndExcessiveShape(raw) {
  let cursor = 0;
  let nodes = 0;
  const fail = (message) => {
    throw new Error(`Invalid perf capture JSON structure at byte ${cursor}: ${message}`);
  };
  const whitespace = () => {
    while (/\s/.test(raw[cursor] ?? "")) cursor += 1;
  };
  const stringToken = () => {
    if (raw[cursor] !== '"') fail("expected a string");
    const start = cursor;
    cursor += 1;
    while (cursor < raw.length) {
      if (raw[cursor] === "\\") {
        cursor += 2;
        continue;
      }
      if (raw[cursor] === '"') {
        cursor += 1;
        try {
          return JSON.parse(raw.slice(start, cursor));
        } catch (error) {
          fail(messageOf(error));
        }
      }
      cursor += 1;
    }
    fail("unterminated string");
  };
  const value = (depth) => {
    if (depth > MAX_CAPTURE_JSON_DEPTH) fail("nesting depth exceeds 32");
    nodes += 1;
    if (nodes > MAX_CAPTURE_JSON_NODES) fail("node count exceeds 200000");
    whitespace();
    if (raw[cursor] === "{") return object(depth + 1);
    if (raw[cursor] === "[") return array(depth + 1);
    if (raw[cursor] === '"') {
      stringToken();
      return;
    }
    const start = cursor;
    while (cursor < raw.length && !/[\s,\]}]/.test(raw[cursor])) cursor += 1;
    if (cursor === start) fail("expected a value");
  };
  const object = (depth) => {
    cursor += 1;
    whitespace();
    const keys = new Set();
    if (raw[cursor] === "}") {
      cursor += 1;
      return;
    }
    while (cursor < raw.length) {
      const key = stringToken();
      if (keys.has(key)) fail(`duplicate object key ${JSON.stringify(key)}`);
      keys.add(key);
      whitespace();
      if (raw[cursor] !== ":") fail("expected ':' after object key");
      cursor += 1;
      value(depth);
      whitespace();
      if (raw[cursor] === "}") {
        cursor += 1;
        return;
      }
      if (raw[cursor] !== ",") fail("expected ',' or '}' in object");
      cursor += 1;
      whitespace();
    }
    fail("unterminated object");
  };
  const array = (depth) => {
    cursor += 1;
    whitespace();
    if (raw[cursor] === "]") {
      cursor += 1;
      return;
    }
    while (cursor < raw.length) {
      value(depth);
      whitespace();
      if (raw[cursor] === "]") {
        cursor += 1;
        return;
      }
      if (raw[cursor] !== ",") fail("expected ',' or ']' in array");
      cursor += 1;
    }
    fail("unterminated array");
  };

  value(0);
  whitespace();
  if (cursor !== raw.length) fail("trailing content");
}

export function validateCaptureRun(
  run,
  {
    expectedEditor,
    expectedBundleManifestSha256,
    enforceCanonicalScenarios = true,
    enforceCanonicalMetadata = true,
  },
) {
  const reasons = [];
  const maxBytes = PERF_CAPTURE_CONTRACT.limits.maxMetadataStringBytes;

  if (!run || typeof run !== "object" || Array.isArray(run)) {
    return ["The capture is not an object."];
  }
  if (!hasOnlyKeys(run, RUN_KEYS)) {
    reasons.push("The capture has unknown top-level fields.");
  }
  validateOptionalRunMetadata(run, maxBytes, reasons);

  const metadata = run.captureContract;
  if (!exactKeys(metadata, RUN_CONTRACT_KEYS)) {
    reasons.push("captureContract must be a closed {version, sha256} object.");
  } else {
    if (metadata.version !== PERF_CAPTURE_CONTRACT_METADATA.version) {
      reasons.push(
        `captureContract.version mismatch: expected "${PERF_CAPTURE_CONTRACT_METADATA.version}", got ${JSON.stringify(metadata.version)}.`,
      );
    }
    if (metadata.sha256 !== PERF_CAPTURE_CONTRACT_METADATA.sha256) {
      reasons.push("captureContract.sha256 does not match the canonical capture contract.");
    }
  }

  const environment = run.environment;
  if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
    reasons.push("The capture records no environment object.");
  } else {
    validateEnvironment(environment, expectedEditor, maxBytes, reasons);
    if (
      expectedBundleManifestSha256 !== undefined &&
      environment.bundleManifestSha256 !== expectedBundleManifestSha256
    ) {
      reasons.push("environment.bundleManifestSha256 does not match the trusted bundle identity.");
    }
  }

  const scenarios = run.scenarios;
  if (!Array.isArray(scenarios)) {
    reasons.push("The capture scenarios field is not an array.");
    return reasons;
  }
  if (scenarios.length > PERF_CAPTURE_CONTRACT.limits.maxScenarios) {
    reasons.push(
      `The capture records ${scenarios.length} scenarios, above the ${PERF_CAPTURE_CONTRACT.limits.maxScenarios} scenario bound.`,
    );
  }

  const seen = new Set();
  for (const scenario of scenarios) {
    if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) {
      reasons.push("The capture contains a non-object scenario.");
      continue;
    }
    if (!hasOnlyKeys(scenario, SCENARIO_RUN_KEYS)) {
      reasons.push("The capture contains a scenario with unknown fields.");
    }
    const id = scenario.id;
    if (!nonEmptyBoundedString(id, maxBytes)) {
      reasons.push("The capture contains a scenario with an invalid or unbounded id.");
      continue;
    }
    if (seen.has(id)) {
      reasons.push(`The capture contains duplicate scenario id "${id}".`);
      continue;
    }
    seen.add(id);

    const contract = captureScenarioContract(id);
    if (contract === null) {
      if (enforceCanonicalScenarios) {
        reasons.push(`The capture contains unknown scenario id "${id}".`);
      }
      validateGenericScenarioBounds(scenario, id, reasons, environment);
      continue;
    }

    if (contract.cutPointByEditor[expectedEditor] === null) {
      reasons.push(`Scenario "${id}" is not permitted in a canonical ${expectedEditor} capture.`);
      continue;
    }

    if (enforceCanonicalMetadata) {
      validateCanonicalScenario(scenario, contract, expectedEditor, environment, reasons);
    } else {
      validateGenericScenarioBounds(scenario, id, reasons, environment);
    }
  }

  if (enforceCanonicalScenarios) {
    const expectedIds = PERF_CAPTURE_CONTRACT.scenarios
      .filter((scenario) => scenario.cutPointByEditor[expectedEditor] !== null)
      .map((scenario) => scenario.id);
    const missingIds = expectedIds.filter((id) => !seen.has(id));
    if (missingIds.length > 0) {
      reasons.push(
        `The capture is missing ${missingIds.length} canonical ${expectedEditor} scenario id(s): ${missingIds.join(", ")}.`,
      );
    }
  }

  return reasons;
}

function validateEnvironment(environment, expectedEditor, maxBytes, reasons) {
  if (!hasOnlyKeys(environment, ENVIRONMENT_KEYS)) {
    reasons.push("The capture environment has unknown fields.");
  }
  if (environment.editor !== expectedEditor) {
    reasons.push(
      `environment.editor must be "${expectedEditor}", got ${JSON.stringify(environment.editor)}.`,
    );
  }

  for (const [field, expected] of Object.entries(PERF_CAPTURE_CONTRACT.requiredEnvironment)) {
    if (environment[field] !== expected) {
      reasons.push(
        `environment.${field} must be "${expected}", got ${JSON.stringify(environment[field])}.`,
      );
    }
  }

  if (!SEMVER.test(environment.version ?? "")) {
    reasons.push("environment.version is not a canonical semantic version.");
  }
  if (!HEX_40_OR_64.test(environment.sourceRevision ?? "")) {
    reasons.push("environment.sourceRevision must be a 40- or 64-digit hexadecimal revision.");
  }
  if (!SHA256.test(environment.artifactSha256 ?? "")) {
    reasons.push("environment.artifactSha256 must be a SHA-256 digest.");
  }
  if (expectedEditor === "codevo" && !SHA256.test(environment.bundleManifestSha256 ?? "")) {
    reasons.push("environment.bundleManifestSha256 must be a SHA-256 digest.");
  }

  for (const field of ["hostPlatform", "hostArch", "osRelease", "capturedAt"]) {
    if (!nonEmptyBoundedString(environment[field], maxBytes)) {
      reasons.push(`environment.${field} is missing, invalid, or exceeds the metadata bound.`);
    }
  }

  if (!ISO_INSTANT.test(environment.capturedAt ?? "")) {
    reasons.push("environment.capturedAt must be a UTC ISO-8601 instant.");
  }
  if (
    !finiteNonnegative(environment.timerQuantizationMs) ||
    environment.timerQuantizationMs <= 0 ||
    environment.timerQuantizationMs > PERF_CAPTURE_CONTRACT.limits.maxTimerQuantizationMs
  ) {
    reasons.push(
      `environment.timerQuantizationMs must be finite, strictly positive, and at most ${PERF_CAPTURE_CONTRACT.limits.maxTimerQuantizationMs} ms.`,
    );
  }
  if (environment.strictMode !== undefined && typeof environment.strictMode !== "boolean") {
    reasons.push("environment.strictMode must be boolean when present.");
  }
  if (environment.windowSize !== undefined && !validWindowSize(environment.windowSize)) {
    reasons.push(
      "environment.windowSize must be a closed finite nonnegative {width, height} object.",
    );
  }
  for (const field of ["platform", "windowMode", "commit", "arch"]) {
    if (environment[field] !== undefined && !nonEmptyBoundedString(environment[field], maxBytes)) {
      reasons.push(`environment.${field} is invalid or exceeds the metadata bound.`);
    }
  }
  for (const field of ["artifactIdentity", "executableIdentity"]) {
    if (
      environment[field] !== undefined &&
      (typeof environment[field] !== "string" ||
        Buffer.byteLength(environment[field], "utf8") > maxBytes)
    ) {
      reasons.push(`environment.${field} is invalid or exceeds the metadata bound.`);
    }
  }
  validateDiagnosticEnvironment(environment, maxBytes, reasons);
}

function validateOptionalRunMetadata(run, maxBytes, reasons) {
  if (run.capturedAt !== undefined && !ISO_INSTANT.test(run.capturedAt)) {
    reasons.push("capturedAt must be a UTC ISO-8601 instant when present.");
  }
  if (run.fixtureVersion !== undefined && !nonEmptyBoundedString(run.fixtureVersion, maxBytes)) {
    reasons.push("fixtureVersion is invalid or exceeds the metadata bound.");
  }
  if (
    run.failedPaths !== undefined &&
    !validBoundedStringArray(run.failedPaths, maxBytes, PERF_CAPTURE_CONTRACT.limits.maxScenarios)
  ) {
    reasons.push("failedPaths must be a dense bounded string array.");
  }
  if (run.fixtureHashes !== undefined && !validFixtureHashes(run.fixtureHashes, maxBytes)) {
    reasons.push(
      "fixtureHashes must be a bounded closed map of relative paths to SHA-256 digests.",
    );
  }
}

function validFixtureHashes(value, maxBytes) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.length <= 1_024 &&
    entries.every(
      ([key, digest]) =>
        nonEmptyBoundedString(key, maxBytes) && validFixtureHashKey(key) && SHA256.test(digest),
    )
  );
}

function validFixtureHashKey(key) {
  if (key.includes("\\") || /[\0-\x1f\x7f]/.test(key)) return false;
  const segments = key.split("/");
  if (segments.at(-1) === "") segments.pop();
  return (
    segments.length > 0 &&
    segments.every(
      (segment) =>
        segment !== "" &&
        segment !== "." &&
        segment !== ".." &&
        segment !== "__proto__" &&
        segment !== "constructor" &&
        segment !== "prototype",
    )
  );
}

function validWindowSize(value) {
  return (
    exactKeys(value, ["height", "width"]) &&
    finiteNonnegative(value.width) &&
    finiteNonnegative(value.height)
  );
}

function validateDiagnosticEnvironment(environment, maxBytes, reasons) {
  const keys = [
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
  const present = keys.filter((key) => Object.hasOwn(environment, key));
  if (present.length === 0) return;
  if (present.length !== keys.length) {
    reasons.push(
      "environment diagnostic window metadata must be present as one complete closed set.",
    );
    return;
  }
  const transitionKeys = [
    "appActivationTransitions",
    "keyTransitions",
    "minimizeTransitions",
    "occlusionTransitions",
    "windowStabilityEpoch",
  ];
  if (
    !transitionKeys.every(
      (key) => nonnegativeSafeInteger(environment[key]) && environment[key] <= 1_024,
    )
  ) {
    reasons.push("environment diagnostic transition counters are invalid or unbounded.");
  }
  for (const key of [
    "domWindowSignalCount",
    "windowInterruptionCount",
    "windowRecoveryInterventionCount",
  ]) {
    if (!nonnegativeSafeInteger(environment[key]) || environment[key] > 64) {
      reasons.push(`environment.${key} is invalid or unbounded.`);
    }
  }
  if (
    environment.diagnosticSpaceLease !== true ||
    environment.transitionOverflow !== false ||
    typeof environment.onActiveSpaceAtRelease !== "boolean"
  ) {
    reasons.push("environment diagnostic window booleans are invalid.");
  }
  if (!nonEmptyBoundedString(environment.windowStability, maxBytes)) {
    reasons.push("environment.windowStability is invalid or unbounded.");
  }
  const stagesValid = validBoundedStringArray(environment.windowInterruptionStages, maxBytes, 64);
  if (!stagesValid) {
    reasons.push("environment.windowInterruptionStages must be a dense bounded string array.");
  }
  if (
    !stagesValid ||
    environment.windowMode !== "always-on-top-diagnostic" ||
    environment.windowInterruptionCount > 3 ||
    environment.windowRecoveryInterventionCount > 3 ||
    environment.windowInterruptionStages.length !== environment.windowInterruptionCount ||
    environment.windowStabilityEpoch !==
      environment.appActivationTransitions +
        environment.keyTransitions +
        environment.minimizeTransitions +
        environment.occlusionTransitions ||
    environment.windowStability !==
      (environment.windowInterruptionCount === 0
        ? "diagnostic-space-lease"
        : "recovered-diagnostic")
  ) {
    reasons.push("environment diagnostic window metadata is internally inconsistent.");
  }
}

function validBoundedStringArray(value, maxBytes, maxItems) {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    denseArrayEvery(value, (entry) => nonEmptyBoundedString(entry, maxBytes))
  );
}

function validateGenericScenarioBounds(scenario, id, reasons, environment) {
  validateScenarioShape(scenario, id, reasons, environment);
  const samples = scenario.samples;
  const targets = scenario.targets;
  if (
    Array.isArray(samples) &&
    samples.length > PERF_CAPTURE_CONTRACT.limits.maxSamplesPerScenario
  ) {
    reasons.push(`Scenario "${id}" exceeds the global sample bound.`);
  }
  if (
    Array.isArray(targets) &&
    targets.length > PERF_CAPTURE_CONTRACT.limits.maxTargetsPerScenario
  ) {
    reasons.push(`Scenario "${id}" exceeds the global target bound.`);
  }
}

function validateCanonicalScenario(scenario, contract, expectedEditor, environment, reasons) {
  const id = contract.id;
  const expectedCutPoint = contract.cutPointByEditor[expectedEditor];
  if (expectedCutPoint !== null && scenario.cutPoint !== expectedCutPoint) {
    reasons.push(
      `Scenario "${id}" cutPoint must be "${expectedCutPoint}" for ${expectedEditor}, got ${JSON.stringify(scenario.cutPoint)}.`,
    );
  }
  if (scenario.comparisonKind !== contract.comparisonKind) {
    reasons.push(
      `Scenario "${id}" comparisonKind must be "${contract.comparisonKind}", got ${JSON.stringify(scenario.comparisonKind)}.`,
    );
  }
  if (scenario.cacheState !== contract.cacheState) {
    reasons.push(
      `Scenario "${id}" cacheState must be "${contract.cacheState}", got ${JSON.stringify(scenario.cacheState)}.`,
    );
  }
  if (scenario.workScope !== contract.workScope) {
    reasons.push(
      `Scenario "${id}" workScope must be "${contract.workScope}", got ${JSON.stringify(scenario.workScope)}.`,
    );
  }

  if (!CAPTURE_SCENARIO_STATUSES.has(scenario.status)) {
    reasons.push(`Scenario "${id}" must record one explicit closed status.`);
  }

  validateScenarioShape(scenario, id, reasons, environment);

  const exactProtocolObservation =
    scenario.status === "ok" ||
    (contract.comparisonKind === "capability" &&
      (scenario.status === "policy-disabled" || scenario.status === "no-result"));
  const samples = Array.isArray(scenario.samples) ? scenario.samples.length : 0;
  if (samples > contract.maxSamples) {
    reasons.push(
      `Scenario "${id}" records ${samples} samples above its ${contract.maxSamples} sample bound.`,
    );
  } else if (exactProtocolObservation && samples !== contract.minSamples) {
    reasons.push(
      `Scenario "${id}" must record exactly ${contract.minSamples} samples for its completed protocol observation, got ${samples}.`,
    );
  }
  if (exactProtocolObservation) {
    if (
      id !== "memory-sample" &&
      (!nonnegativeSafeInteger(scenario.warmups) ||
        !Array.isArray(scenario.samples) ||
        !Array.isArray(scenario.targets))
    ) {
      reasons.push(
        `Scenario "${id}" completed protocol observation must explicitly record warmups, samples, and targets.`,
      );
    }
    const warmups = scenario.warmups === undefined ? 0 : scenario.warmups;
    const targets = Array.isArray(scenario.targets) ? scenario.targets.length : 0;
    if (warmups !== contract.requiredWarmups) {
      reasons.push(
        `Scenario "${id}" must record exactly ${contract.requiredWarmups} warmups for its completed protocol observation, got ${JSON.stringify(scenario.warmups)}.`,
      );
    }
    if (targets !== contract.requiredTargets) {
      reasons.push(
        `Scenario "${id}" must record exactly ${contract.requiredTargets} targets for its completed protocol observation, got ${targets}.`,
      );
    }
  }
  if (
    Array.isArray(scenario.samples) &&
    scenario.samples.length > PERF_CAPTURE_CONTRACT.limits.maxSamplesPerScenario
  ) {
    reasons.push(`Scenario "${id}" exceeds the global sample bound.`);
  }
  if (
    Array.isArray(scenario.targets) &&
    scenario.targets.length > PERF_CAPTURE_CONTRACT.limits.maxTargetsPerScenario
  ) {
    reasons.push(`Scenario "${id}" exceeds the global target bound.`);
  }
}

function validateScenarioShape(scenario, id, reasons, environment = null) {
  const maxBytes = PERF_CAPTURE_CONTRACT.limits.maxMetadataStringBytes;
  for (const field of ["unit", "reason", "error", "method", "windowNote", "languageServerStatus"]) {
    if (scenario[field] !== undefined && !nonEmptyBoundedString(scenario[field], maxBytes)) {
      reasons.push(`Scenario "${id}" ${field} is invalid or unbounded.`);
    }
  }
  if (
    scenario.warmups !== undefined &&
    (!nonnegativeSafeInteger(scenario.warmups) ||
      scenario.warmups > PERF_CAPTURE_CONTRACT.limits.maxSamplesPerScenario)
  ) {
    reasons.push(`Scenario "${id}" warmups must be a bounded nonnegative safe integer.`);
  }
  if (scenario.resultCount !== undefined && !nonnegativeSafeInteger(scenario.resultCount)) {
    reasons.push(`Scenario "${id}" resultCount must be a nonnegative safe integer.`);
  }
  if (
    scenario.targets !== undefined &&
    !validBoundedStringArray(
      scenario.targets,
      maxBytes,
      PERF_CAPTURE_CONTRACT.limits.maxTargetsPerScenario,
    )
  ) {
    reasons.push(`Scenario "${id}" targets must be a dense bounded string array.`);
  }
  if (scenario.samples !== undefined && !validSamples(scenario.samples)) {
    reasons.push(`Scenario "${id}" samples must be dense closed finite nonnegative records.`);
  }
  if (scenario.pairs !== undefined && !validPairs(scenario.pairs, maxBytes)) {
    reasons.push(`Scenario "${id}" pairs must contain only dense closed bounded records.`);
  }
  if (scenario.retainedCounts !== undefined && !validRetainedCounts(scenario.retainedCounts)) {
    reasons.push(`Scenario "${id}" retainedCounts must be a closed nonnegative integer object.`);
  }
  if (scenario.memorySample !== undefined && !validMemorySample(scenario.memorySample)) {
    reasons.push(`Scenario "${id}" memorySample must be null or a closed bounded object.`);
  }

  const samples = Array.isArray(scenario.samples) ? scenario.samples : null;
  if (samples !== null && validSamples(samples) && samples.length > 0) {
    const expected = percentiles(samples.map((sample) => sample.ms));
    if (scenario.p50 !== expected.p50 || scenario.p95 !== expected.p95) {
      reasons.push(`Scenario "${id}" p50/p95 must exactly match its persisted samples.`);
    }
  }
  if (
    (scenario.p50 !== undefined &&
      (!finiteNonnegative(scenario.p50) || scenario.p50 > MAX_DURATION_MS)) ||
    (scenario.p95 !== undefined &&
      (!finiteNonnegative(scenario.p95) || scenario.p95 > MAX_DURATION_MS))
  ) {
    reasons.push(`Scenario "${id}" p50/p95 must be finite and nonnegative when present.`);
  }

  if (scenario.diagnosticEvidence !== undefined) {
    if (
      scenario.status !== "non-comparable" ||
      !DIAGNOSTIC_SCENARIO_IDS.has(id) ||
      scenario.diagnosticEvidence !== DIAGNOSTIC_EVIDENCE ||
      !diagnosticEnvironmentIsAuthoritative(environment) ||
      samples === null ||
      samples.length === 0
    ) {
      reasons.push(`Scenario "${id}" has invalid diagnostic non-comparable evidence.`);
    }
  }
  if (
    scenario.status === "non-comparable" &&
    samples !== null &&
    samples.length > 0 &&
    scenario.diagnosticEvidence !== DIAGNOSTIC_EVIDENCE
  ) {
    reasons.push(`Scenario "${id}" non-comparable samples require exact diagnostic evidence.`);
  }
  if (
    CAPTURE_SCENARIO_STATUSES.has(scenario.status) &&
    scenario.status !== "ok" &&
    scenario.status !== "non-comparable" &&
    samples !== null &&
    samples.length > 0
  ) {
    reasons.push(`Scenario "${id}" failure status must not carry measurement samples.`);
  }
  if (scenario.status === "ok" && (scenario.reason !== undefined || scenario.error !== undefined)) {
    reasons.push(`Scenario "${id}" status ok must not carry failure text.`);
  }
  if (
    id !== "memory-sample" &&
    (scenario.retainedCounts !== undefined || scenario.memorySample !== undefined)
  ) {
    reasons.push(`Scenario "${id}" carries memory fields outside memory-sample.`);
  }
  if (id !== "tab-switch-cycle" && scenario.pairs !== undefined) {
    reasons.push(`Scenario "${id}" carries tab-switch pairs outside tab-switch-cycle.`);
  }
  const hasSamples = samples !== null && samples.length > 0;
  const hasPercentiles = scenario.p50 !== undefined || scenario.p95 !== undefined;
  if (hasSamples !== (scenario.p50 !== undefined && scenario.p95 !== undefined)) {
    reasons.push(`Scenario "${id}" must record p50 and p95 exactly when it records samples.`);
  }
  if (scenario.status !== "ok" && scenario.status !== "non-comparable" && hasPercentiles) {
    reasons.push(`Scenario "${id}" failure status must not carry measurement percentiles.`);
  }
  if (scenario.status === "non-comparable" && !hasSamples && hasPercentiles) {
    reasons.push(`Scenario "${id}" non-comparable percentiles require diagnostic samples.`);
  }
  if (id === "memory-sample" && !hasOnlyKeys(scenario, MEMORY_SCENARIO_KEYS)) {
    reasons.push('Scenario "memory-sample" contains fields outside its closed memory schema.');
  }
}

function validSamples(value) {
  return (
    Array.isArray(value) &&
    denseArrayEvery(
      value,
      (sample) =>
        sample !== null &&
        typeof sample === "object" &&
        !Array.isArray(sample) &&
        Object.keys(sample).length >= 1 &&
        hasOnlyKeys(sample, SAMPLE_KEYS) &&
        finiteNonnegative(sample.ms) &&
        sample.ms <= MAX_DURATION_MS &&
        (sample.resultCount === undefined || nonnegativeSafeInteger(sample.resultCount)),
    )
  );
}

function validPairs(value, maxBytes) {
  return (
    Array.isArray(value) &&
    value.length <= PERF_CAPTURE_CONTRACT.limits.maxTargetsPerScenario &&
    denseArrayEvery(
      value,
      (pair) =>
        exactKeys(pair, PAIR_KEYS) &&
        (pair.fromBasename === null || nonEmptyBoundedString(pair.fromBasename, maxBytes)) &&
        (pair.toBasename === null || nonEmptyBoundedString(pair.toBasename, maxBytes)) &&
        nonnegativeSafeInteger(pair.count) &&
        pair.count > 0 &&
        pair.count <= PERF_CAPTURE_CONTRACT.limits.maxSamplesPerScenario &&
        finiteNonnegative(pair.p50) &&
        pair.p50 <= MAX_DURATION_MS &&
        finiteNonnegative(pair.p95) &&
        pair.p95 <= MAX_DURATION_MS,
    )
  );
}

function validRetainedCounts(value) {
  return (
    value === null ||
    (exactKeys(value, ["editors", "models"]) &&
      nonnegativeSafeInteger(value.editors) &&
      value.editors <= MAX_RETAINED_EDITOR_OBJECTS &&
      nonnegativeSafeInteger(value.models) &&
      value.models <= MAX_RETAINED_EDITOR_OBJECTS)
  );
}

function validMemorySample(value) {
  return (
    value === null ||
    (exactKeys(value, ["usedJsHeapBytes"]) &&
      (value.usedJsHeapBytes === null ||
        (nonnegativeSafeInteger(value.usedJsHeapBytes) &&
          value.usedJsHeapBytes <= MAX_REPORTED_HEAP_BYTES)))
  );
}

function diagnosticEnvironmentIsAuthoritative(environment) {
  if (!environment || environment.windowMode !== "always-on-top-diagnostic") return false;
  const required = [
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
  return required.every((key) => Object.hasOwn(environment, key));
}

function percentiles(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return {
    p50: sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}
