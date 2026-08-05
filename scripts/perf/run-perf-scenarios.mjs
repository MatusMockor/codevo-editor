#!/usr/bin/env node

import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { link, mkdir, open, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shapeRunResult, FIXTURE_VERSION } from "./perfScenarios.mjs";
import { MAX_CAPTURE_JSON_BYTES, parseCaptureRunJson } from "./perfCaptureContract.mjs";
import { computeFixtureHashes, fixtureHashFenceFailure } from "./fixtureHash.mjs";
import {
  buildRunnerOptions,
  buildSnippetExpression,
  capturedAtForImportedResult,
  environmentWarning,
  evaluateRunOutcome,
  parseManualResult,
  resultFileName,
  scenarioSummary,
} from "./runPerfScenariosCli.mjs";
import {
  DEFAULT_AUTORUN_TIMEOUT_MS,
  DEV_SERVER_PORT,
  assertPortFree,
  parseAutorunTimeoutMs,
  runAutorunLane,
} from "./perfAutorunDriver.mjs";
import {
  DEFAULT_PRODUCTION_BUILD_TIMEOUT_MS,
  DEFAULT_PRODUCTION_RUN_TIMEOUT_MS,
  DEFAULT_PRODUCTION_SMOKE_TIMEOUT_MS,
  MAX_PRODUCTION_BUILD_TIMEOUT_MS,
  MAX_PRODUCTION_RUN_TIMEOUT_MS,
  parseProductionTimeoutMs,
  runProductionCaptureLane,
} from "./perfProductionDriver.mjs";

const DEFAULT_CDP_URL = "http://127.0.0.1:9222";
const DEFAULT_TARGET_URL = "localhost:1420";
const CONNECTION_GUIDANCE =
  "CDP is unavailable on macOS WKWebView (it works against WebView2 on Windows). On macOS, use the " +
  "manual lane instead: run VITE_CODEVO_QA_BRIDGE=1 VITE_CODEVO_PERF_BRIDGE=1 npm run debug:tauri " +
  "(a dev build - npm run debug:qa is a production bundle where the DEV-gated bridges never install), " +
  "open Tauri WebView DevTools, and paste the snippet from --print-snippet into the console, then save " +
  "the resulting JSON and run --from-json <path> (same pattern as docs/DEV_QA.md's manual lane).";
const AUTORUN_START_NOTICE =
  "Autorun lane: starting a dev app (VITE_CODEVO_QA_BRIDGE=1 VITE_CODEVO_PERF_BRIDGE=1 " +
  "VITE_CODEVO_PERF_AUTORUN=1 npm run debug:tauri) and waiting for it to post its perf result. " +
  "A cold cargo build can take many minutes; the app is shut down automatically when the run ends.";
const PRODUCTION_START_NOTICE =
  "Production lane: building a one-run instrumented release app in isolated temporary directories, " +
  "launching that exact artifact against an immutable fixture snapshot, and removing both afterward.";
const PRINT_SNIPPET_INSTRUCTION =
  "Launch: VITE_CODEVO_QA_BRIDGE=1 VITE_CODEVO_PERF_BRIDGE=1 npm run debug:tauri -> open Tauri WebView " +
  "DevTools console -> paste the snippet below -> copy the JSON value it returns.";
const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "../..");

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

async function main() {
  const args = parseRunPerfArgs(process.argv.slice(2));

  if (args.printSnippet) {
    printSnippetCommand(args.smoke);
    return;
  }

  if (args.fromJsonPath) {
    const result = await readManualResultFile(args.fromJsonPath);
    await finishRun(result, args.smoke, null, { importedCapture: true });
    return;
  }

  if (args.autorun) {
    await runAutorun(args);
    return;
  }

  if (args.production) {
    await runProduction(args);
    return;
  }

  const options = buildRunnerOptions({ smoke: args.smoke, repoRoot });
  const fixtureHashesBefore = fixtureHashesForRun();
  const outcome = await runWithCdp(args, options);
  await finishRun(outcome.result, args.smoke, fixtureHashesBefore);
}

async function runProduction(args) {
  const fixtureHashesBefore = fixtureHashesForRun();
  console.error(PRODUCTION_START_NOTICE);
  const abortAuthority = createProductionAbortAuthority();
  let outcome;
  try {
    outcome = await runProductionCaptureLane({
      repoRoot,
      smoke: args.smoke,
      buildTimeoutMs: args.productionBuildTimeoutMs,
      runTimeoutMs: args.productionRunTimeoutMs,
      signal: abortAuthority.signal,
      onProcessOwned: abortAuthority.ownProcess,
    });
  } finally {
    abortAuthority.dispose();
  }
  if (outcome.status === "failed") {
    console.error(outcome.message);
    if (process.exitCode !== 130 && process.exitCode !== 143) process.exitCode = 1;
    return;
  }
  await finishRun(outcome.result, args.smoke, fixtureHashesBefore, {
    environmentMetadata: outcome.captureEnvironment,
    persistOnlyOnSuccess: true,
  });
}

export function createProductionAbortAuthority(processTarget = process) {
  const controller = new AbortController();
  const ownedProcesses = new Set();
  const interruptErrors = [];
  const cancel = (exitCode) => {
    if (controller.signal.aborted) return;
    processTarget.exitCode = exitCode;
    for (const processHandle of ownedProcesses) {
      try {
        processHandle.interrupt?.();
      } catch (error) {
        interruptErrors.push(error instanceof Error ? error.message : String(error));
      }
    }
    controller.abort();
  };
  const handlers = new Map([
    ["SIGINT", () => cancel(130)],
    ["SIGTERM", () => cancel(143)],
  ]);
  let disposed = false;
  for (const [signal, handler] of handlers) processTarget.on(signal, handler);
  return {
    signal: controller.signal,
    interruptErrors,
    ownProcess(processHandle) {
      ownedProcesses.add(processHandle);
      if (controller.signal.aborted) processHandle.interrupt?.();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [signal, handler] of handlers) processTarget.removeListener(signal, handler);
      ownedProcesses.clear();
    },
  };
}

async function runAutorun(args) {
  const fixtureHashesBefore = fixtureHashesForRun();
  await assertPortFree(DEV_SERVER_PORT);
  console.error(AUTORUN_START_NOTICE);
  const outcome = await runAutorunLane({
    smoke: args.smoke,
    diagnosticElevation: args.diagnosticElevation,
    timeoutMs: args.autorunTimeoutMs,
    repoRoot,
  });

  if (outcome.status === "failed") {
    console.error(outcome.message);
    process.exitCode = 1;
    return;
  }

  await finishRun(outcome.result, args.smoke, fixtureHashesBefore, { attachLocalHost: true });
}

function printSnippetCommand(smoke) {
  const options = buildRunnerOptions({ smoke, repoRoot });
  console.error(PRINT_SNIPPET_INSTRUCTION);
  console.log(buildSnippetExpression(options));
}

export async function readManualResultFile(filePath, openFile = open) {
  let descriptor;
  try {
    descriptor = await openFile(filePath, "r");
    const stat = await descriptor.stat();
    if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > MAX_CAPTURE_JSON_BYTES) {
      throw new Error(
        `file is ${String(stat.size)} bytes, above the ${MAX_CAPTURE_JSON_BYTES} byte bound`,
      );
    }
    return parseManualResult(await readBoundedManualResult(descriptor));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read --from-json file "${filePath}": ${detail}`);
  } finally {
    await descriptor?.close();
  }
}

async function readBoundedManualResult(descriptor) {
  const chunks = [];
  let total = 0;
  while (total <= MAX_CAPTURE_JSON_BYTES) {
    const remaining = MAX_CAPTURE_JSON_BYTES + 1 - total;
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
    const { bytesRead } = await descriptor.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) return Buffer.concat(chunks, total).toString("utf8");
    chunks.push(buffer.subarray(0, bytesRead));
    total += bytesRead;
  }
  throw new Error(`file grew above the ${MAX_CAPTURE_JSON_BYTES} byte bound while reading`);
}

function aggregateDigest(hashes) {
  const digest = createHash("sha256");

  for (const relativePath of Object.keys(hashes).sort()) {
    digest.update(`${relativePath}:${hashes[relativePath]}\n`);
  }

  return digest.digest("hex");
}

function fixtureHashesForRun() {
  const largeFilesRoot = path.join(repoRoot, "perf/fixtures/large-files");
  const monorepoRoot = path.join(repoRoot, "perf/fixtures/monorepo");

  try {
    const largeFileHashes = computeFixtureHashes(largeFilesRoot);
    const hashes = {};

    for (const relativePath of Object.keys(largeFileHashes).sort()) {
      hashes[`large-files/${relativePath}`] = largeFileHashes[relativePath];
    }

    hashes["monorepo/"] = aggregateDigest(computeFixtureHashes(monorepoRoot));

    return hashes;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to hash the perf fixture tree under ${path.join(repoRoot, "perf/fixtures")}: ${detail}\n` +
        "The gap report rejects any run whose fixtureHashes are missing, so generate the fixtures " +
        "with npm run perf:fixtures before running the perf lane.",
    );
  }
}

function withRunMetadata(shaped, { fixtureHashes, environment }) {
  const withHashes =
    shaped.fixtureHashes || fixtureHashes === null ? shaped : { ...shaped, fixtureHashes };

  if (withHashes.environment || environment === null) {
    return withHashes;
  }

  return { ...withHashes, environment };
}

async function finishRun(
  result,
  smoke,
  fixtureHashesBefore = null,
  {
    attachLocalHost = false,
    importedCapture = false,
    environmentMetadata = null,
    persistOnlyOnSuccess = false,
  } = {},
) {
  const capturedAt = importedCapture
    ? capturedAtForImportedResult(result)
    : new Date().toISOString();
  const environment = importedCapture
    ? null
    : result.environment && (attachLocalHost || environmentMetadata)
      ? {
          ...result.environment,
          ...(attachLocalHost ? { hostPlatform: process.platform, hostArch: process.arch } : {}),
          ...(environmentMetadata ?? {}),
        }
      : (result.environment ?? null);
  const fixtureHashes = importedCapture ? null : fixtureHashesForRun();
  const fixtureFenceFailure =
    fixtureHashesBefore === null || fixtureHashes === null
      ? null
      : fixtureHashFenceFailure(fixtureHashesBefore, fixtureHashes);

  if (fixtureFenceFailure !== null) {
    throw new Error(fixtureFenceFailure);
  }
  let shaped = withRunMetadata(
    shapeRunResult({
      capturedAt,
      bridgeResults: result.bridgeResults,
      trackerSnapshot: result.trackerSnapshot,
      scenarioStatuses: result.scenarioStatuses ?? [],
      environment,
      retainedCounts: result.retainedCounts ?? null,
      memorySample: result.memorySample ?? null,
      failedPaths: result.failedPaths ?? [],
      fixtureVersion: importedCapture ? undefined : FIXTURE_VERSION,
      fixtureHashes,
      diagnosticSmoke: smoke === true && environment?.windowMode === "always-on-top-diagnostic",
    }),
    { fixtureHashes, environment },
  );
  if (environmentMetadata?.captureFlavor === "production-instrumented") {
    shaped = parseCaptureRunJson(JSON.stringify(shaped), {
      expectedEditor: "codevo",
      expectedBundleManifestSha256: environmentMetadata.bundleManifestSha256,
    });
  }
  printSummary(shaped, result.trackerSnapshot);
  const warning = environmentWarning(shaped, smoke);

  if (warning) {
    console.error(`Warning: ${warning}`);
  }

  const failures = evaluateRunOutcome({ result, shaped, smoke });

  for (const failure of failures) {
    console.error(failure);
  }

  if (failures.length > 0) {
    process.exitCode = 1;
    if (persistOnlyOnSuccess) {
      console.error("Production performance result was not persisted because validation failed.");
      return;
    }
  }
  const resultsDirectory = path.join(repoRoot, "perf/results");
  const resultPath = path.join(resultsDirectory, resultFileName(capturedAt));
  const temporaryResultPath = `${resultPath}.${process.pid}.tmp`;
  await mkdir(resultsDirectory, { recursive: true });
  await writeFile(temporaryResultPath, `${JSON.stringify(shaped, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  try {
    await link(temporaryResultPath, resultPath);
  } finally {
    await unlink(temporaryResultPath);
  }
  console.log(`Wrote ${resultPath}`);
}

export function parseRunPerfArgs(args) {
  const options = {
    cdpUrl: process.env.CODEVO_EDITOR_QA_CDP_URL || DEFAULT_CDP_URL,
    targetUrl: process.env.CODEVO_EDITOR_QA_TARGET_URL || DEFAULT_TARGET_URL,
    smoke: false,
    printSnippet: false,
    fromJsonPath: "",
    autorun: false,
    production: false,
    diagnosticElevation: false,
    autorunTimeoutMs: DEFAULT_AUTORUN_TIMEOUT_MS,
    productionBuildTimeoutMs: DEFAULT_PRODUCTION_BUILD_TIMEOUT_MS,
    productionRunTimeoutMs: DEFAULT_PRODUCTION_RUN_TIMEOUT_MS,
    productionRunTimeoutExplicit: false,
    productionBuildTimeoutExplicit: false,
    autorunTimeoutExplicit: false,
    cdpUrlExplicit: false,
    targetUrlExplicit: false,
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

    if (arg === "--autorun") {
      options.autorun = true;
      continue;
    }

    if (arg === "--production") {
      options.production = true;
      continue;
    }

    if (arg === "--diagnostic-elevation") {
      options.diagnosticElevation = true;
      continue;
    }

    if (arg === "--autorun-timeout-ms") {
      options.autorunTimeoutMs = parseAutorunTimeoutMs(requiredValue(args, index, arg));
      index += 1;
      options.autorunTimeoutExplicit = true;
      continue;
    }

    if (arg === "--production-build-timeout-ms") {
      options.productionBuildTimeoutMs = parseProductionTimeoutMs(requiredValue(args, index, arg), {
        flag: arg,
        maximum: MAX_PRODUCTION_BUILD_TIMEOUT_MS,
      });
      options.productionBuildTimeoutExplicit = true;
      index += 1;
      continue;
    }

    if (arg === "--production-run-timeout-ms") {
      options.productionRunTimeoutMs = parseProductionTimeoutMs(requiredValue(args, index, arg), {
        flag: arg,
        maximum: MAX_PRODUCTION_RUN_TIMEOUT_MS,
      });
      options.productionRunTimeoutExplicit = true;
      index += 1;
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
      options.cdpUrlExplicit = true;
      continue;
    }

    if (arg === "--target-url") {
      options.targetUrl = requiredValue(args, index, arg);
      index += 1;
      options.targetUrlExplicit = true;
      continue;
    }

    throw new Error(`Unknown option "${arg}".`);
  }

  const lanes = [
    options.printSnippet,
    options.fromJsonPath.length > 0,
    options.autorun,
    options.production,
  ].filter(Boolean);

  if (options.diagnosticElevation && !options.autorun) {
    throw new Error("--diagnostic-elevation requires --autorun.");
  }

  if (
    !options.production &&
    (options.productionBuildTimeoutExplicit || options.productionRunTimeoutExplicit)
  ) {
    throw new Error("Production timeout flags require --production.");
  }

  if (
    options.production &&
    (options.autorunTimeoutExplicit || options.cdpUrlExplicit || options.targetUrlExplicit)
  ) {
    throw new Error("CDP and autorun-only flags are not valid with --production.");
  }

  if (lanes.length > 1) {
    throw new Error("Use exactly one of --production, --autorun, --print-snippet, or --from-json.");
  }

  if (options.production && options.smoke && !options.productionRunTimeoutExplicit) {
    options.productionRunTimeoutMs = DEFAULT_PRODUCTION_SMOKE_TIMEOUT_MS;
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

    return { result: normalizeCdpResult(response.result?.value) };
  } finally {
    client.close();
  }
}

export function normalizeCdpResult(value) {
  let raw;
  try {
    raw = JSON.stringify(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`CDP performance result could not be serialized: ${detail}`);
  }
  if (typeof raw !== "string") {
    throw new Error("CDP performance result is missing.");
  }
  return parseManualResult(raw);
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
