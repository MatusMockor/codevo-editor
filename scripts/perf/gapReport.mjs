import { PERF_SCENARIOS } from "./perfScenarios.mjs";

export const DEFAULT_TOLERANCES = [
  { pattern: /^(references|rename)/, budget: 1.5 },
  { pattern: /^(typing|tab-switch|quickopen|completion|definition|file-search)/, budget: 1.25 },
];

const MEMORY_SAMPLE_ID = "memory-sample";
const RUN_COMPARABILITY_ID = "run-comparability";
const OK_STATUS = "ok";
const INVALID_STATUS = "invalid";
const NON_COMPARABLE_STATUS = "non-comparable";
const NO_BASELINE_STATUS = "no-baseline";
const NO_BUDGET_STATUS = "no-budget";
const NO_RESULT_STATUS = "no-result";
const POLICY_DISABLED_STATUS = "policy-disabled";
const PASS_STATUS = "pass";
const FAIL_STATUS = "fail";
const CAPABILITY_SCENARIO_KIND = "capability";
const RESULT_COUNT_TOLERANCE = 0.1;
const QUANTIZATION_MEDIAN_MULTIPLE = 10;
const MAX_RENDERED_HASH_MISMATCHES = 5;
const COUNT_SENSITIVE_PREFIXES = ["completion", "references", "file-search-engine"];
const CODEVO_ONLY_CUT_POINTS = new Set(["quickopen-ui", "typing-frame"]);
const UI_ENVIRONMENT_SCENARIO_IDS = new Set([
  "tab-switch-cycle",
  "typing-large-5k-frame",
  "typing-large-20k-frame",
  "typing-large-100k-frame",
  "quickopen-ui",
]);
const COUNT_MISMATCH_REASON_PREFIX = "non-comparable-by-counts";

const REPORTED_STATUSES = new Set([
  OK_STATUS,
  INVALID_STATUS,
  "not-run",
  "skipped",
  POLICY_DISABLED_STATUS,
  NO_RESULT_STATUS,
  NON_COMPARABLE_STATUS,
]);
const REPORTED_FAILURE_STATUSES = new Set([
  INVALID_STATUS,
  "not-run",
  "skipped",
  POLICY_DISABLED_STATUS,
  NO_RESULT_STATUS,
]);
const COMPARABLE_STATUSES = new Set([PASS_STATUS, FAIL_STATUS, NO_BUDGET_STATUS]);
const FAILURE_STATUSES = new Set([
  FAIL_STATUS,
  INVALID_STATUS,
  NO_BASELINE_STATUS,
  NO_BUDGET_STATUS,
  NO_RESULT_STATUS,
  "not-run",
  "skipped",
  POLICY_DISABLED_STATUS,
]);

export const REGISTERED_SCENARIO_IDS = registeredScenarioIds();
export const CAPABILITY_GAP_SCENARIO_IDS = capabilityGapScenarioIds();

const CAPABILITY_GAP_SCENARIO_ID_SET = new Set(CAPABILITY_GAP_SCENARIO_IDS);

function registeredScenarioIds() {
  if (!Array.isArray(PERF_SCENARIOS)) {
    return [];
  }

  return PERF_SCENARIOS.map((scenario) => scenario?.id).filter(
    (id) => typeof id === "string" && id !== MEMORY_SAMPLE_ID,
  );
}

function capabilityGapScenarioIds() {
  if (!Array.isArray(PERF_SCENARIOS)) {
    return [];
  }

  return PERF_SCENARIOS.filter((scenario) => scenario?.kind === CAPABILITY_SCENARIO_KIND)
    .map((scenario) => scenario.id)
    .filter((id) => typeof id === "string");
}

export function buildGapReport({
  codevo,
  baseline,
  tolerances,
  requiredScenarioIds = REGISTERED_SCENARIO_IDS,
}) {
  const verification = verifyRunMetadata(codevo, baseline);
  const codevoQuantizationMs = timerQuantizationMsOf(codevo);
  const baselineQuantizationMs = timerQuantizationMsOf(baseline);
  const codevoById = scenariosById(codevo);
  const baselineById = scenariosById(baseline);
  const rows = joinedScenarioIds(codevoById, baselineById, requiredScenarioIds).map((id) =>
    buildRow({
      id,
      codevo: readSide(codevoById.get(id) ?? null, codevoQuantizationMs),
      vscode: readSide(baselineById.get(id) ?? null, baselineQuantizationMs),
      tolerances,
      verification,
      codevoEnvironment: codevo?.environment,
      baselineEnvironment: baseline?.environment,
    }),
  );
  const failures = rows.filter((row) => FAILURE_STATUSES.has(row.status));

  if (!verification.comparable) {
    failures.unshift({
      id: RUN_COMPARABILITY_ID,
      status: INVALID_STATUS,
      reason: verification.reasons.join(" "),
    });
  }

  return {
    rows,
    failures,
    failedPaths: Array.isArray(codevo?.failedPaths) ? codevo.failedPaths : [],
    verification,
  };
}

function scenariosById(run) {
  const scenarios = Array.isArray(run?.scenarios) ? run.scenarios : [];
  const byId = new Map();

  for (const scenario of scenarios) {
    if (!scenario || typeof scenario.id !== "string" || scenario.id === MEMORY_SAMPLE_ID) {
      continue;
    }

    byId.set(scenario.id, scenario);
  }

  return byId;
}

function joinedScenarioIds(codevoById, baselineById, requiredScenarioIds) {
  const ids = [...codevoById.keys()];

  for (const id of baselineById.keys()) {
    if (!codevoById.has(id)) {
      ids.push(id);
    }
  }

  for (const id of requiredScenarioIds) {
    if (!codevoById.has(id) && !baselineById.has(id)) {
      ids.push(id);
    }
  }

  return ids;
}

function verifyRunMetadata(codevo, baseline) {
  const reasons = [
    ...fixtureVersionReasons(codevo, baseline),
    ...fixtureHashReasons(codevo, baseline),
    ...environmentReasons(codevo, baseline),
  ];

  return { comparable: reasons.length === 0, reasons };
}

function fixtureVersionReasons(codevo, baseline) {
  const codevoVersion = nonEmptyString(codevo?.fixtureVersion);
  const baselineVersion = nonEmptyString(baseline?.fixtureVersion);

  if (codevoVersion === null && baselineVersion === null) {
    return ["Neither side records a fixtureVersion."];
  }

  if (codevoVersion === null) {
    return ["The Codevo run records no fixtureVersion."];
  }

  if (baselineVersion === null) {
    return ["The VS Code baseline records no fixtureVersion."];
  }

  if (codevoVersion !== baselineVersion) {
    return [`fixtureVersion mismatch: Codevo "${codevoVersion}" vs VS Code "${baselineVersion}".`];
  }

  return [];
}

function fixtureHashReasons(codevo, baseline) {
  const codevoHashes = hashMapOf(codevo?.fixtureHashes);
  const baselineHashes = hashMapOf(baseline?.fixtureHashes);

  if (codevoHashes === null && baselineHashes === null) {
    return ["Neither side records fixtureHashes."];
  }

  if (codevoHashes === null) {
    return ["The Codevo run records no fixtureHashes."];
  }

  if (baselineHashes === null) {
    return ["The VS Code baseline records no fixtureHashes."];
  }

  const onlyCodevo = [...codevoHashes.keys()].filter((key) => !baselineHashes.has(key)).sort();
  const onlyBaseline = [...baselineHashes.keys()].filter((key) => !codevoHashes.has(key)).sort();
  const shared = [...codevoHashes.keys()].filter((key) => baselineHashes.has(key)).sort();
  const mismatched = shared.filter((key) => codevoHashes.get(key) !== baselineHashes.get(key));
  const reasons = [];

  if (shared.length === 0) {
    reasons.push("The Codevo run and the VS Code baseline share no fixture path in fixtureHashes.");
  }

  if (onlyCodevo.length > 0) {
    reasons.push(`fixtureHash keys missing from the VS Code baseline: ${listPaths(onlyCodevo)}.`);
  }

  if (onlyBaseline.length > 0) {
    reasons.push(`fixtureHash keys missing from the Codevo run: ${listPaths(onlyBaseline)}.`);
  }

  if (mismatched.length > 0) {
    reasons.push(
      `fixtureHash mismatch on ${mismatched.length} of ${shared.length} shared fixture path(s): ${listPaths(mismatched)}.`,
    );
  }

  return reasons;
}

function listPaths(paths) {
  const listed = paths.slice(0, MAX_RENDERED_HASH_MISMATCHES).join(", ");

  return paths.length > MAX_RENDERED_HASH_MISMATCHES ? `${listed}, ...` : listed;
}

function environmentReasons(codevo, baseline) {
  const reasons = [];

  if (timerQuantizationMsOf(codevo) === null) {
    reasons.push("The Codevo run records no environment.timerQuantizationMs.");
  }

  if (timerQuantizationMsOf(baseline) === null) {
    reasons.push("The VS Code baseline records no environment.timerQuantizationMs.");
  }

  reasons.push(
    ...expectedEditorReasons(codevo, baseline),
    ...captureIdentityReasons(codevo, baseline),
    ...bundleModeReasons(codevo, baseline),
    ...matchingEnvironmentStringReasons(codevo, baseline, "hostPlatform"),
    ...matchingEnvironmentStringReasons(codevo, baseline, "hostArch"),
  );

  return reasons;
}

function captureIdentityReasons(codevo, baseline) {
  const reasons = [];

  for (const [label, run] of [
    ["Codevo", codevo],
    ["VS Code", baseline],
  ]) {
    const version = run?.environment?.version;
    const capturedAt = run?.environment?.capturedAt;

    if (!isValidEditorVersion(version)) {
      reasons.push(`The ${label} run records no valid environment.version.`);
    }

    if (!isCanonicalCaptureTimestamp(capturedAt)) {
      reasons.push(`The ${label} run records no valid environment.capturedAt.`);
    }
  }

  return reasons;
}

function isValidEditorVersion(value) {
  return (
    typeof value === "string" &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
  );
}

function isCanonicalCaptureTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function bundleModeReasons(codevo, baseline) {
  const allowed = new Set(["dev", "production"]);
  const codevoMode = environmentStringOf(codevo, "bundleMode");
  const baselineMode = environmentStringOf(baseline, "bundleMode");
  const reasons = [];

  if (!allowed.has(codevoMode)) {
    reasons.push(`Codevo environment.bundleMode is invalid: ${JSON.stringify(codevoMode)}.`);
  }

  if (!allowed.has(baselineMode)) {
    reasons.push(`VS Code environment.bundleMode is invalid: ${JSON.stringify(baselineMode)}.`);
  }

  if (reasons.length > 0) {
    return reasons;
  }

  return codevoMode === baselineMode
    ? []
    : [`environment.bundleMode mismatch: Codevo "${codevoMode}" vs VS Code "${baselineMode}".`];
}

function expectedEditorReasons(codevo, baseline) {
  const codevoEditor = environmentStringOf(codevo, "editor");
  const baselineEditor = environmentStringOf(baseline, "editor");
  const reasons = [];

  if (codevoEditor !== "codevo") {
    reasons.push(
      `Codevo-side environment.editor must be "codevo", got ${JSON.stringify(codevoEditor)}.`,
    );
  }

  if (baselineEditor !== "vscode") {
    reasons.push(
      `VS Code-side environment.editor must be "vscode", got ${JSON.stringify(baselineEditor)}.`,
    );
  }

  return reasons;
}

function matchingEnvironmentStringReasons(codevo, baseline, field) {
  const codevoValue = environmentStringOf(codevo, field);
  const baselineValue = environmentStringOf(baseline, field);

  if (codevoValue === null && baselineValue === null) {
    return [`Neither side records environment.${field}.`];
  }

  if (codevoValue === null) {
    return [`The Codevo run records no environment.${field}.`];
  }

  if (baselineValue === null) {
    return [`The VS Code baseline records no environment.${field}.`];
  }

  return codevoValue === baselineValue
    ? []
    : [`environment.${field} mismatch: Codevo "${codevoValue}" vs VS Code "${baselineValue}".`];
}

function environmentStringOf(run, field) {
  const value = run?.environment?.[field];

  return nonEmptyString(value);
}

function timerQuantizationMsOf(run) {
  const environment = run?.environment;

  if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
    return null;
  }

  const value = environment.timerQuantizationMs;

  if (!Number.isFinite(value) || value < 0) {
    return null;
  }

  return value;
}

function hashMapOf(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const entries = Object.entries(value);

  if (
    entries.length === 0 ||
    entries.some(
      ([key, hash]) =>
        !validFixtureHashKey(key) || typeof hash !== "string" || !/^[a-f\d]{64}$/i.test(hash),
    )
  ) {
    return null;
  }

  return new Map(entries);
}

function validFixtureHashKey(key) {
  if (key === "monorepo/") {
    return true;
  }

  return (
    key.startsWith("large-files/") &&
    key.length > "large-files/".length &&
    !key.includes("..") &&
    !key.includes("\\")
  );
}

function buildRow({
  id,
  codevo,
  vscode,
  tolerances,
  verification,
  codevoEnvironment,
  baselineEnvironment,
}) {
  const quantizationLimited = quantizationLimitedSides(codevo, vscode);
  const ratio = ratioFor(codevo.p95, vscode.p95);
  const capabilityGap = isDeclaredCapabilityGap(id, codevo);
  const resolution = resolveRow({
    id,
    codevo,
    vscode,
    ratio,
    budget: budgetForId(id, tolerances),
    verification,
    quantizationLimited,
    capabilityGap,
    codevoEnvironment,
    baselineEnvironment,
  });

  return {
    id,
    capabilityGap,
    codevoP95: codevo.p95,
    vscodeP95: vscode.p95,
    codevoMedian: codevo.median,
    vscodeMedian: vscode.median,
    ratio,
    floorAdjustedRatio: floorAdjustedRatioFor(codevo, vscode),
    resultCountRatio: resultCountRatioFor(codevo, vscode),
    codevoCutPoint: codevo.cutPoint,
    baselineCutPoint: vscode.cutPoint,
    codevoWindowNote: codevo.windowNote,
    baselineWindowNote: vscode.windowNote,
    quantizationLimited,
    comparable: COMPARABLE_STATUSES.has(resolution.status),
    nonComparableReasons: resolution.nonComparableReasons,
    budget: resolution.budget,
    status: resolution.status,
    languageServerStatus: codevo.languageServerStatus,
    reason: resolution.reason,
  };
}

function resolveRow({
  id,
  codevo,
  vscode,
  ratio,
  budget,
  verification,
  quantizationLimited,
  capabilityGap,
  codevoEnvironment,
  baselineEnvironment,
}) {
  const blocking = blockingStatus(codevo, vscode, capabilityGap);

  if (blocking !== null) {
    return { ...blocking, budget: null, nonComparableReasons: [] };
  }

  const nonComparableReasons = comparabilityReasons({
    id,
    codevo,
    vscode,
    verification,
    quantizationLimited,
    capabilityGap,
    codevoEnvironment,
    baselineEnvironment,
  });

  if (nonComparableReasons.length > 0) {
    return {
      status: NON_COMPARABLE_STATUS,
      reason: codevo.reason,
      budget: null,
      nonComparableReasons,
    };
  }

  if (budget === null) {
    return {
      status: NO_BUDGET_STATUS,
      reason: "The row is comparable but no tolerance declares a budget for this scenario.",
      budget: null,
      nonComparableReasons: [],
    };
  }

  return {
    status: ratio > budget ? FAIL_STATUS : PASS_STATUS,
    reason: codevo.reason,
    budget,
    nonComparableReasons: [],
  };
}

function blockingStatus(codevo, vscode, capabilityGap) {
  if (capabilityGap) {
    return null;
  }

  if (!codevo.present && !vscode.present) {
    return {
      status: NO_RESULT_STATUS,
      reason: "The required scenario is missing from both the Codevo run and VS Code baseline.",
    };
  }

  if (codevo.present && !codevo.statusKnown) {
    return {
      status: INVALID_STATUS,
      reason: `The Codevo run reports the unknown status "${String(codevo.reportedStatus)}".`,
    };
  }

  if (vscode.present && !vscode.statusKnown) {
    return {
      status: INVALID_STATUS,
      reason: `The VS Code baseline reports the unknown status "${String(vscode.reportedStatus)}".`,
    };
  }

  if (REPORTED_FAILURE_STATUSES.has(codevo.reportedStatus)) {
    return { status: codevo.reportedStatus, reason: codevo.reason };
  }

  if (REPORTED_FAILURE_STATUSES.has(vscode.reportedStatus)) {
    return {
      status: NO_BASELINE_STATUS,
      reason: `The VS Code baseline reports status "${vscode.reportedStatus}" for this scenario.`,
    };
  }

  if (!codevo.present) {
    return {
      status: NO_RESULT_STATUS,
      reason: "The Codevo run recorded no result for this scenario.",
    };
  }

  if (declaresNonComparable(codevo, vscode) || isCodevoOnly(codevo)) {
    return null;
  }

  if (!vscode.present) {
    return {
      status: NO_BASELINE_STATUS,
      reason: "The VS Code baseline has no entry for this scenario.",
    };
  }

  if (codevo.p95 === null || vscode.p95 === null) {
    return {
      status: INVALID_STATUS,
      reason: "No usable positive p95 could be derived from the recorded samples on both sides.",
    };
  }

  return null;
}

function declaresNonComparable(codevo, vscode) {
  return (
    codevo.reportedStatus === NON_COMPARABLE_STATUS ||
    vscode.reportedStatus === NON_COMPARABLE_STATUS
  );
}

function isCodevoOnly(codevo) {
  return codevo.cutPoint !== null && CODEVO_ONLY_CUT_POINTS.has(codevo.cutPoint);
}

function isDeclaredCapabilityGap(id, codevo) {
  return codevo.reportedStatus === POLICY_DISABLED_STATUS && CAPABILITY_GAP_SCENARIO_ID_SET.has(id);
}

function comparabilityReasons({
  id,
  codevo,
  vscode,
  verification,
  quantizationLimited,
  capabilityGap,
  codevoEnvironment,
  baselineEnvironment,
}) {
  const reasons = [];

  if (capabilityGap) {
    reasons.push(
      "declared large-file capability gap: Codevo's large-document policy disables the feature on this fixture by design",
    );
    return reasons;
  }

  if (!verification.comparable) {
    reasons.push("run metadata is not comparable (see the run comparability banner)");
  }

  if (codevo.reportedStatus === NON_COMPARABLE_STATUS) {
    reasons.push("the Codevo run declared this scenario non-comparable");
  }

  if (vscode.reportedStatus === NON_COMPARABLE_STATUS) {
    reasons.push("the VS Code baseline declared this scenario non-comparable");
  }

  if (UI_ENVIRONMENT_SCENARIO_IDS.has(id)) {
    reasons.push(...uiEnvironmentReasons(codevoEnvironment, baselineEnvironment));
  }

  if (!vscode.present) {
    reasons.push(
      isCodevoOnly(codevo)
        ? `Codevo-only absolute-budget row (cut point "${codevo.cutPoint}"); the VS Code extension host cannot measure it`
        : "the VS Code baseline has no counterpart for this scenario",
    );
    return reasons;
  }

  reasons.push(
    ...cutPointReasons(codevo, vscode),
    ...warmupReasons(codevo, vscode),
    ...sampleCountReasons(codevo, vscode),
    ...targetReasons(codevo, vscode),
    ...resultCountReasons(id, codevo, vscode),
  );

  if (quantizationLimited.length > 0) {
    reasons.push(`quantization-limited on the ${quantizationLimited.join(" and ")} side`);
  }

  return reasons;
}

function uiEnvironmentReasons(codevoEnvironment, baselineEnvironment) {
  const reasons = [];
  const codevoMode = nonEmptyString(codevoEnvironment?.windowMode);
  const baselineMode = nonEmptyString(baselineEnvironment?.windowMode);

  if (codevoMode !== "focus-only") {
    reasons.push(
      codevoMode === null
        ? "missing Codevo focus/elevation metadata"
        : `Codevo window mode "${codevoMode}" is diagnostic and not parity-comparable`,
    );
  }

  if (baselineMode !== "focus-only") {
    reasons.push(
      baselineMode === null
        ? "missing VS Code focus/elevation metadata"
        : `VS Code window mode "${baselineMode}" is not focus-only`,
    );
  }

  const codevoSize = validWindowSize(codevoEnvironment?.windowSize);
  const baselineSize = validWindowSize(baselineEnvironment?.windowSize);

  if (codevoSize === null) {
    reasons.push("missing Codevo window-size metadata");
  }

  if (baselineSize === null) {
    reasons.push("missing VS Code window-size metadata");
  }

  if (
    codevoSize !== null &&
    baselineSize !== null &&
    (codevoSize.width !== baselineSize.width || codevoSize.height !== baselineSize.height)
  ) {
    reasons.push(
      `window-size mismatch (Codevo ${codevoSize.width}x${codevoSize.height} vs VS Code ${baselineSize.width}x${baselineSize.height})`,
    );
  }

  return reasons;
}

function validWindowSize(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Number.isFinite(value.width) ||
    value.width <= 0 ||
    !Number.isFinite(value.height) ||
    value.height <= 0
  ) {
    return null;
  }

  return { width: value.width, height: value.height };
}

function cutPointReasons(codevo, vscode) {
  if (codevo.cutPoint === null && vscode.cutPoint === null) {
    return ["missing cut-point metadata on both sides"];
  }

  if (codevo.cutPoint === null) {
    return ["missing cut-point metadata on the Codevo side"];
  }

  if (vscode.cutPoint === null) {
    return ["missing cut-point metadata on the VS Code side"];
  }

  if (codevo.cutPoint !== vscode.cutPoint) {
    return [`cut-point mismatch (Codevo "${codevo.cutPoint}" vs VS Code "${vscode.cutPoint}")`];
  }

  return [];
}

function warmupReasons(codevo, vscode) {
  if (codevo.warmups === null || vscode.warmups === null) {
    return ["missing warmup metadata"];
  }

  if (codevo.warmups !== vscode.warmups) {
    return [`warmup mismatch (Codevo ${codevo.warmups} vs VS Code ${vscode.warmups})`];
  }

  return [];
}

function sampleCountReasons(codevo, vscode) {
  if (codevo.samples === null || vscode.samples === null) {
    return ["missing per-sample metadata"];
  }

  if (codevo.samples.length !== vscode.samples.length) {
    return [
      `sample-count mismatch (Codevo ${codevo.samples.length} vs VS Code ${vscode.samples.length})`,
    ];
  }

  return [];
}

function targetReasons(codevo, vscode) {
  if (codevo.targets === null || vscode.targets === null) {
    return ["missing target metadata"];
  }

  if (codevo.targets.length !== vscode.targets.length) {
    return [
      `target-set mismatch (Codevo ${codevo.targets.length} vs VS Code ${vscode.targets.length} targets)`,
    ];
  }

  const differing = codevo.targets.filter((target, index) => target !== vscode.targets[index]);

  if (differing.length === 0) {
    return [];
  }

  return [`target-set mismatch (${differing.length} of ${codevo.targets.length} differ in order)`];
}

function resultCountReasons(id, codevo, vscode) {
  if (!isCountSensitive(id) || codevo.samples === null || vscode.samples === null) {
    return [];
  }

  if (codevo.samples.length !== vscode.samples.length) {
    return [];
  }

  const missing = codevo.samples.some(
    (sample, index) => sample.resultCount === null || vscode.samples[index].resultCount === null,
  );

  if (missing) {
    return ["missing per-sample resultCount metadata on a count-sensitive scenario"];
  }

  const mismatched = codevo.samples.filter(
    (sample, index) => !countsMatch(sample.resultCount, vscode.samples[index].resultCount),
  );

  if (mismatched.length === 0) {
    return [];
  }

  const percent = RESULT_COUNT_TOLERANCE * 100;

  return [
    `${COUNT_MISMATCH_REASON_PREFIX} (${mismatched.length} of ${codevo.samples.length} targets differ by more than ${percent}%)`,
  ];
}

function isCountSensitive(id) {
  return COUNT_SENSITIVE_PREFIXES.some((prefix) => id.startsWith(prefix));
}

function countsMatch(left, right) {
  if (left === right) {
    return true;
  }

  const denominator = Math.max(left, right);

  if (denominator <= 0) {
    return false;
  }

  return Math.abs(left - right) / denominator <= RESULT_COUNT_TOLERANCE;
}

function quantizationLimitedSides(codevo, vscode) {
  const sides = [];

  if (isQuantizationLimited(codevo)) {
    sides.push("Codevo");
  }

  if (isQuantizationLimited(vscode)) {
    sides.push("VS Code");
  }

  return sides;
}

function isQuantizationLimited(side) {
  if (side.median === null || side.timerQuantizationMs === null) {
    return false;
  }

  return side.median < QUANTIZATION_MEDIAN_MULTIPLE * side.timerQuantizationMs;
}

function readSide(scenario, timerQuantizationMs) {
  if (!scenario || typeof scenario !== "object") {
    return emptySide();
  }

  const samples = readSamples(scenario);
  const percentiles = samples === null ? { p50: null, p95: null } : percentilesOf(samples);

  return {
    present: true,
    reportedStatus: scenario.status === undefined ? OK_STATUS : scenario.status,
    statusKnown: scenario.status === undefined || REPORTED_STATUSES.has(scenario.status),
    cutPoint: nonEmptyString(scenario.cutPoint),
    warmups: nonNegativeInteger(scenario.warmups),
    targets: readTargets(scenario),
    samples,
    median: nonNegativeOrNull(percentiles.p50),
    p95: positiveOrNull(percentiles.p95),
    windowNote: nonEmptyString(scenario.windowNote),
    frameSettleFloorMs: positiveOrNull(scenario.frameSettleFloorMs),
    languageServerStatus: languageServerStatusOf(scenario),
    timerQuantizationMs,
    reason: nonEmptyString(scenario.reason),
  };
}

function emptySide() {
  return {
    present: false,
    reportedStatus: null,
    statusKnown: true,
    cutPoint: null,
    warmups: null,
    targets: null,
    samples: null,
    median: null,
    p95: null,
    windowNote: null,
    frameSettleFloorMs: null,
    languageServerStatus: null,
    timerQuantizationMs: null,
    reason: null,
  };
}

function readSamples(scenario) {
  const raw = scenario.samples;

  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }

  const samples = [];

  for (let index = 0; index < raw.length; index += 1) {
    if (!Object.hasOwn(raw, index)) {
      return null;
    }

    const entry = raw[index];

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }

    if (!Number.isFinite(entry.ms) || entry.ms < 0) {
      return null;
    }

    samples.push({ ms: entry.ms, resultCount: nonNegativeInteger(entry.resultCount) });
  }

  return samples;
}

function readTargets(scenario) {
  const raw = scenario.targets;

  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }

  const targets = [];

  for (let index = 0; index < raw.length; index += 1) {
    if (!Object.hasOwn(raw, index) || typeof raw[index] !== "string") {
      return null;
    }

    targets.push(raw[index]);
  }

  return targets;
}

function percentilesOf(samples) {
  const sorted = samples.map((sample) => sample.ms).sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const p50 = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];

  return { p50, p95 };
}

function languageServerStatusOf(scenario) {
  const status = scenario.languageServerStatus;
  const asString = nonEmptyString(status);

  if (asString !== null) {
    return asString;
  }

  if (!status || typeof status.kind !== "string" || typeof status.running !== "boolean") {
    return null;
  }

  return status.running ? status.kind : `${status.kind} (not running)`;
}

function floorAdjustedRatioFor(codevo, vscode) {
  if (codevo.frameSettleFloorMs === null || codevo.p95 === null || vscode.p95 === null) {
    return null;
  }

  const adjusted = codevo.p95 - codevo.frameSettleFloorMs;

  if (adjusted <= 0) {
    return null;
  }

  return adjusted / vscode.p95;
}

function resultCountRatioFor(codevo, vscode) {
  if (codevo.samples === null || vscode.samples === null) {
    return null;
  }

  const codevoTotal = totalResultCount(codevo.samples);
  const vscodeTotal = totalResultCount(vscode.samples);

  if (codevoTotal === null || vscodeTotal === null || vscodeTotal <= 0) {
    return null;
  }

  return codevoTotal / vscodeTotal;
}

function totalResultCount(samples) {
  let total = 0;

  for (const sample of samples) {
    if (sample.resultCount === null) {
      return null;
    }

    total += sample.resultCount;
  }

  return total;
}

function nonEmptyString(value) {
  return typeof value === "string" && value !== "" ? value : null;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function positiveOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function nonNegativeOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function ratioFor(codevoP95, vscodeP95) {
  if (codevoP95 === null || vscodeP95 === null) {
    return null;
  }

  return codevoP95 / vscodeP95;
}

function budgetForId(id, tolerances) {
  const entries = Array.isArray(tolerances) ? tolerances : [];
  const tolerance = entries.find((entry) => entry?.pattern?.test(id));

  return tolerance ? tolerance.budget : null;
}

export const COMPARABLE_TABLE_HEADER =
  "| Scenario | Codevo p95 | VS Code p95 | Ratio | Budget | Status |";
export const NON_COMPARABLE_TABLE_HEADER =
  "| Scenario | Codevo p95 | VS Code p95 | Ratio (info only) | Floor-adj ratio (info only) | Reason |";
export const BLOCKED_TABLE_HEADER = "| Scenario | Codevo p95 | VS Code p95 | Status | Reason |";

export function renderGapReportMarkdown(report) {
  const comparable = report.rows.filter((row) => row.comparable);
  const nonComparable = report.rows.filter((row) => row.status === NON_COMPARABLE_STATUS);
  const blocked = report.rows.filter(
    (row) => !row.comparable && row.status !== NON_COMPARABLE_STATUS,
  );
  const lines = [
    renderVerificationBanner(report.verification),
    "",
    "### Comparable rows",
    "",
    ...renderTable(
      COMPARABLE_TABLE_HEADER,
      comparable,
      renderComparableRow,
      "No row in this pair passed join-time comparability verification.",
    ),
    "",
    "### Non-comparable rows (informational only - no VS Code parity claim)",
    "",
    ...renderTable(
      NON_COMPARABLE_TABLE_HEADER,
      nonComparable,
      renderNonComparableRow,
      "No non-comparable rows.",
    ),
    "",
    "### Blocked rows (fail closed)",
    "",
    ...renderTable(BLOCKED_TABLE_HEADER, blocked, renderBlockedRow, "No blocked rows."),
    "",
    renderBudgetLegend(),
    renderNonComparableLegend(),
  ];

  if (nonComparable.some((row) => row.floorAdjustedRatio !== null)) {
    lines.push(renderFloorAdjustedLegend());
  }

  appendNotes(lines, report.rows);

  if (report.failedPaths.length > 0) {
    lines.push("", renderFailedPaths(report.failedPaths));
  }

  return lines.join("\n");
}

function appendNotes(lines, rows) {
  const sections = [
    rows.filter(hasCutPointAsymmetry).map(renderCutPointAsymmetryNote),
    rows.filter(hasCountAsymmetry).map(renderResultCountNote),
    rows.filter((row) => row.quantizationLimited.length > 0).map(renderQuantizationNote),
    rows.filter((row) => row.capabilityGap).map(renderCapabilityNote),
    rows.filter((row) => row.languageServerStatus !== null).map(renderLanguageServerNote),
  ];

  for (const section of sections) {
    if (section.length > 0) {
      lines.push("", ...section);
    }
  }
}

function renderTable(header, rows, renderRow, emptyMessage) {
  if (rows.length === 0) {
    return [emptyMessage];
  }

  return [header, dividerFor(header), ...rows.map(renderRow)];
}

function dividerFor(header) {
  const columns = header.split("|").length - 2;

  return `|${" --- |".repeat(columns)}`;
}

function renderVerificationBanner(verification) {
  if (verification.comparable) {
    return "Run comparability: fixture, bundle, platform/architecture, and timer metadata match on both sides.";
  }

  return `Run comparability: FAILED - ${verification.reasons.join(" ")} Every row is reported as non-comparable and this pair supports no parity claim.`;
}

function renderComparableRow(row) {
  return `| ${row.id} | ${formatNumber(row.codevoP95)} | ${formatNumber(row.vscodeP95)} | ${formatNumber(row.ratio)} | ${formatNumber(row.budget)} | ${row.status} |`;
}

function renderNonComparableRow(row) {
  return `| ${row.id} | ${renderCodevoCell(row)} | ${formatNumber(row.vscodeP95)} | ${formatNumber(row.ratio)} | ${formatNumber(row.floorAdjustedRatio)} | ${row.nonComparableReasons.join("; ")} |`;
}

function renderBlockedRow(row) {
  return `| ${row.id} | ${renderCodevoCell(row)} | ${formatNumber(row.vscodeP95)} | ${row.status} | ${row.reason ?? "n/a"} |`;
}

function renderCodevoCell(row) {
  if (row.capabilityGap || row.status === POLICY_DISABLED_STATUS) {
    return "disabled";
  }

  return formatNumber(row.codevoP95);
}

function renderBudgetLegend() {
  return (
    "Budget is printed only for comparable rows and only where a tolerance declares one; every " +
    "other row prints no budget at all, because a ratio the harness refuses to judge cannot be " +
    "measured against a threshold."
  );
}

function renderNonComparableLegend() {
  return (
    "Non-comparable rows expose their arithmetic ratio for diagnostics only. They carry no budget, " +
    "no pass, and no VS Code parity claim; the Reason column names what failed join-time " +
    "verification (fixture identity, bundle/platform/architecture/window environment, cut point, warmups, sample " +
    "counts, targets, result counts, timer quantization, or missing metadata)."
  );
}

function renderFloorAdjustedLegend() {
  return (
    "Floor-adj ratio is informational only and never affects Status: it subtracts the scenario's " +
    "own declared frameSettleFloorMs from the Codevo p95 before dividing, because the VS Code " +
    "window excludes the frame production that the Codevo window includes."
  );
}

function hasCutPointAsymmetry(row) {
  if (row.codevoP95 === null || row.vscodeP95 === null) {
    return false;
  }

  return row.codevoCutPoint !== row.baselineCutPoint;
}

function hasCountAsymmetry(row) {
  if (row.resultCountRatio === null) {
    return false;
  }

  return row.nonComparableReasons.some((reason) => reason.startsWith(COUNT_MISMATCH_REASON_PREFIX));
}

function renderCutPointAsymmetryNote(row) {
  const codevo = describeCutPoint(row.codevoCutPoint, row.codevoWindowNote);
  const vscode = describeCutPoint(row.baselineCutPoint, row.baselineWindowNote);

  return `Cut-point asymmetry: ${row.id} - Codevo: ${codevo}; VS Code: ${vscode}. The Ratio column compares different measurement windows.`;
}

function describeCutPoint(cutPoint, windowNote) {
  if (cutPoint === null) {
    return "no cut point recorded";
  }

  if (windowNote === null) {
    return cutPoint;
  }

  return `${cutPoint} (${windowNote})`;
}

function renderResultCountNote(row) {
  return `Result-count ratio (informational): ${row.id} - Codevo returned ${formatNumber(row.resultCountRatio)}x the VS Code result count across the measured targets.`;
}

function renderQuantizationNote(row) {
  return `Quantization-limited (informational, never pass/fail): ${row.id} - the ${row.quantizationLimited.join(" and ")} median is below ten timer ticks, so the measurement resolves too few distinct values to compare.`;
}

function renderCapabilityNote(row) {
  const reason = row.reason ?? "the feature is disabled on this file";

  return `Capability gap: ${row.id} - VS Code measured ${formatNumber(row.vscodeP95)} ms on the same file; Codevo disables the feature (${reason}).`;
}

function renderLanguageServerNote(row) {
  return `JS/TS language server status at scenario start (informational): ${row.id} - ${row.languageServerStatus}.`;
}

function renderFailedPaths(failedPaths) {
  return `Failed paths: ${failedPaths.length} (${failedPaths.join(", ")})`;
}

function formatNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }

  return value.toFixed(2);
}
