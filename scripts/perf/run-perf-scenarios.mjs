#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inPagePerfRunnerSource, shapeRunResult } from "./perfScenarios.mjs";

const DEFAULT_CDP_URL = "http://127.0.0.1:9222";
const DEFAULT_TARGET_URL = "localhost:1420";
const DEFAULT_WAIT_MS = 10000;
const DEFAULT_INTERVAL_MS = 100;
const FIXTURE_VERSION = "large-files@seed5/20/100, monorepo@50pkg";
const CONNECTION_GUIDANCE =
  "Start the app with: npm run debug:qa (QA bridge) and VITE_CODEVO_PERF_BRIDGE=1, plus remote debugging port 9222";
const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "../..");

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const options = {
    smoke: args.smoke,
    largeFilesRoot: path.join(repoRoot, "perf/fixtures/large-files"),
    monorepoRoot: path.join(repoRoot, "perf/fixtures/monorepo"),
    fixtureVersion: FIXTURE_VERSION,
    waitMs: DEFAULT_WAIT_MS,
    intervalMs: DEFAULT_INTERVAL_MS,
  };
  const result = await runWithCdp(args, options);

  if (args.smoke) {
    validateSmokeResult(result);
  }

  const capturedAt = new Date().toISOString();
  const shaped = shapeRunResult({
    capturedAt,
    bridgeResults: result.bridgeResults,
    trackerSnapshot: result.trackerSnapshot,
    retainedCounts: result.retainedCounts ?? null,
    memorySample: result.memorySample ?? null,
    failedPaths: result.failedPaths ?? [],
    fixtureVersion: FIXTURE_VERSION,
  });
  const resultsDirectory = path.join(repoRoot, "perf/results");
  const resultPath = path.join(resultsDirectory, `codevo-${capturedAt.replace(/[:.]/g, "-")}.json`);

  await mkdir(resultsDirectory, { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(shaped, null, 2)}\n`, "utf8");
  printSummary(shaped, result.trackerSnapshot);
  console.log(`Wrote ${resultPath}`);

  if (shaped.failedPaths.length > 0) {
    console.error(
      `Performance run failed: ${shaped.failedPaths.length} fixture path(s) could not be opened:`,
    );

    for (const failedPath of shaped.failedPaths) {
      console.error(`  ${failedPath}`);
    }

    process.exitCode = 1;
  }

  if (hasEmptyNonSkippedScenario(shaped, result.trackerSnapshot, args.smoke)) {
    console.error("Performance run failed: one or more non-skipped scenarios have zero samples.");
    process.exitCode = 1;
  }
}

function parseArgs(args) {
  const options = {
    cdpUrl: process.env.CODEVO_EDITOR_QA_CDP_URL || DEFAULT_CDP_URL,
    targetUrl: process.env.CODEVO_EDITOR_QA_TARGET_URL || DEFAULT_TARGET_URL,
    smoke: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--smoke") {
      options.smoke = true;
      continue;
    }

    if (arg === "--cdp-url") {
      options.cdpUrl = requiredValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--target-url") {
      options.targetUrl = requiredValue(args, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown option "${arg}".`);
  }

  return options;
}

function requiredValue(args, index, flag) {
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }

  return value;
}

async function runWithCdp(args, options) {
  let client;

  try {
    assertWebSocketAvailable();
    const targets = await cdpTargets(args.cdpUrl);
    const target = selectCdpTarget(targets, args.targetUrl);

    if (!target.webSocketDebuggerUrl) {
      throw new Error(`CDP target "${target.title ?? target.url}" has no webSocketDebuggerUrl.`);
    }

    client = await CdpClient.connect(target.webSocketDebuggerUrl);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${detail}\n${CONNECTION_GUIDANCE}`);
  }

  try {
    const expression = `(${inPagePerfRunnerSource()})(${JSON.stringify(options)})`;
    const response = await client.send("Runtime.evaluate", {
      awaitPromise: true,
      expression,
      returnByValue: true,
    });

    if (response.exceptionDetails) {
      throw new Error(formatCdpException(response.exceptionDetails));
    }

    return response.result?.value;
  } finally {
    client.close();
  }
}

function assertWebSocketAvailable() {
  if (typeof WebSocket === "function") {
    return;
  }

  throw new Error("This Node runtime does not expose global WebSocket.");
}

async function cdpTargets(cdpUrl) {
  const endpoint = new URL("/json/list", normalizedCdpUrl(cdpUrl));
  const response = await fetch(endpoint);

  if (!response.ok) {
    throw new Error(`Failed to read ${endpoint}: HTTP ${response.status}.`);
  }

  return await response.json();
}

function normalizedCdpUrl(value) {
  if (/^https?:\/\//.test(value)) {
    return value;
  }

  return `http://${value}`;
}

function selectCdpTarget(targets, targetUrl) {
  const pages = targets.filter((target) => target.type === "page");

  if (pages.length === 0) {
    throw new Error("No CDP page targets found. Make sure the app window is open.");
  }

  if (!targetUrl) {
    return pages[0];
  }

  const match = pages.find((target) => target.url.includes(targetUrl));

  if (match) {
    return match;
  }

  throw new Error(`No CDP page URL contains "${targetUrl}".`);
}

function formatCdpException(exceptionDetails) {
  const description = exceptionDetails.exception?.description;

  if (description) {
    return description;
  }

  return exceptionDetails.text || "Runtime.evaluate failed.";
}

function validateSmokeResult(result) {
  const typing = result.bridgeResults.find(({ id }) => id === "typing-large-5k");
  const tabSwitch = result.bridgeResults.find(({ id }) => id === "tab-switch-cycle");
  const hasBridgeSamples = typing?.samples.length >= 1 && tabSwitch?.samples.length >= 1;
  const hasEditor = result.retainedCounts?.editors >= 1;

  if (hasBridgeSamples && hasEditor) {
    return;
  }

  console.error(
    "Performance smoke failed: typing-large-5k and tab-switch-cycle need samples, and retainedCounts.editors must be at least 1.",
  );
  process.exitCode = 1;
}

function printSummary(shaped, trackerSnapshot) {
  console.table(
    shaped.scenarios.map((scenario) => ({
      id: scenario.id,
      p50: scenario.p50 ?? "-",
      p95: scenario.p95 ?? "-",
      samples: scenarioSummary(scenario, trackerSnapshot),
    })),
  );
}

function scenarioSummary(scenario, trackerSnapshot) {
  if (scenario.status === "skipped") {
    return `skipped: ${scenario.reason}`;
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

function memorySampleSummary(scenario) {
  const models = scenario.retainedCounts?.models ?? "-";
  const editors = scenario.retainedCounts?.editors ?? "-";
  const heap = scenario.memorySample?.usedJsHeapBytes ?? "unavailable";

  return `models ${models}, editors ${editors}, heap ${heap}`;
}

function hasEmptyNonSkippedScenario(shaped, trackerSnapshot, smoke) {
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

    return scenarioSummary(scenario, trackerSnapshot) === 0;
  });
}

class CdpClient {
  constructor(socket) {
    this.callbacks = new Map();
    this.nextId = 1;
    this.socket = socket;

    socket.addEventListener("message", (event) => {
      this.handleMessage(event.data);
    });
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);

      socket.addEventListener(
        "open",
        () => {
          resolve(new CdpClient(socket));
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          reject(new Error(`Failed to connect to ${url}.`));
        },
        { once: true },
      );
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    const message = JSON.stringify({ id, method, params });

    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { reject, resolve });
      this.socket.send(message);
    });
  }

  close() {
    this.socket.close();
  }

  handleMessage(data) {
    const payload = JSON.parse(data);

    if (!payload.id) {
      return;
    }

    const callback = this.callbacks.get(payload.id);

    if (!callback) {
      return;
    }

    this.callbacks.delete(payload.id);

    if (payload.error) {
      callback.reject(new Error(payload.error.message));
      return;
    }

    callback.resolve(payload.result);
  }
}
