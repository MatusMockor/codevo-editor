#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shapeRunResult, FIXTURE_VERSION } from "./perfScenarios.mjs";
import {
  buildRunnerOptions,
  buildSnippetExpression,
  evaluateRunOutcome,
  parseManualResult,
  resultFileName,
  scenarioSummary,
} from "./runPerfScenariosCli.mjs";

const DEFAULT_CDP_URL = "http://127.0.0.1:9222";
const DEFAULT_TARGET_URL = "localhost:1420";
const CONNECTION_GUIDANCE =
  "CDP is unavailable on macOS WKWebView (it works against WebView2 on Windows). On macOS, use the " +
  "manual lane instead: run VITE_CODEVO_QA_BRIDGE=1 VITE_CODEVO_PERF_BRIDGE=1 npm run debug:tauri " +
  "(a dev build - npm run debug:qa is a production bundle where the DEV-gated bridges never install), " +
  "open Tauri WebView DevTools, and paste the snippet from --print-snippet into the console, then save " +
  "the resulting JSON and run --from-json <path> (same pattern as docs/DEV_QA.md's manual lane).";
const PRINT_SNIPPET_INSTRUCTION =
  "Launch: VITE_CODEVO_QA_BRIDGE=1 VITE_CODEVO_PERF_BRIDGE=1 npm run debug:tauri -> open Tauri WebView " +
  "DevTools console -> paste the snippet below -> copy the JSON value it returns.";
const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "../..");

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.printSnippet) {
    printSnippetCommand(args.smoke);
    return;
  }

  if (args.fromJsonPath) {
    const result = await readManualResultFile(args.fromJsonPath);
    await finishRun(result, args.smoke);
    return;
  }

  const options = buildRunnerOptions({ smoke: args.smoke, repoRoot });
  const result = await runWithCdp(args, options);
  await finishRun(result, args.smoke);
}

function printSnippetCommand(smoke) {
  const options = buildRunnerOptions({ smoke, repoRoot });
  console.error(PRINT_SNIPPET_INSTRUCTION);
  console.log(buildSnippetExpression(options));
}

async function readManualResultFile(filePath) {
  let raw;

  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read --from-json file "${filePath}": ${detail}`);
  }

  return parseManualResult(raw);
}

async function finishRun(result, smoke) {
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
  const resultPath = path.join(resultsDirectory, resultFileName(capturedAt));

  await mkdir(resultsDirectory, { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(shaped, null, 2)}\n`, "utf8");
  printSummary(shaped, result.trackerSnapshot);
  console.log(`Wrote ${resultPath}`);

  const failures = evaluateRunOutcome({ result, shaped, smoke });

  for (const failure of failures) {
    console.error(failure);
  }

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

function parseArgs(args) {
  const options = {
    cdpUrl: process.env.CODEVO_EDITOR_QA_CDP_URL || DEFAULT_CDP_URL,
    targetUrl: process.env.CODEVO_EDITOR_QA_TARGET_URL || DEFAULT_TARGET_URL,
    smoke: false,
    printSnippet: false,
    fromJsonPath: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--smoke") {
      options.smoke = true;
      continue;
    }

    if (arg === "--print-snippet") {
      options.printSnippet = true;
      continue;
    }

    if (arg === "--from-json") {
      options.fromJsonPath = requiredValue(args, index, arg);
      index += 1;
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

  if (options.printSnippet && options.fromJsonPath) {
    throw new Error("Use --print-snippet or --from-json, not both.");
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
    const expression = buildSnippetExpression(options);
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
