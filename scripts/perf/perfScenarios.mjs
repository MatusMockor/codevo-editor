export const PERF_SCENARIOS = [
  { id: "typing-large-5k", kind: "bridge", run: "typing-large-5k" },
  { id: "typing-large-20k", kind: "bridge", run: "typing-large-20k" },
  { id: "typing-large-100k", kind: "bridge", run: "typing-large-100k" },
  { id: "tab-switch-cycle", kind: "bridge", run: "tab-switch-cycle" },
  { id: "completion-large-20k", kind: "tracker", run: "completion" },
  { id: "definition-large-20k", kind: "tracker", run: "definition" },
  { id: "references-large-20k", kind: "tracker", run: "references" },
  { id: "rename-large-20k", kind: "tracker", run: "rename" },
  { id: "quickopen-monorepo", kind: "tracker", run: "quickOpen" },
  { id: "memory-sample", kind: "bridge", run: "memory-sample" },
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

export function shapeRunResult({
  capturedAt,
  bridgeResults = [],
  trackerSnapshot = [],
  fixtureVersion,
}) {
  const bridgeScenarios = bridgeResults.map(({ id, samples }) => ({
    id,
    unit: "ms",
    samples,
    ...percentilesFromSamples(samples),
  }));
  const trackerScenarios = PERF_SCENARIOS.filter(({ kind }) => kind === "tracker").map(
    (scenario) => {
      const snapshot = trackerSnapshot.find(({ kind }) => kind === scenario.run);

      if (snapshot) {
        return {
          id: scenario.id,
          unit: "ms",
          trackerKind: snapshot.kind,
          p50: snapshot.stats.median,
          p95: snapshot.stats.p95,
        };
      }

      if (scenario.id === "rename-large-20k") {
        return {
          id: scenario.id,
          unit: "ms",
          status: "skipped",
          reason: "Rename produced no latency tracker data.",
        };
      }

      return { id: scenario.id, unit: "ms", samples: [], p50: 0, p95: 0 };
    },
  );

  return {
    capturedAt,
    fixtureVersion,
    scenarios: [...bridgeScenarios, ...trackerScenarios],
  };
}

export function inPagePerfRunnerSource() {
  return String.raw`async function runCodevoPerfScenarios(options) {
  const waitMs = options.waitMs;
  const intervalMs = options.intervalMs;
  const initialQa = await waitFor(() => window.__codevoQa, waitMs, intervalMs);

  if (!initialQa) {
    throw bridgeError();
  }

  await initialQa.openWorkspaceRoot(options.largeFilesRoot);

  const largeFileBridges = await waitForBridges(waitMs, intervalMs);
  const qa = largeFileBridges.qa;
  const perf = largeFileBridges.perf;
  const bridgeResults = [];
  const trackerSnapshot = [];
  const largeFileNames = ["large-5k.ts", "large-20k.ts", "large-100k.ts", "minified.ts", "huge-union.ts"];
  const largeFilePaths = largeFileNames.map((name) => joinPath(options.largeFilesRoot, name));
  const typingScenarios = [
    { id: "typing-large-5k", path: largeFilePaths[0] },
    { id: "typing-large-20k", path: largeFilePaths[1] },
    { id: "typing-large-100k", path: largeFilePaths[2] },
  ];
  const selectedTypingScenarios = options.smoke ? typingScenarios.slice(0, 1) : typingScenarios;

  for (const scenario of selectedTypingScenarios) {
    await qa.openWorkspaceFile(scenario.path);
    setMidFileCursor(qa);
    perf.clearLatencyMetrics();
    const samples = [];
    const repetitions = options.smoke ? 1 : 5;

    for (let index = 0; index < repetitions; index += 1) {
      samples.push(...await perf.typeTextInActiveEditor("const perfProbe = 1;\n"));
    }

    bridgeResults.push({ id: scenario.id, samples });
  }

  for (const path of largeFilePaths) {
    await qa.openWorkspaceFile(path);
  }

  const switchPaths = [];
  const switchCycles = options.smoke ? 1 : 6;

  for (let cycle = 0; cycle < switchCycles; cycle += 1) {
    switchPaths.push(...largeFilePaths);
  }

  bridgeResults.push({
    id: "tab-switch-cycle",
    samples: [...await perf.measureTabSwitches(switchPaths)],
  });

  if (options.smoke) {
    return {
      bridgeResults,
      trackerSnapshot: [],
      retainedCounts: perf.getRetainedCounts(),
      memorySample: null,
    };
  }

  await qa.openWorkspaceFile(largeFilePaths[1]);
  setIdentifierCursor(qa);
  perf.clearLatencyMetrics();

  for (let index = 0; index < 10; index += 1) {
    qa.triggerCompletion();
    await qa.triggerDefinition();
    await sleep(200);
  }

  captureTrackerKinds(perf, trackerSnapshot, ["completion", "definition"]);

  for (let index = 0; index < 5; index += 1) {
    await perf.runEditorAction("editor.action.referenceSearch.trigger");
    await sleep(200);
  }

  captureTrackerKinds(perf, trackerSnapshot, ["references"]);
  await perf.runEditorAction("editor.action.rename");
  await sleep(200);
  captureTrackerKinds(perf, trackerSnapshot, ["rename"], true);

  await qa.openWorkspaceRoot(options.monorepoRoot);
  const monorepoBridges = await waitForBridges(waitMs, intervalMs);
  const monorepoQa = monorepoBridges.qa;
  const monorepoPerf = monorepoBridges.perf;
  monorepoPerf.clearLatencyMetrics();
  const deepPaths = [1, 6, 12, 18, 24, 30, 35, 40, 45, 50].map((packageNumber, index) => {
    const packageLabel = String(packageNumber).padStart(2, "0");
    const fileLabel = String(index + 1).padStart(3, "0");
    return joinPath(options.monorepoRoot, "packages/pkg-" + packageLabel + "/src/extra/file-" + fileLabel + ".ts");
  });

  for (const path of deepPaths) {
    await monorepoQa.openWorkspaceFile(path);
  }

  captureTrackerKinds(monorepoPerf, trackerSnapshot, ["quickOpen"]);

  return {
    bridgeResults,
    trackerSnapshot,
    retainedCounts: monorepoPerf.getRetainedCounts(),
    memorySample: monorepoPerf.getMemorySample(),
  };

  function setMidFileCursor(bridge) {
    const source = bridge.getValue() || "";
    const lines = source.split("\n");
    const lineNumber = Math.max(1, Math.floor(lines.length / 2));
    const line = lines[lineNumber - 1] || "";
    bridge.setCursor({ lineNumber, column: line.length + 1 });
  }

  function setIdentifierCursor(bridge) {
    const source = bridge.getValue() || "";
    const match = /[A-Za-z_$][\w$]*/.exec(source);

    if (!match) {
      setMidFileCursor(bridge);
      return;
    }

    const prefix = source.slice(0, match.index + Math.max(1, Math.floor(match[0].length / 2)));
    const lines = prefix.split("\n");
    bridge.setCursor({ lineNumber: lines.length, column: lines[lines.length - 1].length + 1 });
  }

  function captureTrackerKinds(bridge, destination, kinds, requireCount) {
    const snapshot = bridge.getLatencySnapshot();

    for (const entry of snapshot) {
      if (!kinds.includes(entry.kind)) {
        continue;
      }

      if (requireCount && entry.stats.count <= 0) {
        continue;
      }

      const existingIndex = destination.findIndex(({ kind }) => kind === entry.kind);

      if (existingIndex >= 0) {
        destination.splice(existingIndex, 1, entry);
        continue;
      }

      destination.push(entry);
    }
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

  function bridgeError() {
    return new Error("Codevo QA/performance bridges are unavailable. Start with npm run debug:qa and VITE_CODEVO_PERF_BRIDGE=1.");
  }

  function joinPath(root, relativePath) {
    return String(root).replace(/[\\/]+$/, "") + "/" + relativePath;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}`;
}
