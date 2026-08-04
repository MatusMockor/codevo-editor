import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  inPagePerfRunnerSource,
  isKnownScenarioStatus,
  normalizeFixtureHashKeys,
  percentilesFromSamples,
  shapeRunResult,
  summarizeTabSwitchPairs,
  CAPABILITY_SCENARIO_IDS,
  CUT_POINTS,
  FILE_SEARCH_QUERIES,
  FIXTURE_VERSION,
  KIND_TARGET_PATTERN_SOURCE,
  LSP_TRACKER_FIXTURE_FILE,
  LSP_TRACKER_SCENARIO_IDS,
  PERF_SCENARIOS,
  POLICY_DISABLED_FIXTURE_FILE,
  POLICY_DISABLED_REASON,
  SCENARIO_STATUS,
  TAB_SWITCH_FRAME_SETTLE_FLOOR_MS,
  TAB_SWITCH_WINDOW_NOTE,
  TYPING_PROBE_TEXT,
  TYPING_SAMPLE_KEYSTROKES,
  TYPING_WARMUP_KEYSTROKES,
  VSCODE_TAB_SWITCH_WINDOW_NOTE,
} from "./perfScenarios.mjs";
import {
  blockedScenarioIds,
  capturedAtForImportedResult,
  evaluateRunOutcome,
} from "./runPerfScenariosCli.mjs";

const CANONICAL_BRIDGE_IDS = [
  "tab-switch-cycle",
  "typing-large-5k",
  "typing-large-5k-frame",
  "typing-large-20k",
  "typing-large-20k-frame",
  "typing-large-100k",
  "typing-large-100k-frame",
  "completion-bounded",
  "completion-unbounded",
  "definition-medium-2k",
  "references-medium-2k",
  "rename-medium-2k",
  "file-search-engine",
  "quickopen-ui",
];

function buildLspSource(kindCount = 10) {
  const lines = [
    "export function processEvent1(input: { id: number; label: string }): string {",
    "  return String(input.id);",
    "}",
    "",
  ];

  for (let index = 0; index < kindCount; index += 1) {
    lines.push(`export type Model${index}Kind = "a" | "b" | "c";`);
    lines.push(`export interface Holder${index} { kind: Model${index}Kind; }`);
  }

  return lines.join("\n");
}

function expectedTypingKeystrokes() {
  const total = TYPING_WARMUP_KEYSTROKES + TYPING_SAMPLE_KEYSTROKES;
  let text = "";

  while (text.length < total) {
    text += TYPING_PROBE_TEXT;
  }

  return Array.from(text.slice(0, total));
}

function createHarness({ source = buildLspSource(), completionResultCount = 2000 } = {}) {
  const probe = new Map();
  const record = (kind, sample) => {
    const list = probe.get(kind) ?? [];
    list.push(sample);
    probe.set(kind, list);
  };
  let workspaceRoot = "/perf/large-files";
  const qa = {
    getWorkspaceRoot: () => workspaceRoot,
    openWorkspaceRoot: async (root) => {
      workspaceRoot = root;
    },
    openWorkspaceFile: async () => true,
    getValue: () => source,
    setCursor: () => {},
    triggerCompletion: () => {
      record("completion", { ms: 1, resultCount: completionResultCount });
    },
    triggerDefinition: async () => {
      record("definition", { ms: 1, resultCount: 1 });
    },
  };
  const perf = {
    clearLatencyMetrics: () => {},
    getLatencySnapshot: () => [],
    clearProviderProbeSamples: () => {
      probe.clear();
    },
    getProviderProbeSamples: (kind) => [...(probe.get(kind) ?? [])],
    getEnvironmentSample: () => ({
      bundleMode: "dev",
      windowMode: "focus-only",
      hostPlatform: "darwin",
      hostArch: "arm64",
      strictMode: false,
      timerQuantizationMs: 1,
      windowSize: { width: 1440, height: 900 },
      platform: "MacIntel",
    }),
    getLanguageServerRuntimeStatus: () => ({ kind: "running", running: true }),
    getLargeSmartDocumentStatus: () => ({
      degraded: true,
      reason: "line-limit",
      lineCount: 20_000,
      utf16Length: 400_000,
      lineLimit: 5_000,
      characterLimit: 262_144,
    }),
    measureTabSwitches: async (paths) => ({
      durationsMs: paths.map(() => 1),
      assertionFailures: [],
    }),
    runTypingScenario: async (text) => ({
      dispatchMs: Array.from(text, () => 0.5),
      frameMs: Array.from(text, () => 2),
      typedCharacters: Array.from(text),
      missedDispatches: 0,
      restored: true,
    }),
    runReferencesProbe: async () => {
      record("references", { ms: 1, resultCount: 3 });
      return true;
    },
    runRenameProbe: async () => {
      record("rename", { ms: 2, resultCount: 1 });
      return true;
    },
    restoreActiveEditorContent: () => true,
    runQuickOpenUiQuery: async (query) => {
      record("fileSearchEngine", { ms: 1, resultCount: query === "large" ? 0 : 5, target: query });
      return { ms: 3, resultCount: 6 };
    },
    getRetainedCounts: () => ({ models: 1, editors: 1 }),
    getMemorySample: () => ({ usedJsHeapBytes: 1 }),
  };

  return { qa, perf, probe, record };
}

async function runScenarios(harness, options = {}) {
  const previousWindow = globalThis.window;
  globalThis.window = { __codevoQa: harness.qa, __codevoPerf: harness.perf };

  try {
    const runner = Function(`return (${inPagePerfRunnerSource()});`)();

    return await runner({
      smoke: false,
      largeFilesRoot: "/perf/large-files",
      monorepoRoot: "/perf/monorepo",
      waitMs: 10,
      intervalMs: 0,
      ...options,
    });
  } finally {
    globalThis.window = previousWindow;
  }
}

function entryOf(result, id) {
  return result.bridgeResults.find((entry) => entry.id === id);
}

function scenarioOf(shaped, id) {
  return shaped.scenarios.find((scenario) => scenario.id === id);
}

describe("percentilesFromSamples", () => {
  it("computes p50 and p95", () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentilesFromSamples(samples)).toEqual({ p50: 50.5, p95: 95 });
  });

  it("handles empty input", () => {
    expect(percentilesFromSamples([])).toEqual({ p50: 0, p95: 0 });
  });
});

describe("SCENARIO_STATUS", () => {
  it("keeps the contract's closed status set including non-comparable", () => {
    expect(Object.values(SCENARIO_STATUS).sort()).toEqual([
      "invalid",
      "no-result",
      "non-comparable",
      "not-run",
      "ok",
      "policy-disabled",
      "skipped",
    ]);

    for (const status of Object.values(SCENARIO_STATUS)) {
      expect(isKnownScenarioStatus(status)).toBe(true);
    }
  });

  it("rejects statuses outside the closed set", () => {
    expect(isKnownScenarioStatus("fail")).toBe(false);
    expect(isKnownScenarioStatus("pass")).toBe(false);
    expect(isKnownScenarioStatus("totally-unrecognized-status")).toBe(false);
  });
});

describe("shapeRunResult", () => {
  it("shapes bridge samples into contract sample objects with an ok status", () => {
    const result = shapeRunResult({
      capturedAt: "2026-08-03T00:00:00.000Z",
      bridgeResults: [
        {
          id: "completion-bounded",
          cutPoint: CUT_POINTS.PROVIDER_UI_READY,
          warmups: 2,
          targets: ["member:input.@2:20", "member:input.@2:20"],
          samples: [2, 4],
          resultCounts: [7, 7],
          languageServerStatus: "running",
        },
      ],
    });
    const completion = scenarioOf(result, "completion-bounded");
    expect(completion.status).toBe("ok");
    expect(completion.cutPoint).toBe("provider-ui-ready");
    expect(completion.warmups).toBe(2);
    expect(completion.targets).toEqual(["member:input.@2:20", "member:input.@2:20"]);
    expect(completion.samples).toEqual([
      { ms: 2, resultCount: 7 },
      { ms: 4, resultCount: 7 },
    ]);
    expect(completion.p95).toBe(4);
    expect(completion.languageServerStatus).toBe("running");
  });

  it("drops per-sample result counts when they do not align with the samples", () => {
    const result = shapeRunResult({
      capturedAt: "2026-08-03T00:00:00.000Z",
      bridgeResults: [{ id: "references-medium-2k", samples: [1, 2], resultCounts: [3] }],
    });
    const references = scenarioOf(result, "references-medium-2k");
    expect(references.samples).toEqual([{ ms: 1 }, { ms: 2 }]);
  });

  it("lets a reported failure status win over recorded samples (contract rule 8)", () => {
    const result = shapeRunResult({
      capturedAt: "2026-08-03T00:00:00.000Z",
      bridgeResults: [{ id: "rename-medium-2k", samples: [1, 2, 3], resultCounts: [1, 1, 1] }],
      scenarioStatuses: [
        { id: "rename-medium-2k", status: "not-run", reason: "the rename widget never committed" },
      ],
    });
    const rename = scenarioOf(result, "rename-medium-2k");
    expect(rename.status).toBe("not-run");
    expect(rename.reason).toBe("the rename widget never committed");
    expect(rename.samples).toBeUndefined();
    expect(rename.p95).toBeUndefined();
  });

  it("keeps the recorded samples when the reported status is ok", () => {
    const result = shapeRunResult({
      capturedAt: "2026-08-03T00:00:00.000Z",
      bridgeResults: [{ id: "typing-large-5k", samples: [3] }],
      scenarioStatuses: [{ id: "typing-large-5k", status: "ok", reason: "green" }],
    });
    const typing = scenarioOf(result, "typing-large-5k");
    expect(typing.status).toBe("ok");
    expect(typing.samples).toEqual([{ ms: 3 }]);
  });

  it("carries a string language server status and converts the legacy object form", () => {
    const result = shapeRunResult({
      capturedAt: "2026-08-03T00:00:00.000Z",
      bridgeResults: [
        { id: "typing-large-5k", samples: [3], languageServerStatus: "stopped" },
        {
          id: "typing-large-20k",
          samples: [4],
          languageServerStatus: { kind: "running", running: true },
        },
        { id: "typing-large-100k", samples: [5], languageServerStatus: { kind: 7, running: "x" } },
      ],
    });
    expect(scenarioOf(result, "typing-large-5k").languageServerStatus).toBe("stopped");
    expect(scenarioOf(result, "typing-large-20k").languageServerStatus).toBe("running");
    expect(scenarioOf(result, "typing-large-100k").languageServerStatus).toBeUndefined();
  });

  it("emits an entry for every advertised scenario id and defaults absentees fail-closed", () => {
    const result = shapeRunResult({ capturedAt: "2026-08-03T00:00:00.000Z" });
    expect(result.scenarios.map((scenario) => scenario.id)).toEqual(
      PERF_SCENARIOS.map((scenario) => scenario.id),
    );

    const typing = scenarioOf(result, "typing-large-5k");
    expect(typing.status).toBe("not-run");
    expect(typing.reason).toBeTruthy();

    const rename = scenarioOf(result, "rename-medium-2k");
    expect(rename.status).toBe("skipped");
    expect(rename.reason).toBe("Rename produced no latency tracker data.");

    const capability = scenarioOf(result, "completion-large-20k");
    expect(capability.status).toBe("not-run");
    expect(capability.reason).toBeTruthy();
  });

  it("persists the memory sample scenario", () => {
    const result = shapeRunResult({
      capturedAt: "2026-07-31T00:00:00.000Z",
      retainedCounts: { models: 12, editors: 2 },
      memorySample: { usedJsHeapBytes: 4096 },
    });
    const memory = scenarioOf(result, "memory-sample");
    expect(memory).toEqual({
      id: "memory-sample",
      unit: "count-bytes",
      retainedCounts: { models: 12, editors: 2 },
      memorySample: { usedJsHeapBytes: 4096 },
    });
  });

  it("reports fixture paths that could not be opened", () => {
    const result = shapeRunResult({
      capturedAt: "2026-07-31T00:00:00.000Z",
      failedPaths: ["/monorepo/packages/pkg-50/src/extra/file-010.ts"],
    });
    expect(result.failedPaths).toEqual(["/monorepo/packages/pkg-50/src/extra/file-010.ts"]);
  });

  it("emits the run's policy-disabled capability rows for the large-20k LSP targets", () => {
    const result = shapeRunResult({
      capturedAt: "2026-07-31T00:00:00.000Z",
      scenarioStatuses: CAPABILITY_SCENARIO_IDS.map((id) => ({
        id,
        status: "policy-disabled",
        reason: POLICY_DISABLED_REASON,
      })),
    });

    for (const id of CAPABILITY_SCENARIO_IDS) {
      const scenario = scenarioOf(result, id);
      expect(scenario.status).toBe("policy-disabled");
      expect(scenario.reason).toBe(POLICY_DISABLED_REASON);
      expect(scenario.p95).toBeUndefined();
    }
  });

  it("applies a run-reported not-run reason to LSP scenarios with no samples", () => {
    const reason = "JS/TS language server never became ready for /perf/large-files.";
    const result = shapeRunResult({
      capturedAt: "2026-07-31T00:00:00.000Z",
      scenarioStatuses: LSP_TRACKER_SCENARIO_IDS.map((id) => ({ id, status: "not-run", reason })),
    });

    for (const id of LSP_TRACKER_SCENARIO_IDS) {
      const scenario = scenarioOf(result, id);
      expect(scenario.status).toBe("not-run");
      expect(scenario.reason).toBe(reason);
    }
  });

  it("composes the contract environment block from the page sample", () => {
    const result = shapeRunResult({
      capturedAt: "2026-08-03T00:00:00.000Z",
      environment: {
        bundleMode: "dev",
        windowMode: "focus-only",
        hostPlatform: "darwin",
        hostArch: "arm64",
        strictMode: false,
        timerQuantizationMs: 1,
        windowSize: { width: 1440, height: 900 },
        platform: "MacIntel",
      },
    });

    expect(result.environment.editor).toBe("codevo");
    expect(typeof result.environment.version).toBe("string");
    expect(result.environment.version.length).toBeGreaterThan(0);
    expect(result.environment.bundleMode).toBe("dev");
    expect(result.environment.windowMode).toBe("focus-only");
    expect(result.environment.hostPlatform).toBe("darwin");
    expect(result.environment.hostArch).toBe("arm64");
    expect(result.environment.strictMode).toBe(false);
    expect(result.environment.timerQuantizationMs).toBe(1);
    expect(result.environment.windowSize).toEqual({ width: 1440, height: 900 });
    expect(result.environment.platform).toBe("MacIntel");
    expect(result.environment.capturedAt).toBe("2026-08-03T00:00:00.000Z");
  });

  it("omits the environment block fail-closed when the page never reported one", () => {
    expect(shapeRunResult({ capturedAt: "x" }).environment).toBeUndefined();
    expect(shapeRunResult({ capturedAt: "x", environment: "dev" }).environment).toBeUndefined();
  });

  it("normalizes fixture hashes into the large-files/* plus aggregate monorepo/ key scheme", () => {
    const result = shapeRunResult({
      capturedAt: "2026-08-03T00:00:00.000Z",
      fixtureHashes: {
        "large-files/medium-2k.ts": "aaa",
        "monorepo/packages/pkg-01/src/index.ts": "bbb",
        "monorepo/packages/pkg-02/src/index.ts": "ccc",
        "stray-top-level.txt": "ddd",
      },
    });
    const digest = createHash("sha256");
    digest.update("packages/pkg-01/src/index.ts:bbb\n");
    digest.update("packages/pkg-02/src/index.ts:ccc\n");

    expect(result.fixtureHashes).toEqual({
      "large-files/medium-2k.ts": "aaa",
      "monorepo/": digest.digest("hex"),
    });
  });

  it("omits fixture hashes fail-closed when none were provided", () => {
    expect(shapeRunResult({ capturedAt: "x" }).fixtureHashes).toBeUndefined();
  });

  it("never spreads unknown bridge keys into the persisted scenario", () => {
    const result = shapeRunResult({
      capturedAt: "2026-08-02T00:00:00.000Z",
      bridgeResults: [{ id: "tab-switch-cycle", samples: [10], smuggled: "nope", windowNote: 7 }],
    });
    const tabSwitch = scenarioOf(result, "tab-switch-cycle");
    expect(tabSwitch.smuggled).toBeUndefined();
    expect(tabSwitch.windowNote).toBeUndefined();
  });

  it("threads the window note, floor, and switch pairs onto the shaped tab-switch scenario", () => {
    const result = shapeRunResult({
      capturedAt: "2026-08-02T00:00:00.000Z",
      bridgeResults: [
        {
          id: "tab-switch-cycle",
          samples: [40, 60],
          windowNote: TAB_SWITCH_WINDOW_NOTE,
          frameSettleFloorMs: TAB_SWITCH_FRAME_SETTLE_FLOOR_MS,
          switchPaths: ["/root/large-5k.ts", "/root/large-20k.ts"],
          previousSwitchPath: "/root/huge-union.ts",
        },
      ],
    });
    const tabSwitch = scenarioOf(result, "tab-switch-cycle");
    expect(tabSwitch.windowNote).toBe(TAB_SWITCH_WINDOW_NOTE);
    expect(tabSwitch.frameSettleFloorMs).toBe(TAB_SWITCH_FRAME_SETTLE_FLOOR_MS);
    expect(tabSwitch.p95).toBe(60);
    expect(tabSwitch.samples).toEqual([{ ms: 40 }, { ms: 60 }]);
    expect(tabSwitch.pairs).toEqual([
      { fromBasename: "huge-union.ts", toBasename: "large-5k.ts", count: 1, p50: 40, p95: 40 },
      { fromBasename: "large-5k.ts", toBasename: "large-20k.ts", count: 1, p50: 60, p95: 60 },
    ]);
  });
});

describe("normalizeFixtureHashKeys", () => {
  it("keeps an already aggregated map unchanged", () => {
    const hashes = { "large-files/a.ts": "aaa", "monorepo/": "bbb" };
    expect(normalizeFixtureHashKeys(hashes)).toEqual(hashes);
  });

  it("fails closed on malformed input", () => {
    expect(normalizeFixtureHashKeys(null)).toBeNull();
    expect(normalizeFixtureHashKeys([])).toBeNull();
    expect(normalizeFixtureHashKeys({ "large-files/a.ts": 7 })).toBeNull();
    expect(normalizeFixtureHashKeys({ "stray.txt": "aaa" })).toBeNull();
  });
});

describe("FIXTURE_VERSION", () => {
  it("advertises the v3 fixtures including medium-2k", () => {
    expect(FIXTURE_VERSION).toContain("large-files@v3");
    expect(FIXTURE_VERSION).toContain("medium-2k");
  });
});

describe("inPagePerfRunnerSource", () => {
  it("runs the canonical scenario set with the contract's rotation, warmups, and counts", async () => {
    const harness = createHarness();
    const result = await runScenarios(harness);

    expect(result.bridgeResults.map((entry) => entry.id)).toEqual(CANONICAL_BRIDGE_IDS);
    expect(result.trackerSnapshot).toEqual([]);
    expect(capturedAtForImportedResult(result)).toBe(result.environment.capturedAt);
    expect(Number.isFinite(Date.parse(result.environment.capturedAt))).toBe(true);

    const tabSwitch = entryOf(result, "tab-switch-cycle");
    expect(tabSwitch.cutPoint).toBe("tab-switch-rendered");
    expect(tabSwitch.warmups).toBe(5);
    expect(tabSwitch.samples).toHaveLength(30);
    expect(tabSwitch.targets).toHaveLength(30);
    expect(tabSwitch.targets.slice(0, 5)).toEqual([
      "large-5k.ts",
      "large-20k.ts",
      "large-100k.ts",
      "minified.ts",
      "huge-union.ts",
    ]);

    const typing = entryOf(result, "typing-large-5k");
    expect(typing.cutPoint).toBe("typing-dispatch");
    expect(typing.warmups).toBe(TYPING_WARMUP_KEYSTROKES);
    expect(typing.samples).toHaveLength(TYPING_SAMPLE_KEYSTROKES);
    expect(typing.targets).toEqual(expectedTypingKeystrokes().slice(TYPING_WARMUP_KEYSTROKES));
    expect(typing.languageServerStatus).toBe("running");

    const typingFrame = entryOf(result, "typing-large-5k-frame");
    expect(typingFrame.cutPoint).toBe("typing-frame");
    expect(typingFrame.samples).toHaveLength(TYPING_SAMPLE_KEYSTROKES);

    const bounded = entryOf(result, "completion-bounded");
    expect(bounded.cutPoint).toBe("provider-ui-ready");
    expect(bounded.warmups).toBe(2);
    expect(bounded.samples).toHaveLength(10);
    expect(bounded.resultCounts).toEqual(Array.from({ length: 10 }, () => 2000));
    expect(bounded.targets).toHaveLength(10);
    expect(new Set(bounded.targets).size).toBe(1);
    expect(bounded.targets[0]).toMatch(/^member:input\.@\d+:\d+$/);

    const unbounded = entryOf(result, "completion-unbounded");
    expect(unbounded.targets[0]).toMatch(/^global:blank-line@\d+:\d+$/);
    expect(unbounded.windowNote).toContain("non-comparable");

    const definition = entryOf(result, "definition-medium-2k");
    expect(definition.warmups).toBe(2);
    expect(definition.samples).toHaveLength(10);
    expect(definition.targets).toEqual(
      Array.from({ length: 10 }, (_, index) => `Model${index}Kind`),
    );

    const references = entryOf(result, "references-medium-2k");
    expect(references.resultCounts).toEqual(Array.from({ length: 10 }, () => 3));

    const rename = entryOf(result, "rename-medium-2k");
    expect(rename.cutPoint).toBe("provider-ui-ready");
    expect(rename.samples).toHaveLength(10);
    expect(rename.resultCounts).toEqual(Array.from({ length: 10 }, () => 1));

    const fileSearch = entryOf(result, "file-search-engine");
    expect(fileSearch.cutPoint).toBe("file-search-engine");
    expect(fileSearch.warmups).toBe(2);
    expect(fileSearch.targets).toEqual(FILE_SEARCH_QUERIES);
    expect(fileSearch.samples).toHaveLength(10);
    expect(fileSearch.resultCounts[FILE_SEARCH_QUERIES.indexOf("large")]).toBe(0);
    expect(fileSearch.windowNote).toContain("large");

    const quickOpenUi = entryOf(result, "quickopen-ui");
    expect(quickOpenUi.cutPoint).toBe("quickopen-ui");
    expect(quickOpenUi.warmups).toBe(2);
    expect(quickOpenUi.resultCounts).toEqual(Array.from({ length: 10 }, () => 6));

    expect(result.environment).toEqual({
      bundleMode: "dev",
      capturedAt: result.environment.capturedAt,
      windowMode: "focus-only",
      hostPlatform: "darwin",
      hostArch: "arm64",
      strictMode: false,
      timerQuantizationMs: 1,
      windowSize: { width: 1440, height: 900 },
      platform: "MacIntel",
    });
    expect(result.scenarioStatuses).toEqual(
      CAPABILITY_SCENARIO_IDS.map((id) => ({
        id,
        status: "policy-disabled",
        reason: POLICY_DISABLED_REASON,
      })),
    );

    const shaped = shapeRunResult({
      capturedAt: "2026-08-03T00:00:00.000Z",
      ...result,
      fixtureVersion: FIXTURE_VERSION,
    });
    expect(scenarioOf(shaped, "completion-bounded").status).toBe("ok");
    expect(scenarioOf(shaped, "file-search-engine").samples[8]).toEqual({ ms: 1, resultCount: 0 });
    expect(blockedScenarioIds(shaped, [], false)).toEqual([]);
    expect(evaluateRunOutcome({ result, shaped, smoke: false })).toEqual([]);
  });

  it("keeps a zero-result file-search query as a truthful valid sample, not a failure", async () => {
    const harness = createHarness();
    const result = await runScenarios(harness);

    expect(result.scenarioStatuses.some((status) => status.id === "file-search-engine")).toBe(
      false,
    );
    const fileSearch = entryOf(result, "file-search-engine");
    expect(fileSearch.samples).toHaveLength(10);
  });

  it("reports a rename batch whose widget never commits as not-run without fabricating samples", async () => {
    const harness = createHarness();
    harness.perf.runRenameProbe = async () => false;
    vi.useFakeTimers();

    try {
      const pending = runScenarios(harness, { intervalMs: 100 });
      await vi.advanceTimersByTimeAsync(120_000);
      const result = await pending;

      expect(entryOf(result, "rename-medium-2k")).toBeUndefined();
      const status = result.scenarioStatuses.find((entry) => entry.id === "rename-medium-2k");
      expect(status.status).toBe("not-run");
      expect(status.reason).toContain("rename");

      const shaped = shapeRunResult({
        capturedAt: "2026-08-03T00:00:00.000Z",
        ...result,
        fixtureVersion: FIXTURE_VERSION,
      });
      expect(scenarioOf(shaped, "rename-medium-2k").status).toBe("not-run");
      expect(scenarioOf(shaped, "rename-medium-2k").p95).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks the tab-switch scenario invalid when the active-model assertion fails", async () => {
    const harness = createHarness();
    harness.perf.measureTabSwitches = async (paths) => ({
      durationsMs: paths.slice(1).map(() => 1),
      assertionFailures: ["expected the active Monaco model to be /a.ts, saw /b.ts"],
    });
    const result = await runScenarios(harness);

    const status = result.scenarioStatuses.find((entry) => entry.id === "tab-switch-cycle");
    expect(status.status).toBe("invalid");
    expect(status.reason).toContain("active-model assertion");

    const shaped = shapeRunResult({
      capturedAt: "2026-08-03T00:00:00.000Z",
      ...result,
      fixtureVersion: FIXTURE_VERSION,
    });
    const row = scenarioOf(shaped, "tab-switch-cycle");
    expect(row.status).toBe("invalid");
    expect(row.samples).toBeUndefined();
    expect(row.p95).toBeUndefined();
  });

  it("marks both typing rows invalid when the buffer is not restored to fixture content", async () => {
    const harness = createHarness();
    harness.perf.runTypingScenario = async (text) => ({
      dispatchMs: Array.from(text, () => 0.5),
      frameMs: Array.from(text, () => 2),
      typedCharacters: Array.from(text),
      missedDispatches: 0,
      restored: false,
    });
    const result = await runScenarios(harness);

    for (const id of ["typing-large-5k", "typing-large-5k-frame"]) {
      const status = result.scenarioStatuses.find((entry) => entry.id === id);
      expect(status.status).toBe("invalid");
      expect(status.reason).toContain("not restored");
    }
  });

  it("marks typing on a policy-eligible fixture invalid when the language server is not running", async () => {
    const harness = createHarness();
    harness.perf.getLargeSmartDocumentStatus = () => ({
      degraded: false,
      reason: null,
      lineCount: 5_000,
      utf16Length: 149_780,
      lineLimit: 5_000,
      characterLimit: 262_144,
    });
    harness.perf.getLanguageServerRuntimeStatus = () => ({ kind: "stopped", running: false });
    vi.useFakeTimers();

    try {
      const pending = runScenarios(harness, { smoke: true, intervalMs: 100 });
      await vi.advanceTimersByTimeAsync(70_000);
      const result = await pending;

      expect(entryOf(result, "typing-large-5k").languageServerStatus).toBe("stopped");

      for (const id of ["typing-large-5k", "typing-large-5k-frame"]) {
        const status = result.scenarioStatuses.find((entry) => entry.id === id);
        expect(status.status).toBe("invalid");
        expect(status.reason).toContain("policy-eligible");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops an incomplete definition batch, discards its partial samples, and keeps later scenarios", async () => {
    const harness = createHarness();
    let calls = 0;
    harness.qa.triggerDefinition = async () => {
      calls += 1;

      if (calls === 5) {
        return;
      }

      harness.record("definition", { ms: 1, resultCount: 1 });
    };
    vi.useFakeTimers();

    try {
      const pending = runScenarios(harness, { intervalMs: 100 });
      await vi.advanceTimersByTimeAsync(120_000);
      const result = await pending;

      expect(entryOf(result, "definition-medium-2k")).toBeUndefined();
      const status = result.scenarioStatuses.find((entry) => entry.id === "definition-medium-2k");
      expect(status.status).toBe("not-run");
      expect(status.reason).toContain("stopped after 2 of 10");
      expect(entryOf(result, "references-medium-2k")).toBeDefined();
      expect(entryOf(result, "rename-medium-2k")).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails a provider batch closed as invalid when one invocation records more than one sample", async () => {
    const harness = createHarness();
    let calls = 0;
    harness.perf.runReferencesProbe = async () => {
      calls += 1;
      harness.record("references", { ms: 1, resultCount: 3 });

      if (calls === 4) {
        harness.record("references", { ms: 9, resultCount: 99 });
      }

      return true;
    };
    const result = await runScenarios(harness);

    expect(entryOf(result, "references-medium-2k")).toBeUndefined();
    const status = result.scenarioStatuses.find((entry) => entry.id === "references-medium-2k");
    expect(status.status).toBe("invalid");
    expect(status.reason).toContain("exactly one UI-ready sample per invocation");
    expect(entryOf(result, "rename-medium-2k")).toBeDefined();

    const shaped = shapeRunResult({
      capturedAt: "2026-08-03T00:00:00.000Z",
      ...result,
      fixtureVersion: FIXTURE_VERSION,
    });
    const row = scenarioOf(shaped, "references-medium-2k");
    expect(row.status).toBe("invalid");
    expect(row.samples).toBeUndefined();
  });

  it("marks rename invalid and restores the fixture when the batch modifies the buffer", async () => {
    const harness = createHarness();
    const originalGetValue = harness.qa.getValue;
    let mutated = false;
    harness.qa.getValue = () => (mutated ? `${originalGetValue()}Renamed` : originalGetValue());
    harness.perf.runRenameProbe = async () => {
      harness.record("rename", { ms: 2, resultCount: 1 });
      mutated = true;
      return true;
    };
    let restoredWith = null;
    harness.perf.restoreActiveEditorContent = (expected) => {
      restoredWith = expected;
      mutated = false;
      return true;
    };
    const result = await runScenarios(harness);

    const status = result.scenarioStatuses.find((entry) => entry.id === "rename-medium-2k");
    expect(status.status).toBe("invalid");
    expect(status.reason).toContain("must never apply its edit");
    expect(status.reason).toContain("restored afterwards.");
    expect(restoredWith).toBe(originalGetValue());

    const shaped = shapeRunResult({
      capturedAt: "2026-08-03T00:00:00.000Z",
      ...result,
      fixtureVersion: FIXTURE_VERSION,
    });
    expect(scenarioOf(shaped, "rename-medium-2k").status).toBe("invalid");
    expect(scenarioOf(shaped, "rename-medium-2k").samples).toBeUndefined();
  });

  it("drives references and rename through the single-fire provider adapters, not editor actions", () => {
    const source = inPagePerfRunnerSource();
    expect(source).toContain("perf.runReferencesProbe");
    expect(source).toContain("perf.runRenameProbe");
    expect(source).not.toContain("triggerReferences");
    expect(source).not.toContain("referenceSearch");
    expect(source).not.toContain("runRenameWithNewName");
  });

  it("fails the quick open batch closed when a query never renders a settled result set", async () => {
    const harness = createHarness();
    const defaultQuery = harness.perf.runQuickOpenUiQuery;
    harness.perf.runQuickOpenUiQuery = async (query) =>
      query === "pkg-3" ? null : defaultQuery(query);
    const result = await runScenarios(harness);

    expect(entryOf(result, "file-search-engine")).toBeUndefined();
    expect(entryOf(result, "quickopen-ui")).toBeUndefined();

    for (const id of ["file-search-engine", "quickopen-ui"]) {
      const status = result.scenarioStatuses.find((entry) => entry.id === id);
      expect(status.status).toBe("not-run");
      expect(status.reason).toContain("pkg-3");
    }

    const shaped = shapeRunResult({
      capturedAt: "2026-08-03T00:00:00.000Z",
      ...result,
      fixtureVersion: FIXTURE_VERSION,
    });
    const failures = evaluateRunOutcome({ result, shaped, smoke: false });
    expect(failures.some((failure) => failure.includes("file-search-engine"))).toBe(true);
  });

  it("reports LSP scenarios not-run when readiness never produces a large completion list", async () => {
    const harness = createHarness({ completionResultCount: 10 });
    vi.useFakeTimers();

    try {
      const pending = runScenarios(harness, { intervalMs: 100 });
      await vi.advanceTimersByTimeAsync(200_000);
      const result = await pending;

      for (const id of LSP_TRACKER_SCENARIO_IDS) {
        const status = result.scenarioStatuses.find((entry) => entry.id === id);
        expect(status.status).toBe("not-run");
        expect(status.reason).toContain("never proven ready");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports no-result when the fixture lacks ten *Kind declarations with field usages", async () => {
    const harness = createHarness({ source: buildLspSource(4) });
    const result = await runScenarios(harness);

    for (const id of ["definition-medium-2k", "references-medium-2k", "rename-medium-2k"]) {
      const status = result.scenarioStatuses.find((entry) => entry.id === id);
      expect(status.status).toBe("no-result");
      expect(status.reason).toContain("4 of the required 10");
    }
  });

  it("fails fast with an actionable error when the measurement window is hidden", async () => {
    const harness = createHarness();
    const previousDocument = globalThis.document;
    globalThis.document = { visibilityState: "hidden" };

    try {
      await expect(runScenarios(harness)).rejects.toThrow(/window is hidden/);
      await expect(runScenarios(harness)).rejects.toThrow(/requestAnimationFrame/);
    } finally {
      globalThis.document = previousDocument;
    }
  });

  it("annotates settlement timeouts with rAF liveness and visibility diagnostics", () => {
    const source = inPagePerfRunnerSource();
    expect(source).toContain("assertMeasurementWindowVisible");
    expect(source).toContain("rAF frames during wait=");
    expect(source).toContain("visibilityDiagnostics");
    expect(source).toContain("caffeinate -du");
  });

  it("embeds the contract constants into the runner source", () => {
    const source = inPagePerfRunnerSource();
    expect(source).toContain(JSON.stringify(KIND_TARGET_PATTERN_SOURCE));
    expect(source).toContain(JSON.stringify(TYPING_PROBE_TEXT));
    expect(source).toContain(JSON.stringify(FILE_SEARCH_QUERIES));
    expect(source).toContain('"tab-switch-rendered"');
    expect(source).toContain('"provider-ui-ready"');
    expect(source).toContain('"typing-dispatch"');
    expect(source).toContain('"typing-frame"');
    expect(source).toContain('"quickopen-ui"');
    expect(source).toContain("runTypingScenario");
    expect(source).toContain("runQuickOpenUiQuery");
    expect(source).toContain("getProviderProbeSamples");
  });

  it("emits the tab-switch measurement window, floor, and switch order with the samples", () => {
    const source = inPagePerfRunnerSource();
    expect(source).toContain(JSON.stringify(TAB_SWITCH_WINDOW_NOTE));
    expect(source).toContain("windowNote: TAB_SWITCH_WINDOW_NOTE");
    expect(source).toContain("frameSettleFloorMs: TAB_SWITCH_FRAME_SETTLE_FLOOR_MS");
    expect(source).toContain("switchPaths: [...switchPaths]");
    expect(source).toContain("previousSwitchPath:");
  });

  it("opens no monorepo tabs before the quick open measurements", () => {
    const source = inPagePerfRunnerSource();
    expect(source).not.toContain("open monorepo fixture tabs");
    expect(source).not.toContain("deepPaths");
  });

  it("records paths that openWorkspaceFile refuses to open", () => {
    const source = inPagePerfRunnerSource();
    expect(source).toContain("failedPaths.push(path)");
    expect(source).toContain("attempt < 3");
    expect(source).toContain("bridge.openWorkspaceFile(path)");
    expect(source.match(/\.openWorkspaceFile\(/g)).toHaveLength(1);
  });

  it("puts a wall-clock deadline around workspace-file and frame-driven bridge operations", () => {
    const source = inPagePerfRunnerSource();
    expect(source).toContain("const FILE_OPEN_ATTEMPT_TIMEOUT_MS = 15000");
    expect(source).toContain("const BRIDGE_OPERATION_TIMEOUT_MS = 30000");
    expect(source).toContain("async function withinDeadline(");
    expect(source).toContain("Promise.race([");
    expect(source).toContain("perf.runTypingScenario");
    expect(source).toContain("perf.measureTabSwitches");
    expect(source).toContain("perf.runReferencesProbe");
    expect(source).toContain("perf.runRenameProbe");
    expect(source).toContain("monorepoPerf.runQuickOpenUiQuery");
  });

  it("targets the smart-capable medium fixture for the LSP latency scenarios", () => {
    const source = inPagePerfRunnerSource();
    expect(source).toContain(LSP_TRACKER_FIXTURE_FILE);
  });

  it("waits for a proven-ready completion list before measuring, instead of a fixed sleep", () => {
    const source = inPagePerfRunnerSource();
    expect(source).toContain("waitForLanguageServerReadiness");
    expect(source).toContain("READINESS_TIMEOUT_MS");
    expect(source).toContain("READINESS_MIN_COMPLETION_ITEMS = 1000");
    expect(source).not.toContain("await sleep(200)");
  });

  it("asks the app whether the large fixture is policy-disabled instead of assuming it", () => {
    const source = inPagePerfRunnerSource();
    expect(source).toContain("getLargeSmartDocumentStatus");
    expect(source).toContain(POLICY_DISABLED_FIXTURE_FILE);
    expect(source).toContain(POLICY_DISABLED_REASON);
  });

  it("fails fast and reports progress when a workspace root cannot be opened", () => {
    const source = inPagePerfRunnerSource();
    expect(source).toContain('reportProgress("open large-files workspace")');
    expect(source).toContain('reportProgress("open monorepo workspace")');
    expect(source).toContain("const largeFilesRootOpened = await ensureWorkspaceRoot(");
    expect(source).toContain("const monorepoRootOpened = await ensureWorkspaceRoot(");
    expect(source).toContain("async function ensureWorkspaceRoot(");
    expect(source).toContain("const currentBridge = () => window.__codevoQa ?? bridge");
    expect(source).toContain("if (!largeFilesRootOpened)");
    expect(source).toContain("if (!monorepoRootOpened)");
    expect(source).toContain("window.__codevoPerfProgress = { stage");
  });

  it("reports every long-running phase instead of remaining silent until the workspace switch", () => {
    const source = inPagePerfRunnerSource();
    for (const stage of [
      "typing ",
      "open large-file tabs",
      "measure large-file tab switches",
      "inspect large-document policy",
      "prepare JS/TS language server",
      "wait for JS/TS language server",
      "measure completion-bounded latency",
      "measure completion-unbounded latency",
      "measure definition latency",
      "measure references latency",
      "measure rename latency",
      "warm up quick open: ",
      "measure quick open: ",
      "collect performance result",
      "open file: ",
    ]) {
      expect(source).toContain(stage);
    }
  });
});

describe("tab-switch measurement window notes", () => {
  it("describes Codevo's asserted two-frame settlement window and its floor", () => {
    expect(TAB_SWITCH_FRAME_SETTLE_FLOOR_MS).toBe(33);
    expect(TAB_SWITCH_WINDOW_NOTE).toContain("requestAnimationFrame");
    expect(TAB_SWITCH_WINDOW_NOTE).toContain("asserted active");
    expect(TAB_SWITCH_WINDOW_NOTE).toContain(String(TAB_SWITCH_FRAME_SETTLE_FLOOR_MS));
    expect(TAB_SWITCH_WINDOW_NOTE).not.toBe(VSCODE_TAB_SWITCH_WINDOW_NOTE);
  });

  it("carries the VS Code baseline note inside the baseline extension itself", () => {
    const extensionPath = fileURLToPath(
      new URL("../../tools/vscode-baseline/extension.js", import.meta.url),
    );
    const source = readFileSync(extensionPath, "utf8");
    expect(source).toContain(VSCODE_TAB_SWITCH_WINDOW_NOTE);
    expect(source).toContain("windowNote");
    expect(source).toContain("TAB_SWITCH_WINDOW_NOTE");
  });
});

describe("summarizeTabSwitchPairs", () => {
  const cycle = ["/r/a.ts", "/r/b.ts", "/r/c.ts"];

  it("returns nothing for empty samples", () => {
    expect(summarizeTabSwitchPairs(cycle, [], "/r/c.ts")).toEqual([]);
    expect(summarizeTabSwitchPairs([], [1, 2], "/r/c.ts")).toEqual([]);
  });

  it("fails closed on non-array inputs", () => {
    expect(summarizeTabSwitchPairs(null, [1], "/r/c.ts")).toEqual([]);
    expect(summarizeTabSwitchPairs(cycle, null, "/r/c.ts")).toEqual([]);
  });

  it("bounds the pairing to the shorter of paths and samples", () => {
    expect(summarizeTabSwitchPairs(cycle, [5], "/r/c.ts")).toEqual([
      { fromBasename: "c.ts", toBasename: "a.ts", count: 1, p50: 5, p95: 5 },
    ]);
    expect(summarizeTabSwitchPairs(["/r/a.ts"], [5, 6, 7], "/r/c.ts")).toEqual([
      { fromBasename: "c.ts", toBasename: "a.ts", count: 1, p50: 5, p95: 5 },
    ]);
  });

  it("aggregates two cycles into one entry per pair with exact percentiles", () => {
    const paths = [...cycle, ...cycle];
    const samples = [10, 20, 30, 12, 26, 34];
    expect(summarizeTabSwitchPairs(paths, samples, "/r/c.ts")).toEqual([
      { fromBasename: "c.ts", toBasename: "a.ts", count: 2, p50: 11, p95: 12 },
      { fromBasename: "a.ts", toBasename: "b.ts", count: 2, p50: 23, p95: 26 },
      { fromBasename: "b.ts", toBasename: "c.ts", count: 2, p50: 32, p95: 34 },
    ]);
  });

  it("keeps first-appearance ordering stable regardless of durations", () => {
    const paths = [...cycle, ...cycle];
    const fast = summarizeTabSwitchPairs(paths, [1, 2, 3, 4, 5, 6], "/r/c.ts");
    const slow = summarizeTabSwitchPairs(paths, [600, 500, 400, 300, 200, 100], "/r/c.ts");
    expect(fast.map((pair) => `${pair.fromBasename}->${pair.toBasename}`)).toEqual([
      "c.ts->a.ts",
      "a.ts->b.ts",
      "b.ts->c.ts",
    ]);
    expect(slow.map((pair) => `${pair.fromBasename}->${pair.toBasename}`)).toEqual(
      fast.map((pair) => `${pair.fromBasename}->${pair.toBasename}`),
    );
  });

  it("reports an unknown predecessor instead of inventing one", () => {
    expect(summarizeTabSwitchPairs(["/r/a.ts"], [9], undefined)).toEqual([
      { fromBasename: null, toBasename: "a.ts", count: 1, p50: 9, p95: 9 },
    ]);
  });
});

describe("PERF_SCENARIOS", () => {
  it("has unique ids", () => {
    const ids = PERF_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("registers the canonical contract scenario order", () => {
    expect(PERF_SCENARIOS.map((s) => s.id)).toEqual([
      "tab-switch-cycle",
      "typing-large-5k",
      "typing-large-5k-frame",
      "typing-large-20k",
      "typing-large-20k-frame",
      "typing-large-100k",
      "typing-large-100k-frame",
      "completion-bounded",
      "completion-unbounded",
      "definition-medium-2k",
      "references-medium-2k",
      "rename-medium-2k",
      "completion-large-20k",
      "definition-large-20k",
      "references-large-20k",
      "rename-large-20k",
      "file-search-engine",
      "quickopen-ui",
      "memory-sample",
    ]);
  });

  it("declares the contract cut points on every measured scenario", () => {
    const cutPointById = new Map(
      PERF_SCENARIOS.filter((s) => s.kind === "bridge").map((s) => [s.id, s.cutPoint]),
    );
    expect(cutPointById.get("tab-switch-cycle")).toBe(CUT_POINTS.TAB_SWITCH_RENDERED);
    expect(cutPointById.get("typing-large-5k")).toBe(CUT_POINTS.TYPING_DISPATCH);
    expect(cutPointById.get("typing-large-5k-frame")).toBe(CUT_POINTS.TYPING_FRAME);
    expect(cutPointById.get("completion-bounded")).toBe(CUT_POINTS.PROVIDER_UI_READY);
    expect(cutPointById.get("completion-unbounded")).toBe(CUT_POINTS.PROVIDER_UI_READY);
    expect(cutPointById.get("definition-medium-2k")).toBe(CUT_POINTS.PROVIDER_UI_READY);
    expect(cutPointById.get("references-medium-2k")).toBe(CUT_POINTS.PROVIDER_UI_READY);
    expect(cutPointById.get("rename-medium-2k")).toBe(CUT_POINTS.PROVIDER_UI_READY);
    expect(cutPointById.get("file-search-engine")).toBe(CUT_POINTS.FILE_SEARCH_ENGINE);
    expect(cutPointById.get("quickopen-ui")).toBe(CUT_POINTS.QUICKOPEN_UI);
  });

  it("lists the five medium-fixture LSP scenarios under the contract ids", () => {
    expect(LSP_TRACKER_SCENARIO_IDS).toEqual([
      "completion-bounded",
      "completion-unbounded",
      "definition-medium-2k",
      "references-medium-2k",
      "rename-medium-2k",
    ]);
  });

  it("keeps the large-20k LSP targets as explicit capability rows", () => {
    const capabilityIds = PERF_SCENARIOS.filter((s) => s.kind === "capability").map((s) => s.id);
    expect(capabilityIds).toEqual([
      "completion-large-20k",
      "definition-large-20k",
      "references-large-20k",
      "rename-large-20k",
    ]);
    expect(CAPABILITY_SCENARIO_IDS).toEqual(capabilityIds);
  });
});
