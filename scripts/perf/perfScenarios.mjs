import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const FIXTURE_VERSION = "large-files@v3:medium-2k+seed2/5/20/100, monorepo@50pkg";

export const SCENARIO_STATUS = Object.freeze({
  OK: "ok",
  INVALID: "invalid",
  NOT_RUN: "not-run",
  SKIPPED: "skipped",
  POLICY_DISABLED: "policy-disabled",
  NO_RESULT: "no-result",
  NON_COMPARABLE: "non-comparable",
});

const CLOSED_SCENARIO_STATUSES = new Set(Object.values(SCENARIO_STATUS));

export function isKnownScenarioStatus(status) {
  return CLOSED_SCENARIO_STATUSES.has(status);
}

export const CUT_POINTS = Object.freeze({
  TYPING_DISPATCH: "typing-dispatch",
  TYPING_FRAME: "typing-frame",
  TAB_SWITCH_RENDERED: "tab-switch-rendered",
  PROVIDER_UI_READY: "provider-ui-ready",
  FILE_SEARCH_ENGINE: "file-search-engine",
  QUICKOPEN_UI: "quickopen-ui",
});

export const LSP_TRACKER_FIXTURE_FILE = "medium-2k.ts";
export const POLICY_DISABLED_FIXTURE_FILE = "large-20k.ts";
export const POLICY_DISABLED_REASON =
  "large-document policy (5000 lines / 256 KiB) disables JS/TS features on this file";
const CAPABILITY_NOT_CHECKED_REASON = `This run never inspected whether the large-document policy disables JS/TS features on ${POLICY_DISABLED_FIXTURE_FILE}.`;

export const LANGUAGE_SERVER_STATUS_KINDS = new Set([
  "crashed",
  "none",
  "running",
  "starting",
  "stopped",
]);

export const TAB_SWITCH_FRAME_SETTLE_FLOOR_MS = 33;

export const TAB_SWITCH_WINDOW_NOTE =
  "activation plus two requestAnimationFrame ticks with the target model asserted active; " +
  "includes frame production, so the window " +
  `cannot report below ~${TAB_SWITCH_FRAME_SETTLE_FLOOR_MS} ms at 60 Hz`;

export const VSCODE_TAB_SWITCH_WINDOW_NOTE =
  "awaits vscode.open resolution only; no frame settlement";

export const TYPING_DISPATCH_WINDOW_NOTE =
  "keystroke dispatch until Monaco onDidChangeModelContent fires for the active model; " +
  "no layout, rendering, or paint cost is included";

export const TYPING_FRAME_WINDOW_NOTE =
  "keystroke dispatch until the second requestAnimationFrame tick after the edit; Codevo-only " +
  "absolute budget row, the extension host cannot observe paint on the VS Code side";

export const COMPLETION_UNBOUNDED_WINDOW_NOTE =
  "global unfiltered completion; Codevo caps its Rust projection at 2000 items while VS Code " +
  "converts the whole ambient symbol table, so this row is permanently non-comparable by " +
  "result counts";

export const FILE_SEARCH_WINDOW_NOTE =
  "searchFilesWithMetadata engine query capped at 80 results; this is the file-search engine " +
  "only and is never the Quick Open overlay, its ranking, or its list rendering";

export const QUICKOPEN_UI_WINDOW_NOTE =
  "overlay open, query dispatched immediately (no input debounce), engine result observed and " +
  "ranked results rendered plus one settling frame; Codevo-only absolute budget row";

export const KIND_TARGET_PATTERN_SOURCE = 'export type (\\w+Kind) = "a" \\| "b" \\| "c";';
export const KIND_TARGET_COUNT = 10;
export const LSP_WARMUP_COUNT = 2;
export const LSP_SAMPLE_COUNT = 10;

export const TYPING_PROBE_TEXT =
  'const perfTypingProbe00 = "abcdefghijklmnopqrstuvwxyz0123456789";';
export const TYPING_WARMUP_KEYSTROKES = 10;
export const TYPING_SAMPLE_KEYSTROKES = 50;

export const FILE_SEARCH_QUERIES = [
  "file-01",
  "moduleA",
  "pkg-3",
  "index",
  "moduleB",
  "extra",
  "file-05",
  "pkg-4",
  "large",
  "tsconfig",
];

export const LSP_TRACKER_SCENARIO_IDS = [
  "completion-bounded",
  "completion-unbounded",
  "definition-medium-2k",
  "references-medium-2k",
  "rename-medium-2k",
];

export const CAPABILITY_SCENARIO_IDS = [
  "completion-large-20k",
  "definition-large-20k",
  "references-large-20k",
  "rename-large-20k",
];

export const PERF_SCENARIOS = [
  { id: "tab-switch-cycle", kind: "bridge", cutPoint: CUT_POINTS.TAB_SWITCH_RENDERED },
  { id: "typing-large-5k", kind: "bridge", cutPoint: CUT_POINTS.TYPING_DISPATCH },
  { id: "typing-large-5k-frame", kind: "bridge", cutPoint: CUT_POINTS.TYPING_FRAME },
  { id: "typing-large-20k", kind: "bridge", cutPoint: CUT_POINTS.TYPING_DISPATCH },
  { id: "typing-large-20k-frame", kind: "bridge", cutPoint: CUT_POINTS.TYPING_FRAME },
  { id: "typing-large-100k", kind: "bridge", cutPoint: CUT_POINTS.TYPING_DISPATCH },
  { id: "typing-large-100k-frame", kind: "bridge", cutPoint: CUT_POINTS.TYPING_FRAME },
  { id: "completion-bounded", kind: "bridge", cutPoint: CUT_POINTS.PROVIDER_UI_READY },
  { id: "completion-unbounded", kind: "bridge", cutPoint: CUT_POINTS.PROVIDER_UI_READY },
  { id: "definition-medium-2k", kind: "bridge", cutPoint: CUT_POINTS.PROVIDER_UI_READY },
  { id: "references-medium-2k", kind: "bridge", cutPoint: CUT_POINTS.PROVIDER_UI_READY },
  { id: "rename-medium-2k", kind: "bridge", cutPoint: CUT_POINTS.PROVIDER_UI_READY },
  { id: "completion-large-20k", kind: "capability", run: "completion" },
  { id: "definition-large-20k", kind: "capability", run: "definition" },
  { id: "references-large-20k", kind: "capability", run: "references" },
  { id: "rename-large-20k", kind: "capability", run: "rename" },
  { id: "file-search-engine", kind: "bridge", cutPoint: CUT_POINTS.FILE_SEARCH_ENGINE },
  { id: "quickopen-ui", kind: "bridge", cutPoint: CUT_POINTS.QUICKOPEN_UI },
  { id: "memory-sample", kind: "memory" },
];

export function percentilesFromSamples(samples) {
  if (samples.length === 0) {
    return { p50: 0, p95: 0 };
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const p50 = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];

  return { p50, p95 };
}

function basenameOf(path) {
  if (typeof path !== "string" || path === "") {
    return null;
  }

  const segments = path.split(/[\\/]/);

  return segments[segments.length - 1] || null;
}

export function summarizeTabSwitchPairs(orderedPaths, samples, previousPath) {
  if (!Array.isArray(orderedPaths) || !Array.isArray(samples)) {
    return [];
  }

  const pairCount = Math.min(orderedPaths.length, samples.length);
  const order = [];
  const grouped = new Map();

  for (let index = 0; index < pairCount; index += 1) {
    const fromBasename = basenameOf(index === 0 ? previousPath : orderedPaths[index - 1]);
    const toBasename = basenameOf(orderedPaths[index]);
    const key = JSON.stringify([fromBasename, toBasename]);

    if (!grouped.has(key)) {
      grouped.set(key, { fromBasename, toBasename, samples: [] });
      order.push(key);
    }

    grouped.get(key).samples.push(samples[index]);
  }

  return order.map((key) => {
    const pair = grouped.get(key);

    return {
      fromBasename: pair.fromBasename,
      toBasename: pair.toBasename,
      count: pair.samples.length,
      ...percentilesFromSamples(pair.samples),
    };
  });
}

let cachedCodevoVersion = null;

function codevoVersion() {
  if (cachedCodevoVersion !== null) {
    return cachedCodevoVersion;
  }

  try {
    const packageJsonPath = fileURLToPath(new URL("../../package.json", import.meta.url));
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    cachedCodevoVersion = typeof parsed.version === "string" ? parsed.version : "unknown";
  } catch {
    cachedCodevoVersion = "unknown";
  }

  return cachedCodevoVersion;
}

const MONOREPO_HASH_KEY_PREFIX = "monorepo/";

function aggregateFixtureDigest(hashesByRelativePath) {
  const digest = createHash("sha256");

  for (const relativePath of Object.keys(hashesByRelativePath).sort()) {
    digest.update(`${relativePath}:${hashesByRelativePath[relativePath]}\n`);
  }

  return digest.digest("hex");
}

const LARGE_FILES_HASH_KEY_PREFIX = "large-files/";

export function normalizeFixtureHashKeys(rawHashes) {
  if (!rawHashes || typeof rawHashes !== "object" || Array.isArray(rawHashes)) {
    return null;
  }

  const normalized = {};
  const monorepoFiles = {};

  for (const key of Object.keys(rawHashes).sort()) {
    const value = rawHashes[key];

    if (typeof value !== "string" || value === "") {
      return null;
    }

    if (key.startsWith(LARGE_FILES_HASH_KEY_PREFIX)) {
      normalized[key] = value;
      continue;
    }

    if (key === MONOREPO_HASH_KEY_PREFIX) {
      normalized[key] = value;
      continue;
    }

    if (key.startsWith(MONOREPO_HASH_KEY_PREFIX)) {
      monorepoFiles[key.slice(MONOREPO_HASH_KEY_PREFIX.length)] = value;
    }
  }

  if (Object.keys(monorepoFiles).length > 0) {
    normalized[MONOREPO_HASH_KEY_PREFIX] = aggregateFixtureDigest(monorepoFiles);
  }

  if (Object.keys(normalized).length === 0) {
    return null;
  }

  return normalized;
}

function isFiniteNonnegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function shapedEnvironment(pageEnvironment, capturedAt) {
  if (!pageEnvironment || typeof pageEnvironment !== "object" || Array.isArray(pageEnvironment)) {
    return null;
  }

  const environment = { editor: "codevo", version: codevoVersion() };

  if (pageEnvironment.bundleMode === "dev" || pageEnvironment.bundleMode === "production") {
    environment.bundleMode = pageEnvironment.bundleMode;
  }

  if (typeof pageEnvironment.strictMode === "boolean") {
    environment.strictMode = pageEnvironment.strictMode;
  }

  if (isFiniteNonnegativeNumber(pageEnvironment.timerQuantizationMs)) {
    environment.timerQuantizationMs = pageEnvironment.timerQuantizationMs;
  }

  const windowSize = pageEnvironment.windowSize;

  if (
    windowSize &&
    typeof windowSize === "object" &&
    isFiniteNonnegativeNumber(windowSize.width) &&
    isFiniteNonnegativeNumber(windowSize.height)
  ) {
    environment.windowSize = { width: windowSize.width, height: windowSize.height };
  }

  if (typeof pageEnvironment.platform === "string" && pageEnvironment.platform !== "") {
    environment.platform = pageEnvironment.platform;
  }

  environment.capturedAt = capturedAt;

  return environment;
}

export function shapeRunResult({
  capturedAt,
  bridgeResults = [],
  trackerSnapshot = [],
  scenarioStatuses = [],
  environment = null,
  retainedCounts = null,
  memorySample = null,
  failedPaths = [],
  fixtureVersion,
  fixtureHashes = null,
}) {
  void trackerSnapshot;
  const reportedStatusById = new Map(scenarioStatuses.map((entry) => [entry.id, entry]));
  const bridgeResultById = new Map(
    bridgeResults
      .filter((entry) => entry && typeof entry.id === "string")
      .map((entry) => [entry.id, entry]),
  );
  const scenarios = PERF_SCENARIOS.map((scenario) => {
    if (scenario.kind === "memory") {
      return {
        id: scenario.id,
        unit: "count-bytes",
        retainedCounts,
        memorySample,
      };
    }

    if (scenario.kind === "capability") {
      return shapeCapabilityScenario(scenario, reportedStatusById);
    }

    return shapeBridgeScenario(scenario, bridgeResultById, reportedStatusById);
  });
  const normalizedHashes = normalizeFixtureHashKeys(fixtureHashes);
  const shapedEnv = shapedEnvironment(environment, capturedAt);

  return {
    capturedAt,
    fixtureVersion,
    ...(normalizedHashes ? { fixtureHashes: normalizedHashes } : {}),
    ...(shapedEnv ? { environment: shapedEnv } : {}),
    failedPaths,
    scenarios,
  };
}

function failureStatusRow(scenario, reported) {
  return {
    id: scenario.id,
    unit: "ms",
    cutPoint: scenario.cutPoint,
    status: reported.status,
    reason: reported.reason,
  };
}

function shapeBridgeScenario(scenario, bridgeResultById, reportedStatusById) {
  const reported = reportedStatusById.get(scenario.id);

  if (reported && reported.status !== SCENARIO_STATUS.OK) {
    return failureStatusRow(scenario, reported);
  }

  const entry = bridgeResultById.get(scenario.id);

  if (!entry) {
    return defaultMissingBridgeScenario(scenario);
  }

  const samples = shapedSamples(entry);
  const base = {
    id: scenario.id,
    unit: "ms",
    cutPoint: typeof entry.cutPoint === "string" ? entry.cutPoint : scenario.cutPoint,
    ...(Number.isInteger(entry.warmups) && entry.warmups >= 0 ? { warmups: entry.warmups } : {}),
    ...(validStringArray(entry.targets) ? { targets: [...entry.targets] } : {}),
    samples,
    ...percentilesFromSamples(samples.map((sample) => sample.ms)),
    status: SCENARIO_STATUS.OK,
  };
  const exactStatus = exactLanguageServerStatus(entry.languageServerStatus);
  const withStatus = exactStatus ? { ...base, languageServerStatus: exactStatus } : base;
  const withNote =
    typeof entry.windowNote === "string"
      ? { ...withStatus, windowNote: entry.windowNote }
      : withStatus;
  const withFloor =
    Number.isFinite(entry.frameSettleFloorMs) && entry.frameSettleFloorMs > 0
      ? { ...withNote, frameSettleFloorMs: entry.frameSettleFloorMs }
      : withNote;

  if (!Array.isArray(entry.switchPaths)) {
    return withFloor;
  }

  return {
    ...withFloor,
    pairs: summarizeTabSwitchPairs(
      entry.switchPaths,
      samples.map((sample) => sample.ms),
      entry.previousSwitchPath,
    ),
  };
}

function defaultMissingBridgeScenario(scenario) {
  if (scenario.id === "rename-medium-2k") {
    return {
      id: scenario.id,
      unit: "ms",
      cutPoint: scenario.cutPoint,
      status: SCENARIO_STATUS.SKIPPED,
      reason: "Rename produced no latency tracker data.",
    };
  }

  return {
    id: scenario.id,
    unit: "ms",
    cutPoint: scenario.cutPoint,
    status: SCENARIO_STATUS.NOT_RUN,
    reason: `No "${scenario.id}" measurement was recorded for this run.`,
  };
}

function shapedSamples(entry) {
  const rawSamples = Array.isArray(entry.samples) ? entry.samples : [];
  const rawCounts = entry.resultCounts;
  const countsUsable =
    Array.isArray(rawCounts) &&
    rawCounts.length === rawSamples.length &&
    rawCounts.every((count) => isFiniteNonnegativeNumber(count));

  return rawSamples
    .filter((ms) => isFiniteNonnegativeNumber(ms))
    .map((ms, index) => (countsUsable ? { ms, resultCount: rawCounts[index] } : { ms }));
}

function validStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function exactLanguageServerStatus(status) {
  if (typeof status === "string" && LANGUAGE_SERVER_STATUS_KINDS.has(status)) {
    return status;
  }

  if (!status || typeof status !== "object") {
    return null;
  }

  if (!LANGUAGE_SERVER_STATUS_KINDS.has(status.kind) || typeof status.running !== "boolean") {
    return null;
  }

  return status.kind;
}

function shapeCapabilityScenario(scenario, reportedStatusById) {
  const reported = reportedStatusById.get(scenario.id);

  if (reported) {
    return { id: scenario.id, unit: "ms", status: reported.status, reason: reported.reason };
  }

  return {
    id: scenario.id,
    unit: "ms",
    status: SCENARIO_STATUS.NOT_RUN,
    reason: CAPABILITY_NOT_CHECKED_REASON,
  };
}

export function inPagePerfRunnerSource() {
  return String.raw`async function runCodevoPerfScenarios(options) {
  const waitMs = options.waitMs;
  const intervalMs = options.intervalMs;
  const READINESS_TIMEOUT_MS = 60000;
  const READINESS_ATTEMPT_MS = 2000;
  const READINESS_POLL_MS = 500;
  const READINESS_MIN_COMPLETION_ITEMS = 1000;
  const SAMPLE_TIMEOUT_MS = 3000;
  const WORKSPACE_OPEN_TIMEOUT_MS = 60000;
  const FILE_OPEN_ATTEMPT_TIMEOUT_MS = 15000;
  const BRIDGE_OPERATION_TIMEOUT_MS = 30000;
  const TYPING_LS_READY_TIMEOUT_MS = 60000;
  const LSP_FIXTURE_FILE = ${JSON.stringify(LSP_TRACKER_FIXTURE_FILE)};
  const POLICY_FIXTURE_FILE = ${JSON.stringify(POLICY_DISABLED_FIXTURE_FILE)};
  const POLICY_DISABLED_REASON = ${JSON.stringify(POLICY_DISABLED_REASON)};
  const LSP_SCENARIO_IDS = ${JSON.stringify(LSP_TRACKER_SCENARIO_IDS)};
  const CAPABILITY_SCENARIO_IDS = ${JSON.stringify(CAPABILITY_SCENARIO_IDS)};
  const CUT_POINTS = ${JSON.stringify(CUT_POINTS)};
  const TAB_SWITCH_WINDOW_NOTE = ${JSON.stringify(TAB_SWITCH_WINDOW_NOTE)};
  const TAB_SWITCH_FRAME_SETTLE_FLOOR_MS = ${JSON.stringify(TAB_SWITCH_FRAME_SETTLE_FLOOR_MS)};
  const TYPING_DISPATCH_WINDOW_NOTE = ${JSON.stringify(TYPING_DISPATCH_WINDOW_NOTE)};
  const TYPING_FRAME_WINDOW_NOTE = ${JSON.stringify(TYPING_FRAME_WINDOW_NOTE)};
  const COMPLETION_UNBOUNDED_WINDOW_NOTE = ${JSON.stringify(COMPLETION_UNBOUNDED_WINDOW_NOTE)};
  const FILE_SEARCH_WINDOW_NOTE = ${JSON.stringify(FILE_SEARCH_WINDOW_NOTE)};
  const QUICKOPEN_UI_WINDOW_NOTE = ${JSON.stringify(QUICKOPEN_UI_WINDOW_NOTE)};
  const TYPING_PROBE_TEXT = ${JSON.stringify(TYPING_PROBE_TEXT)};
  const TYPING_WARMUP_KEYSTROKES = ${JSON.stringify(TYPING_WARMUP_KEYSTROKES)};
  const TYPING_SAMPLE_KEYSTROKES = ${JSON.stringify(TYPING_SAMPLE_KEYSTROKES)};
  const LSP_WARMUP_COUNT = ${JSON.stringify(LSP_WARMUP_COUNT)};
  const LSP_SAMPLE_COUNT = ${JSON.stringify(LSP_SAMPLE_COUNT)};
  const KIND_TARGET_COUNT = ${JSON.stringify(KIND_TARGET_COUNT)};
  const KIND_TARGET_PATTERN = new RegExp(${JSON.stringify(KIND_TARGET_PATTERN_SOURCE)}, "g");
  const FILE_SEARCH_QUERIES = ${JSON.stringify(FILE_SEARCH_QUERIES)};
  let diagnosticFrameTicks = 0;

  if (typeof requestAnimationFrame === "function") {
    (function pumpDiagnosticFrames() {
      requestAnimationFrame(() => {
        diagnosticFrameTicks += 1;
        pumpDiagnosticFrames();
      });
    })();
  }

  assertMeasurementWindowVisible();
  const initialQa = await waitFor(() => window.__codevoQa, waitMs, intervalMs);

  if (!initialQa) {
    throw bridgeError();
  }

  reportProgress("open large-files workspace");
  const largeFilesRootOpened = await ensureWorkspaceRoot(
    initialQa,
    options.largeFilesRoot,
    WORKSPACE_OPEN_TIMEOUT_MS,
  );
  if (!largeFilesRootOpened) {
    throw new Error(
      "Codevo did not open the large-files workspace " + options.largeFilesRoot +
        "; active root is " + String(initialQa.getWorkspaceRoot?.() ?? null) + ".",
    );
  }

  const largeFileBridges = await waitForBridges(waitMs, intervalMs);
  const qa = largeFileBridges.qa;
  const perf = largeFileBridges.perf;
  const bridgeResults = [];
  const scenarioStatuses = [];
  const failedPaths = [];
  const environment = readEnvironmentSample(perf);
  const largeFileNames = ["large-5k.ts", "large-20k.ts", "large-100k.ts", "minified.ts", "huge-union.ts"];
  const largeFilePaths = largeFileNames.map((name) => joinPath(options.largeFilesRoot, name));

  reportProgress("open large-file tabs");
  for (const path of largeFilePaths) {
    await openFile(qa, path);
  }

  const switchPaths = [];
  const switchCycles = options.smoke ? 1 : 6;

  for (let cycle = 0; cycle < switchCycles; cycle += 1) {
    switchPaths.push(...largeFilePaths);
  }

  reportProgress("measure large-file tab switches");
  const tabSwitchMeasurement = await withinDeadline(
    perf.measureTabSwitches(switchPaths),
    BRIDGE_OPERATION_TIMEOUT_MS,
    "large-file tab switches",
  );
  bridgeResults.push({
    id: "tab-switch-cycle",
    cutPoint: CUT_POINTS.TAB_SWITCH_RENDERED,
    warmups: largeFilePaths.length,
    targets: switchPaths.map((path) => path.split("/").pop()),
    windowNote: TAB_SWITCH_WINDOW_NOTE,
    frameSettleFloorMs: TAB_SWITCH_FRAME_SETTLE_FLOOR_MS,
    switchPaths: [...switchPaths],
    previousSwitchPath: largeFilePaths[largeFilePaths.length - 1],
    samples: [...tabSwitchMeasurement.durationsMs],
  });

  if (tabSwitchMeasurement.assertionFailures.length > 0) {
    scenarioStatuses.push({
      id: "tab-switch-cycle",
      status: "invalid",
      reason:
        tabSwitchMeasurement.assertionFailures.length +
        " of " + switchPaths.length + " tab switches failed the active-model assertion: " +
        tabSwitchMeasurement.assertionFailures[0],
    });
  }

  const typingScenarios = [
    { id: "typing-large-5k", path: largeFilePaths[0] },
    { id: "typing-large-20k", path: largeFilePaths[1] },
    { id: "typing-large-100k", path: largeFilePaths[2] },
  ];
  const selectedTypingScenarios = options.smoke ? typingScenarios.slice(0, 1) : typingScenarios;
  const typingKeystrokes = buildTypingKeystrokes();

  for (const scenario of selectedTypingScenarios) {
    reportProgress("typing " + scenario.path.split("/").pop());
    await openFile(qa, scenario.path);
    const largeStatus = perf.getLargeSmartDocumentStatus();
    const policyEligible =
      Boolean(largeStatus) && largeStatus.degraded === false && largeStatus.reason === null;

    if (policyEligible) {
      reportProgress("wait for JS/TS language server before typing " + scenario.path.split("/").pop());
      await waitForRunningLanguageServer(TYPING_LS_READY_TIMEOUT_MS);
    }

    const languageServerStatus = readLanguageServerStatusKind(perf);
    perf.clearLatencyMetrics();
    const typing = await withinDeadline(
      perf.runTypingScenario(typingKeystrokes),
      BRIDGE_OPERATION_TIMEOUT_MS,
      "typing " + scenario.path,
    );
    const frameId = scenario.id + "-frame";

    if (!typing) {
      pushTypingFailure(scenario.id, frameId, "invalid",
        "No active editor/model was available for the typing scenario on " + scenario.path + ".");
      continue;
    }

    const dispatchSamples = typing.dispatchMs.slice(TYPING_WARMUP_KEYSTROKES);
    const frameSamples = typing.frameMs.slice(TYPING_WARMUP_KEYSTROKES);
    const targets = typing.typedCharacters.slice(TYPING_WARMUP_KEYSTROKES);
    bridgeResults.push({
      id: scenario.id,
      cutPoint: CUT_POINTS.TYPING_DISPATCH,
      warmups: TYPING_WARMUP_KEYSTROKES,
      targets,
      windowNote: TYPING_DISPATCH_WINDOW_NOTE,
      languageServerStatus,
      samples: dispatchSamples,
    });
    bridgeResults.push({
      id: frameId,
      cutPoint: CUT_POINTS.TYPING_FRAME,
      warmups: TYPING_WARMUP_KEYSTROKES,
      targets,
      windowNote: TYPING_FRAME_WINDOW_NOTE,
      languageServerStatus,
      samples: frameSamples,
    });

    if (typing.missedDispatches > 0) {
      scenarioStatuses.push({
        id: scenario.id,
        status: "invalid",
        reason: typing.missedDispatches + " keystroke(s) never produced an onDidChangeModelContent event.",
      });
    }

    if (!typing.restored) {
      pushTypingFailure(scenario.id, frameId, "invalid",
        "The buffer for " + scenario.path + " was not restored to fixture content after typing.");
    }

    if (policyEligible && languageServerStatus !== "running") {
      pushTypingFailure(scenario.id, frameId, "invalid",
        scenario.path.split("/").pop() + " is policy-eligible for semantic features but the JS/TS " +
        "language server was \"" + languageServerStatus + "\" during typing, so the samples are not " +
        "representative of semantic-editing cost.");
    }
  }

  if (options.smoke) {
    return {
      bridgeResults,
      trackerSnapshot: [],
      scenarioStatuses,
      environment,
      failedPaths,
      retainedCounts: perf.getRetainedCounts(),
      memorySample: perf.getMemorySample(),
    };
  }

  const lspFixturePath = joinPath(options.largeFilesRoot, LSP_FIXTURE_FILE);
  reportProgress("prepare JS/TS language server");
  const lspFixtureOpened = await openFile(qa, lspFixturePath);
  perf.clearLatencyMetrics();
  perf.clearProviderProbeSamples();
  const lspSource = lspFixtureOpened ? (qa.getValue() || "") : "";
  const memberOffset = memberCompletionOffset(lspSource);
  const globalOffset = globalCompletionOffset(lspSource);
  const kindTargets = discoverKindTargets(lspSource);
  reportProgress("wait for JS/TS language server");
  const ready = lspFixtureOpened ? await waitForLanguageServerReadiness() : false;

  if (!ready) {
    for (const id of LSP_SCENARIO_IDS) {
      scenarioStatuses.push({
        id,
        status: "not-run",
        reason: "No completion list of at least " + READINESS_MIN_COMPLETION_ITEMS + " UI-ready items was produced for " + LSP_FIXTURE_FILE + " within " + READINESS_TIMEOUT_MS + " ms, so the JS/TS language server was never proven ready for " + options.largeFilesRoot + ".",
      });
    }
  }

  if (ready) {
    const languageServerStatus = readLanguageServerStatusKind(perf);

    if (memberOffset === null) {
      scenarioStatuses.push({
        id: "completion-bounded",
        status: "no-result",
        reason: LSP_FIXTURE_FILE + " contains no \"input.\" member expression to anchor bounded completion.",
      });
    }

    if (memberOffset !== null) {
      reportProgress("measure completion-bounded latency");
      await runProviderBatch({
        id: "completion-bounded",
        kind: "completion",
        languageServerStatus,
        targets: repeatedTargets(positionLabel("member:input.", memberOffset), LSP_SAMPLE_COUNT),
        invoke: () => {
          qa.setCursor(positionAtOffset(lspSource, memberOffset));
          qa.triggerCompletion();
        },
      });
    }

    reportProgress("measure completion-unbounded latency");
    await runProviderBatch({
      id: "completion-unbounded",
      kind: "completion",
      languageServerStatus,
      windowNote: COMPLETION_UNBOUNDED_WINDOW_NOTE,
      targets: repeatedTargets(positionLabel("global:blank-line", globalOffset), LSP_SAMPLE_COUNT),
      invoke: () => {
        qa.setCursor(positionAtOffset(lspSource, globalOffset));
        qa.triggerCompletion();
      },
    });

    if (kindTargets.length < KIND_TARGET_COUNT) {
      for (const id of ["definition-medium-2k", "references-medium-2k", "rename-medium-2k"]) {
        scenarioStatuses.push({
          id,
          status: "no-result",
          reason: LSP_FIXTURE_FILE + " yielded only " + kindTargets.length + " of the required " + KIND_TARGET_COUNT + " *Kind declarations with a \": <name>;\" field usage.",
        });
      }
    }

    if (kindTargets.length >= KIND_TARGET_COUNT) {
      const kindNames = kindTargets.map((target) => target.name);
      reportProgress("measure definition latency");
      await runProviderBatch({
        id: "definition-medium-2k",
        kind: "definition",
        languageServerStatus,
        targets: kindNames,
        invoke: async (index) => {
          qa.setCursor(positionAtOffset(lspSource, kindTargets[index].refOffset));
          await qa.triggerDefinition();
        },
      });

      reportProgress("measure references latency");
      await runProviderBatch({
        id: "references-medium-2k",
        kind: "references",
        languageServerStatus,
        targets: kindNames,
        invoke: async (index) => {
          const triggered = await withinDeadline(
            perf.runReferencesProbe(positionAtOffset(lspSource, kindTargets[index].declOffset)),
            BRIDGE_OPERATION_TIMEOUT_MS,
            "references provider probe for " + kindTargets[index].name,
          );

          if (!triggered) {
            throw new Error(
              "The references provider adapter was unavailable or returned no location list for " +
                kindTargets[index].name + ".",
            );
          }
        },
      });

      reportProgress("measure rename latency");
      const renameBaseline = qa.getValue() || "";
      await runProviderBatch({
        id: "rename-medium-2k",
        kind: "rename",
        languageServerStatus,
        targets: kindNames,
        invoke: async (index) => {
          const renamed = await withinDeadline(
            perf.runRenameProbe(
              positionAtOffset(lspSource, kindTargets[index].declOffset),
              kindTargets[index].name + "Renamed",
            ),
            BRIDGE_OPERATION_TIMEOUT_MS,
            "rename provider probe for " + kindTargets[index].name,
          );

          if (!renamed) {
            throw new Error(
              "The rename provider adapter was unavailable or rejected the rename for " +
                kindTargets[index].name + ", so no rename edit was computed.",
            );
          }
        },
      });
      const renameAftermath = qa.getValue() || "";

      if (renameAftermath !== renameBaseline) {
        const restored =
          typeof perf.restoreActiveEditorContent === "function" &&
          perf.restoreActiveEditorContent(renameBaseline);
        scenarioStatuses.push({
          id: "rename-medium-2k",
          status: "invalid",
          reason:
            "The rename batch modified the " + LSP_FIXTURE_FILE + " buffer even though the perf " +
            "rename must never apply its edit; the fixture content was " +
            (restored ? "restored afterwards." : "NOT restored afterwards."),
        });
      }
    }
  }

  const policyFixturePath = joinPath(options.largeFilesRoot, POLICY_FIXTURE_FILE);
  reportProgress("inspect large-document policy");
  const policyFixtureOpened = await openFile(qa, policyFixturePath);
  recordCapabilityStatuses(policyFixtureOpened ? perf.getLargeSmartDocumentStatus() : null);

  reportProgress("open monorepo workspace");
  const monorepoRootOpened = await ensureWorkspaceRoot(
    qa,
    options.monorepoRoot,
    WORKSPACE_OPEN_TIMEOUT_MS,
  );
  if (!monorepoRootOpened) {
    throw new Error(
      "Codevo did not open the monorepo workspace " + options.monorepoRoot +
        "; active root is " + String(qa.getWorkspaceRoot?.() ?? null) + ".",
    );
  }
  const monorepoBridges = await waitForBridges(waitMs, intervalMs);
  const monorepoPerf = monorepoBridges.perf;
  monorepoPerf.clearLatencyMetrics();
  monorepoPerf.clearProviderProbeSamples();

  await measureQuickOpenScenarios();
  reportProgress("collect performance result");

  return {
    bridgeResults,
    trackerSnapshot: [],
    scenarioStatuses,
    environment,
    failedPaths,
    retainedCounts: monorepoPerf.getRetainedCounts(),
    memorySample: monorepoPerf.getMemorySample(),
  };

  function buildTypingKeystrokes() {
    const total = TYPING_WARMUP_KEYSTROKES + TYPING_SAMPLE_KEYSTROKES;
    let text = "";

    while (text.length < total) {
      text += TYPING_PROBE_TEXT;
    }

    return text.slice(0, total);
  }

  function pushTypingFailure(dispatchId, frameId, status, reason) {
    scenarioStatuses.push({ id: dispatchId, status, reason });
    scenarioStatuses.push({ id: frameId, status, reason });
  }

  function readEnvironmentSample(bridge) {
    try {
      return typeof bridge.getEnvironmentSample === "function" ? bridge.getEnvironmentSample() : null;
    } catch {
      return null;
    }
  }

  function readLanguageServerStatusKind(bridge) {
    try {
      const status =
        typeof bridge.getLanguageServerRuntimeStatus === "function"
          ? bridge.getLanguageServerRuntimeStatus()
          : null;

      return status && typeof status.kind === "string" ? status.kind : "none";
    } catch {
      return "none";
    }
  }

  async function waitForRunningLanguageServer(timeoutMs) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (readLanguageServerStatusKind(perf) === "running") {
        return true;
      }

      await sleep(Math.max(intervalMs, 100));
    }

    return false;
  }

  function recordCapabilityStatuses(status) {
    if (!status) {
      pushCapabilityStatus("not-run", POLICY_FIXTURE_FILE + " could not be opened, so its large-document policy verdict was never observed.");
      return;
    }

    if (status.reason === "no-active-model") {
      pushCapabilityStatus("not-run", POLICY_FIXTURE_FILE + " was not the active model when the large-document policy verdict was read.");
      return;
    }

    if (status.degraded) {
      pushCapabilityStatus("policy-disabled", POLICY_DISABLED_REASON);
      return;
    }

    pushCapabilityStatus("not-run", "The large-document policy no longer disables JS/TS features on " + POLICY_FIXTURE_FILE + " (" + status.lineCount + " lines / " + status.utf16Length + " chars against limits of " + status.lineLimit + " lines / " + status.characterLimit + " chars); re-enable a real measurement for this file.");
  }

  function pushCapabilityStatus(status, reason) {
    for (const id of CAPABILITY_SCENARIO_IDS) {
      scenarioStatuses.push({ id, status, reason });
    }
  }

  async function waitForLanguageServerReadiness() {
    const startedAt = Date.now();
    const endOfFileOffset = lspSource.length;

    while (Date.now() - startedAt < READINESS_TIMEOUT_MS) {
      perf.clearProviderProbeSamples();
      qa.setCursor(positionAtOffset(lspSource, endOfFileOffset));
      qa.triggerCompletion();
      const sample = await waitForProbeSample("completion", 0, READINESS_ATTEMPT_MS);

      if (sample && sample.resultCount >= READINESS_MIN_COMPLETION_ITEMS) {
        perf.clearProviderProbeSamples();
        perf.clearLatencyMetrics();
        return true;
      }

      await sleep(READINESS_POLL_MS);
    }

    return false;
  }

  async function waitForProbeSample(kind, previousCount, timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const samples = perf.getProviderProbeSamples(kind);

      if (samples.length > previousCount) {
        return samples[samples.length - 1];
      }

      await sleep(intervalMs);
    }

    return null;
  }

  async function runProviderBatch(spec) {
    const abandonBatchWithStatus = (status, reason) => {
      scenarioStatuses.push({ id: spec.id, status, reason });
      perf.clearProviderProbeSamples();
      perf.clearLatencyMetrics();
      return false;
    };
    const abandonBatch = (reason) => abandonBatchWithStatus("not-run", reason);

    for (let warmup = 0; warmup < LSP_WARMUP_COUNT; warmup += 1) {
      const before = perf.getProviderProbeSamples(spec.kind).length;

      try {
        await spec.invoke(warmup);
      } catch (error) {
        return abandonBatch("Warm-up " + (warmup + 1) + " of " + LSP_WARMUP_COUNT + " for " + spec.id + " failed: " + String(error && error.message || error));
      }

      const observed = await waitForProbeSample(spec.kind, before, SAMPLE_TIMEOUT_MS);

      if (!observed) {
        return abandonBatch("Warm-up " + (warmup + 1) + " of " + LSP_WARMUP_COUNT + " for " + spec.id + " produced no UI-ready sample within " + SAMPLE_TIMEOUT_MS + " ms.");
      }
    }

    perf.clearProviderProbeSamples();
    perf.clearLatencyMetrics();

    for (let index = 0; index < LSP_SAMPLE_COUNT; index += 1) {
      const before = perf.getProviderProbeSamples(spec.kind).length;

      if (before !== index) {
        return abandonBatchWithStatus("invalid", "The " + spec.kind + " batch for " + LSP_FIXTURE_FILE + " observed " + before + " probe sample(s) before invocation " + (index + 1) + " where exactly " + index + " were expected, so per-target attribution can no longer be trusted.");
      }

      try {
        await spec.invoke(index);
      } catch (error) {
        return abandonBatch("The " + spec.kind + " batch for " + LSP_FIXTURE_FILE + " stopped after " + index + " of " + LSP_SAMPLE_COUNT + " samples: " + String(error && error.message || error));
      }

      const observed = await waitForProbeSample(spec.kind, before, SAMPLE_TIMEOUT_MS);

      if (!observed) {
        return abandonBatch("The " + spec.kind + " batch for " + LSP_FIXTURE_FILE + " stopped after " + index + " of " + LSP_SAMPLE_COUNT + " samples because an attempt produced no UI-ready sample within " + SAMPLE_TIMEOUT_MS + " ms.");
      }

      const after = perf.getProviderProbeSamples(spec.kind).length;

      if (after !== before + 1) {
        return abandonBatchWithStatus("invalid", "Invocation " + (index + 1) + " of the " + spec.kind + " batch for " + LSP_FIXTURE_FILE + " recorded " + (after - before) + " probe sample(s); exactly one UI-ready sample per invocation is required for per-target attribution.");
      }
    }

    const probeSamples = perf.getProviderProbeSamples(spec.kind);
    perf.clearProviderProbeSamples();
    perf.clearLatencyMetrics();

    if (probeSamples.length !== LSP_SAMPLE_COUNT) {
      scenarioStatuses.push({
        id: spec.id,
        status: "invalid",
        reason: "The " + spec.kind + " batch for " + LSP_FIXTURE_FILE + " ended with " + probeSamples.length + " probe sample(s) instead of exactly " + LSP_SAMPLE_COUNT + ", so per-target attribution cannot be trusted.",
      });
      return false;
    }
    const emptyTargets = spec.targets.filter(
      (target, index) => (probeSamples[index]?.resultCount ?? 0) <= 0,
    );

    if (emptyTargets.length > 0) {
      scenarioStatuses.push({
        id: spec.id,
        status: "no-result",
        reason: "Empty UI-ready provider result for targets: " + emptyTargets.join(", ") + ".",
      });
      return false;
    }

    bridgeResults.push({
      id: spec.id,
      cutPoint: CUT_POINTS.PROVIDER_UI_READY,
      warmups: LSP_WARMUP_COUNT,
      targets: [...spec.targets],
      languageServerStatus: spec.languageServerStatus,
      ...(spec.windowNote ? { windowNote: spec.windowNote } : {}),
      samples: probeSamples.map((sample) => sample.ms),
      resultCounts: probeSamples.map((sample) => sample.resultCount),
    });
    return true;
  }

  async function measureQuickOpenScenarios() {
    for (let warmup = 0; warmup < LSP_WARMUP_COUNT; warmup += 1) {
      reportProgress("warm up quick open: " + FILE_SEARCH_QUERIES[warmup]);
      const warmed = await withinDeadline(
        monorepoPerf.runQuickOpenUiQuery(FILE_SEARCH_QUERIES[warmup]),
        BRIDGE_OPERATION_TIMEOUT_MS,
        "quick open warm-up query " + FILE_SEARCH_QUERIES[warmup],
      );

      if (!warmed) {
        pushQuickOpenFailure("Quick Open warm-up query \"" + FILE_SEARCH_QUERIES[warmup] + "\" never rendered a settled result set.");
        return;
      }
    }

    monorepoPerf.clearProviderProbeSamples();
    monorepoPerf.clearLatencyMetrics();
    const engineSamples = [];
    const uiSamples = [];

    for (const query of FILE_SEARCH_QUERIES) {
      reportProgress("measure quick open: " + query);
      const before = monorepoPerf.getProviderProbeSamples("fileSearchEngine").length;
      const ui = await withinDeadline(
        monorepoPerf.runQuickOpenUiQuery(query),
        BRIDGE_OPERATION_TIMEOUT_MS,
        "quick open query " + query,
      );

      if (!ui) {
        pushQuickOpenFailure("Quick Open did not render a settled result set for query \"" + query + "\", so the measurement batch is incomplete.");
        monorepoPerf.clearProviderProbeSamples();
        return;
      }

      const engine = monorepoPerf
        .getProviderProbeSamples("fileSearchEngine")
        .slice(before)
        .filter((sample) => sample.target === query);

      if (engine.length !== 1) {
        pushQuickOpenFailure("Expected exactly one file-search engine sample for query \"" + query + "\" but observed " + engine.length + ".");
        monorepoPerf.clearProviderProbeSamples();
        return;
      }

      engineSamples.push(engine[0]);
      uiSamples.push(ui);
    }

    monorepoPerf.clearProviderProbeSamples();

    if (engineSamples.every((sample) => sample.resultCount === 0)) {
      scenarioStatuses.push({
        id: "file-search-engine",
        status: "no-result",
        reason: "Every query returned an empty result list, so the file-search engine did no measurable work.",
      });
    }

    if (!engineSamples.every((sample) => sample.resultCount === 0)) {
      bridgeResults.push({
        id: "file-search-engine",
        cutPoint: CUT_POINTS.FILE_SEARCH_ENGINE,
        warmups: LSP_WARMUP_COUNT,
        targets: [...FILE_SEARCH_QUERIES],
        windowNote: FILE_SEARCH_WINDOW_NOTE + emptyQueriesNote(engineSamples),
        samples: engineSamples.map((sample) => sample.ms),
        resultCounts: engineSamples.map((sample) => sample.resultCount),
      });
    }

    bridgeResults.push({
      id: "quickopen-ui",
      cutPoint: CUT_POINTS.QUICKOPEN_UI,
      warmups: LSP_WARMUP_COUNT,
      targets: [...FILE_SEARCH_QUERIES],
      windowNote: QUICKOPEN_UI_WINDOW_NOTE,
      samples: uiSamples.map((sample) => sample.ms),
      resultCounts: uiSamples.map((sample) => sample.resultCount),
    });
  }

  function emptyQueriesNote(samples) {
    const empty = FILE_SEARCH_QUERIES.filter((query, index) => samples[index].resultCount === 0);

    if (empty.length === 0) {
      return "";
    }

    return "; queries with no match in this fixture: " + empty.join(", ");
  }

  function pushQuickOpenFailure(reason) {
    scenarioStatuses.push({ id: "file-search-engine", status: "not-run", reason });
    scenarioStatuses.push({ id: "quickopen-ui", status: "not-run", reason });
  }

  function positionAtOffset(text, offset) {
    const lines = text.slice(0, offset).split("\n");

    return { lineNumber: lines.length, column: lines[lines.length - 1].length + 1 };
  }

  function positionLabel(prefix, offset) {
    const position = positionAtOffset(lspSource, offset);

    return prefix + "@" + position.lineNumber + ":" + position.column;
  }

  function repeatedTargets(label, count) {
    const targets = [];

    for (let index = 0; index < count; index += 1) {
      targets.push(label);
    }

    return targets;
  }

  function globalCompletionOffset(text) {
    const blankIndex = text.indexOf("\n\n");

    if (blankIndex === -1) {
      return 0;
    }

    return blankIndex + 1;
  }

  function memberCompletionOffset(text) {
    const memberIndex = text.indexOf("input.");

    if (memberIndex === -1) {
      return null;
    }

    return memberIndex + "input.".length;
  }

  function discoverKindTargets(text) {
    const targets = [];
    let match = KIND_TARGET_PATTERN.exec(text);

    while (match && targets.length < KIND_TARGET_COUNT) {
      const name = match[1];
      const declOffset = match.index + match[0].indexOf(name);
      const fieldIndex = text.indexOf(": " + name + ";", declOffset + name.length);
      match = KIND_TARGET_PATTERN.exec(text);

      if (fieldIndex === -1) {
        continue;
      }

      targets.push({ name, declOffset, refOffset: fieldIndex + 2 });
    }

    return targets;
  }

  async function openFile(bridge, path) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      reportProgress("open file: " + path + " (attempt " + (attempt + 1) + "/3)");
      const opened = await withinDeadline(
        bridge.openWorkspaceFile(path),
        FILE_OPEN_ATTEMPT_TIMEOUT_MS,
        "open workspace file " + path,
      );

      if (opened) {
        return true;
      }

      await sleep(intervalMs);
    }

    if (!failedPaths.includes(path)) {
      failedPaths.push(path);
    }

    return false;
  }

  async function waitForBridges(timeoutMs, pollMs) {
    const bridges = await waitFor(() => {
      if (!window.__codevoQa || !window.__codevoPerf) {
        return null;
      }

      return { qa: window.__codevoQa, perf: window.__codevoPerf };
    }, timeoutMs, pollMs);

    if (!bridges) {
      throw bridgeError();
    }

    return bridges;
  }

  async function waitFor(read, timeoutMs, pollMs) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const value = read();

      if (value) {
        return value;
      }

      await sleep(pollMs);
    }

    return null;
  }

  async function ensureWorkspaceRoot(bridge, root, timeoutMs) {
    const currentBridge = () => window.__codevoQa ?? bridge;
    if (workspaceRootsEqual(currentBridge().getWorkspaceRoot?.(), root)) return true;

    let openSettled = false;
    void Promise.resolve(bridge.openWorkspaceRoot(root)).then(
      () => { openSettled = true; },
      () => { openSettled = true; },
    );
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (workspaceRootsEqual(currentBridge().getWorkspaceRoot?.(), root)) return true;
      await sleep(intervalMs);
    }

    if (!openSettled) {
      console.warn("Workspace open bridge did not settle before the observable-root deadline.");
    }
    return false;
  }

  function reportProgress(stage) {
    window.__codevoPerfProgress = { stage, at: new Date().toISOString() };
    console.info("PERF STAGE", stage);
  }

  async function withinDeadline(promise, timeoutMs, label, throwOnTimeout = true) {
    let timer = null;
    const framesAtStart = diagnosticFrameTicks;
    const timedOut = Symbol("timed-out");
    const outcome = await Promise.race([
      Promise.resolve(promise),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(timedOut), timeoutMs);
      }),
    ]);
    if (timer !== null) clearTimeout(timer);
    if (outcome !== timedOut) return outcome;
    const message =
      label + " did not settle within " + timeoutMs + " ms. [diag: rAF frames during wait=" +
      (diagnosticFrameTicks - framesAtStart) + ", " + visibilityDiagnostics() + "]";
    if (throwOnTimeout) throw new Error(message);
    console.warn(message);
    return false;
  }

  function visibilityDiagnostics() {
    if (typeof document === "undefined") {
      return "visibility=unavailable";
    }

    const hasFocus = typeof document.hasFocus === "function" ? document.hasFocus() : "unknown";

    return "visibility=" + String(document.visibilityState) + ", hasFocus=" + String(hasFocus);
  }

  function assertMeasurementWindowVisible() {
    if (typeof document === "undefined") {
      return;
    }

    if (document.visibilityState !== "hidden") {
      return;
    }

    throw new Error(
      "The Codevo window is hidden (document.visibilityState=hidden), so WKWebView suspends " +
        "requestAnimationFrame and every frame-settled measurement would stall. Keep the app " +
        "window visible and the display awake (e.g. caffeinate -du, no screen lock) and rerun.",
    );
  }

  function workspaceRootsEqual(left, right) {
    const normalize = (value) => String(value ?? "").replace(/[\\/]+$/, "");
    return normalize(left) !== "" && normalize(left) === normalize(right);
  }

  function bridgeError() {
    return new Error(
      "Codevo QA/performance bridges are unavailable. Start the app with VITE_CODEVO_QA_BRIDGE=1 " +
        "VITE_CODEVO_PERF_BRIDGE=1 npm run debug:tauri (npm run debug:qa builds a production bundle " +
        "where the DEV-gated bridges never install).",
    );
  }

  function joinPath(root, relativePath) {
    return String(root).replace(/[\\/]+$/, "") + "/" + relativePath;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}`;
}
