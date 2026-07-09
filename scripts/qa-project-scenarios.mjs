#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_POLL_MS = 100;
const DEFAULT_CDP_URL = "http://127.0.0.1:9222";

const defaultPreflightFs = {
  exists(path) {
    return existsSync(path);
  },
  isDirectory(path) {
    return statSync(path).isDirectory();
  },
  isFile(path) {
    return statSync(path).isFile();
  },
  readText(path) {
    return readFileSync(path, "utf8");
  },
};

const scenarios = [
  {
    action: "completion",
    activeFile:
      "/Users/matusmockor/Developer/invoices/app/Http/Controllers/Auth/AuthenticatedSessionController.php",
    cursor: { after: "$request->", occurrence: 1 },
    expectLabels: ["authenticate", "session"],
    id: "invoices-php-request-completion",
    minItems: 1,
    projectRoot: "/Users/matusmockor/Developer/invoices",
  },
  {
    action: "definition",
    activeFile:
      "/Users/matusmockor/Developer/invoices/resources/views/auth/login.blade.php",
    cursor: { after: "route('password.request" },
    expectActiveFile: "/Users/matusmockor/Developer/invoices/routes/auth.php",
    id: "invoices-blade-route-definition",
    projectRoot: "/Users/matusmockor/Developer/invoices",
  },
  {
    action: "definition",
    activeFile:
      "/Users/matusmockor/Developer/invoices/app/Http/Controllers/InvoicePdfPreviewController.php",
    cursor: { after: "view('invoices.pdf-preview" },
    expectActiveFile:
      "/Users/matusmockor/Developer/invoices/resources/views/invoices/pdf-preview.blade.php",
    id: "invoices-php-view-definition",
    projectRoot: "/Users/matusmockor/Developer/invoices",
  },
  {
    action: "definition",
    activeFile:
      "/Users/matusmockor/Developer/invoices/resources/views/auth/reset-password.blade.php",
    cursor: { after: "route('password.store" },
    expectActiveFile: "/Users/matusmockor/Developer/invoices/routes/auth.php",
    id: "invoices-blade-password-store-route-definition",
    projectRoot: "/Users/matusmockor/Developer/invoices",
  },
  {
    action: "definition",
    activeFile:
      "/Users/matusmockor/Developer/invoices/resources/views/profile/edit.blade.php",
    cursor: { after: "@include('profile.partials.update-password-form" },
    expectActiveFile:
      "/Users/matusmockor/Developer/invoices/resources/views/profile/partials/update-password-form.blade.php",
    id: "invoices-blade-include-definition",
    projectRoot: "/Users/matusmockor/Developer/invoices",
  },
  {
    action: "completion",
    activeFile:
      "/Users/matusmockor/Developer/invoices/app/Http/Controllers/InvoicePdfPreviewController.php",
    cursor: { after: "(string) $request->" },
    expectLabels: ["query", "input"],
    id: "invoices-php-request-query-completion",
    minItems: 1,
    projectRoot: "/Users/matusmockor/Developer/invoices",
  },
  {
    action: "completion",
    activeFile:
      "/Users/matusmockor/Developer/invoices/app/Http/Controllers/InvoicePdfPreviewController.php",
    cursor: { after: "$supplierBank = $invoice->" },
    expectLabels: ["getSupplierBankSnapshot", "getSupplierSnapshot"],
    id: "invoices-php-invoice-model-completion",
    minItems: 1,
    projectRoot: "/Users/matusmockor/Developer/invoices",
  },
  {
    action: "completion",
    activeFile:
      "/Users/matusmockor/Developer/Efabrica/boxes/ebox-crm/app/modules/subscriptionsModule/templates/SubscriptionTypesAdmin/default.latte",
    cursor: { after: '<a n:href="SubscriptionTypesAdmin:new' },
    expectLabels: ["show", "new"],
    id: "ebox-crm-latte-link-completion",
    minItems: 1,
    projectRoot: "/Users/matusmockor/Developer/Efabrica/boxes/ebox-crm",
  },
  {
    action: "definition",
    activeFile:
      "/Users/matusmockor/Developer/Efabrica/boxes/ebox-crm/app/modules/subscriptionsModule/templates/SubscriptionTypesAdmin/default.latte",
    cursor: {
      after: '<a n:href="SubscriptionTypesAdmin:Show $type->next_subscription_type_id',
    },
    expectActiveFileContains: "SubscriptionTypesAdminPresenter.php",
    id: "ebox-crm-latte-link-definition",
    projectRoot: "/Users/matusmockor/Developer/Efabrica/boxes/ebox-crm",
  },
  {
    action: "completion",
    activeFile:
      "/Users/matusmockor/Developer/Efabrica/boxes/ebox-crm/app/modules/paymentsModule/templates/PaymentGatewaysAdmin/default.latte",
    cursor: { after: "{link PaymentGatewaysAdmin:", occurrence: 1 },
    expectLabels: ["show", "edit", "editPermission", "default"],
    id: "ebox-crm-latte-link-payment-gateways-completion",
    minItems: 1,
    projectRoot: "/Users/matusmockor/Developer/Efabrica/boxes/ebox-crm",
  },
  {
    action: "definition",
    activeFile:
      "/Users/matusmockor/Developer/Efabrica/boxes/ebox-crm/app/modules/paymentsModule/templates/PaymentGatewaysAdmin/default.latte",
    cursor: { after: "{link PaymentGatewaysAdmin:Edit" },
    expectActiveFileContains: "PaymentGatewaysAdminPresenter.php",
    id: "ebox-crm-latte-link-payment-gateways-edit-definition",
    projectRoot: "/Users/matusmockor/Developer/Efabrica/boxes/ebox-crm",
  },
  {
    action: "definition",
    activeFile:
      "/Users/matusmockor/Developer/Efabrica/boxes/ebox-crm/app/modules/crossSellModule/templates/CrossSellTransfersAdmin/show.latte",
    cursor: { after: "{control crossSellTimeline" },
    expectActiveFileContains: "CrossSellTransfersAdminPresenter.php",
    id: "ebox-crm-latte-control-cross-sell-timeline-definition",
    projectRoot: "/Users/matusmockor/Developer/Efabrica/boxes/ebox-crm",
  },
  {
    action: "definition",
    activeFile:
      "/Users/matusmockor/Developer/Efabrica/boxes/ebox-crm/app/modules/stepperModule/config.neon",
    cursor: {
      after:
        "factory: Efabrica\\Crm\\StepperModule\\Model\\StepperAttemptProcessor\\StepperAttemptProcessor",
    },
    expectActiveFile:
      "/Users/matusmockor/Developer/Efabrica/boxes/ebox-crm/app/modules/stepperModule/Model/StepperAttemptProcessor/StepperAttemptProcessor.php",
    id: "ebox-crm-neon-stepper-processor-definition",
    projectRoot: "/Users/matusmockor/Developer/Efabrica/boxes/ebox-crm",
  },
  {
    action: "completion",
    activeFile:
      "/Users/matusmockor/Developer/Efabrica/boxes/ebox-crm/app/modules/apiModule/templates/ApiTokensAdmin/default.latte",
    cursor: { after: "<code>{$apiToken->" },
    expectLabels: ["token", "name", "ip_restrictions", "created_at", "active"],
    id: "ebox-crm-latte-api-token-member-completion",
    minItems: 1,
    projectRoot: "/Users/matusmockor/Developer/Efabrica/boxes/ebox-crm",
  },
];

const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));

if (isMainModule()) {
  main().catch((error) => {
    console.error(`qa-project-scenarios failed: ${error.message}`);
    process.exitCode = 1;
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (options.list) {
    printScenarioList();
    return;
  }

  if (!options.all && options.scenarioIds.length === 0) {
    printHelp();
    throw new Error("Pass --all or at least one --scenario.");
  }

  const selectedScenarios = selectScenarios(options);

  if (options.preflight) {
    printPreflightResult(validatePreflightScenarios(selectedScenarios));
    return;
  }

  if (options.printSnippet) {
    console.log(snippetFor(selectedScenarios, options.timeoutMs));
    return;
  }

  if (!options.cdpUrl) {
    printHelp();
    throw new Error(cdpEndpointGuidance(""));
  }

  const result = await runViaCdp(options.cdpUrl, {
    scenarios: selectedScenarios,
    targetUrl: options.targetUrl,
    timeoutMs: options.timeoutMs,
  });
  printRunResult(result);
}

function parseArgs(args) {
  const options = {
    all: false,
    cdpUrl: "",
    help: false,
    list: false,
    preflight: false,
    printSnippet: false,
    scenarioIds: [],
    targetUrl: "",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--all") {
      options.all = true;
      continue;
    }

    if (arg === "--list") {
      options.list = true;
      continue;
    }

    if (arg === "--print-snippet") {
      options.printSnippet = true;
      continue;
    }

    if (arg === "--preflight") {
      options.preflight = true;
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

    if (arg === "--scenario") {
      options.scenarioIds.push(requiredValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--timeout-ms") {
      options.timeoutMs = positiveInteger(requiredValue(args, index, arg), arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown option "${arg}".`);
  }

  if (options.all && options.scenarioIds.length > 0) {
    throw new Error("Use --all or --scenario, not both.");
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

function positiveInteger(value, flag) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }

  return parsed;
}

function selectScenarios(options) {
  if (options.all) {
    return scenarios;
  }

  for (const id of options.scenarioIds) {
    if (scenarioIds.has(id)) {
      continue;
    }

    throw new Error(`Unknown scenario "${id}". Run --list to see available scenarios.`);
  }

  return scenarios.filter((scenario) => options.scenarioIds.includes(scenario.id));
}

function printHelp() {
  console.log(`Usage: node ./scripts/qa-project-scenarios.mjs [options]

Options:
  --list                  List built-in real-project scenarios.
  --all                   Run all built-in scenarios.
  --scenario <id>         Run only one scenario. Can be repeated.
  --cdp-url <url>         Chrome DevTools HTTP endpoint, for example http://127.0.0.1:9222.
  --target-url <text>     Select the CDP page whose URL contains this text.
  --preflight             Validate selected scenario files and cursor anchors only.
  --print-snippet         Print an in-page snippet for Tauri WebView DevTools.
  --timeout-ms <ms>       Per-wait timeout. Default: ${DEFAULT_TIMEOUT_MS}.

Live CDP/snippet runs require the app to be running with the dev-only
window.__codevoQa bridge enabled. If the bridge exposes openWorkspaceFile(path),
the harness opens each scenario file before setting the cursor. Older bridges
still require the active editor tab to match each selected scenario's activeFile.
Run scenarios from the matching workspace/project tab; getWorkspaceRoot() is
checked when the bridge exposes it.
`);
}

function printScenarioList() {
  for (const scenario of scenarios) {
    console.log(`${scenario.id}`);
    console.log(`  project: ${scenario.projectRoot}`);
    console.log(`  file:    ${scenario.activeFile}`);
    console.log(`  action:  ${scenario.action}`);
  }
}

function snippetFor(selectedScenarios, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return `await (${inPageRunnerSource()})(${JSON.stringify({
    scenarios: selectedScenarios,
    timeoutMs,
  })});`;
}

function validatePreflightScenarios(selectedScenarios) {
  return selectedScenarios.map((scenario) => validateScenarioPreflight(scenario));
}

function validateScenarioPreflight(scenario, fs = defaultPreflightFs) {
  const checks = [];
  const failures = [];
  const warnings = [];

  const projectRoot = checkPath(scenario.projectRoot, "projectRoot", "directory", fs);
  checks.push(projectRoot);
  collectIssue(projectRoot, failures, warnings);

  const activeFile = checkPath(scenario.activeFile, "activeFile", "file", fs);
  checks.push(activeFile);
  collectIssue(activeFile, failures, warnings);

  const source = activeFile.ok ? readPreflightText(scenario.activeFile, fs) : null;

  if (source?.check) {
    checks.push(source.check);
    collectIssue(source.check, failures, warnings);
  }

  const cursor = checkCursorAnchor(scenario, typeof source?.text === "string" ? source.text : null);
  checks.push(cursor);
  collectIssue(cursor, failures, warnings);

  if (scenario.action === "definition" && scenario.expectActiveFile) {
    const expectActiveFile = checkPath(scenario.expectActiveFile, "expectActiveFile", "file", fs);
    checks.push(expectActiveFile);
    collectIssue(expectActiveFile, failures, warnings);
  }

  return {
    activeFile: scenario.activeFile,
    action: scenario.action,
    checks,
    failures,
    id: scenario.id,
    ok: failures.length === 0,
    projectRoot: scenario.projectRoot,
    warnings,
  };
}

function readPreflightText(path, fs) {
  try {
    return { text: fs.readText(path) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      check: failedCheck("activeFile", `activeFile could not be read: ${path} (${message})`),
    };
  }
}

function checkPath(path, label, expectedType, fs) {
  if (!path) {
    return failedCheck(label, `${label} is not configured.`);
  }

  if (!fs.exists(path)) {
    return failedCheck(label, `${label} does not exist: ${path}`);
  }

  const isExpectedType = expectedType === "directory" ? fs.isDirectory(path) : fs.isFile(path);

  if (!isExpectedType) {
    return failedCheck(label, `${label} is not a ${expectedType}: ${path}`);
  }

  return passedCheck(label, `${label} exists: ${path}`);
}

function checkCursorAnchor(scenario, source) {
  const anchor = scenario.cursor?.after ?? scenario.cursor?.before;
  const occurrence = cursorOccurrence(scenario.cursor);

  if (!anchor) {
    return failedCheck("cursor", "cursor must define a non-empty after or before anchor.");
  }

  if (source === null) {
    return failedCheck(
      "cursor",
      `cursor anchor was not checked because activeFile is unavailable: ${anchor}`,
    );
  }

  const count = countOccurrences(source, anchor);
  const detail = `cursor anchor matches ${count} time(s), using occurrence ${occurrence}: ${anchor}`;

  if (count === 0) {
    return failedCheck("cursor", detail, { count, occurrence });
  }

  if (occurrence > count) {
    return failedCheck("cursor", detail, { count, occurrence });
  }

  if (count > 1 && !scenario.cursor?.occurrence) {
    return warnedCheck("cursor", detail, { count, occurrence });
  }

  return passedCheck("cursor", detail, { count, occurrence });
}

function cursorOccurrence(cursor) {
  const occurrence = cursor?.occurrence ?? 1;

  if (!Number.isInteger(occurrence) || occurrence < 1) {
    return 1;
  }

  return occurrence;
}

function countOccurrences(source, needle) {
  let count = 0;
  let index = source.indexOf(needle);

  while (index !== -1) {
    count += 1;
    index = source.indexOf(needle, index + needle.length);
  }

  return count;
}

function passedCheck(label, detail, extra = {}) {
  return { detail, label, ok: true, status: "PASS", ...extra };
}

function warnedCheck(label, detail, extra = {}) {
  return { detail, label, ok: true, status: "WARN", ...extra };
}

function failedCheck(label, detail, extra = {}) {
  return { detail, label, ok: false, status: "FAIL", ...extra };
}

function collectIssue(check, failures, warnings) {
  if (!check.ok) {
    failures.push(check.detail);
    return;
  }

  if (check.status === "WARN") {
    warnings.push(check.detail);
  }
}

function printPreflightResult(result) {
  if (!Array.isArray(result)) {
    throw new Error("Preflight runner did not return an array.");
  }

  let passed = 0;
  let warned = 0;

  for (const item of result) {
    const status = item.ok ? (item.warnings.length > 0 ? "WARN" : "PASS") : "FAIL";
    console.log(`${status} ${item.id}`);
    console.log(`  action:  ${displayValue(item.action)}`);
    console.log(`  project: ${displayValue(item.projectRoot)}`);
    console.log(`  file:    ${displayValue(item.activeFile)}`);

    for (const check of item.checks) {
      console.log(`  ${check.status.toLowerCase()}:   ${check.detail}`);
    }

    if (item.ok) {
      passed += 1;
    }

    if (item.warnings.length > 0) {
      warned += 1;
    }
  }

  const failed = result.length - passed;
  console.log(`Summary: ${passed}/${result.length} passed, ${warned} warned, ${failed} failed.`);

  if (failed === 0) {
    return;
  }

  process.exitCode = 1;
}

async function runViaCdp(cdpUrl, options) {
  assertWebSocketAvailable();

  const targets = await cdpTargets(cdpUrl);
  const target = selectCdpTarget(targets, options.targetUrl);

  if (!target.webSocketDebuggerUrl) {
    throw new Error(
      cdpEndpointGuidance(
        cdpUrl,
        `CDP target "${target.title ?? target.url}" has no webSocketDebuggerUrl.`,
      ),
    );
  }

  let client;
  try {
    client = await CdpClient.connect(target.webSocketDebuggerUrl);
  } catch (error) {
    throw new Error(cdpEndpointGuidance(cdpUrl, errorMessage(error)));
  }

  try {
    const expression = `(${inPageRunnerSource()})(${JSON.stringify({
      scenarios: options.scenarios,
      timeoutMs: options.timeoutMs,
    })})`;
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

  throw new Error(
    "This Node runtime does not expose global WebSocket. " +
      "Run with a newer Node runtime or use --print-snippet in Tauri WebView DevTools.",
  );
}

async function cdpTargets(cdpUrl) {
  let endpoint;
  try {
    endpoint = new URL("/json/list", normalizedCdpUrl(cdpUrl));
  } catch (error) {
    throw new Error(cdpEndpointGuidance(cdpUrl, errorMessage(error)));
  }

  let response;
  try {
    response = await fetch(endpoint);
  } catch (error) {
    throw new Error(cdpEndpointGuidance(cdpUrl, errorMessage(error)));
  }

  if (!response.ok) {
    throw new Error(
      cdpEndpointGuidance(cdpUrl, `Failed to read ${endpoint}: HTTP ${response.status}.`),
    );
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

function cdpEndpointGuidance(cdpUrl, detail = "") {
  const endpoint = cdpUrl || DEFAULT_CDP_URL;
  const endpointHint =
    endpoint === DEFAULT_CDP_URL
      ? `For smoke:projects, the default CDP endpoint is ${DEFAULT_CDP_URL}.`
      : `For smoke:projects, set MOCKOR_EDITOR_QA_CDP_URL=${endpoint}.`;
  const lines = [
    detail || "CDP endpoint is missing.",
    `Start the QA app with: npm run debug:qa`,
    endpointHint,
    `For direct runs, pass --cdp-url ${endpoint}.`,
    "If CDP is not available, run with --print-snippet and paste the snippet into Tauri WebView DevTools.",
  ];

  return lines.join("\n");
}

function errorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function formatCdpException(exceptionDetails) {
  const description = exceptionDetails.exception?.description;

  if (description) {
    return description;
  }

  return exceptionDetails.text ?? "Runtime.evaluate failed.";
}

function printRunResult(result) {
  if (!Array.isArray(result)) {
    throw new Error("Scenario runner did not return an array.");
  }

  let passed = 0;

  for (const item of result) {
    console.log(`${item.ok ? "PASS" : "FAIL"} ${item.id}`);
    console.log(`  action:   ${displayValue(item.action)}`);
    console.log(`  file:     ${displayValue(item.activeFile)}`);
    console.log(`  expected: ${formatExpected(item)}`);
    console.log(`  actual:   ${formatActual(item)}`);

    if (item.message) {
      console.log(`  detail:   ${item.message}`);
    }

    if (item.errorDetail) {
      console.log(`  error:    ${item.errorDetail}`);
    }

    if (item.ok) {
      passed += 1;
    }
  }

  const failed = result.length - passed;
  console.log(`Summary: ${passed}/${result.length} passed, ${failed} failed.`);

  if (failed === 0) {
    return;
  }

  process.exitCode = 1;
}

function formatExpected(item) {
  if (item.action === "completion") {
    const labels = item.expectedLabels ?? [];
    const minItems = item.minItems ? `, minItems ${item.minItems}` : "";
    return `labels [${labels.join(", ")}]${minItems}`;
  }

  if (item.action === "definition") {
    return displayValue(item.expectedTarget);
  }

  return "n/a";
}

function formatActual(item) {
  if (item.action === "completion") {
    const labels = item.actualLabels ?? [];
    const count = typeof item.itemCount === "number" ? `${item.itemCount} item(s), ` : "";
    return `${count}labels [${labels.join(", ")}]`;
  }

  if (item.action === "definition") {
    return displayValue(item.actualActiveFile ?? item.targetFile);
  }

  return displayValue(item.actualActiveFile);
}

function displayValue(value) {
  if (value === undefined || value === null || value === "") {
    return "n/a";
  }

  return String(value);
}

function isMainModule() {
  return import.meta.url === new URL(process.argv[1], "file:").href;
}

export {
  formatActual,
  cdpEndpointGuidance,
  formatExpected,
  parseArgs,
  printPreflightResult,
  printRunResult,
  scenarios,
  selectScenarios,
  snippetFor,
  validatePreflightScenarios,
  validateScenarioPreflight,
};

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

function inPageRunnerSource() {
  return String.raw`async function runCodevoQaProjectScenarios(options) {
  const timeoutMs = options.timeoutMs ?? ${DEFAULT_TIMEOUT_MS};
  const pollMs = ${DEFAULT_POLL_MS};
  const bridge = await waitForBridge(timeoutMs, pollMs);
  const results = [];

  for (const scenario of options.scenarios) {
    results.push(await runScenario(bridge, scenario, timeoutMs, pollMs));
  }

  console.table(results.map((result) => ({
    id: result.id,
    ok: result.ok,
    action: result.action,
    message: result.message,
  })));

  return results;

  async function runScenario(qa, scenario, waitMs, intervalMs) {
    try {
      return await executeScenario(qa, scenario, waitMs, intervalMs);
    } catch (error) {
      const actualActiveFile = safeActiveFile(qa);

      return {
        action: scenario.action,
        activeFile: scenario.activeFile,
        actualActiveFile,
        errorDetail: error && error.stack ? error.stack : "",
        expectedLabels: scenario.expectLabels ?? [],
        expectedTarget: expectedTargetFor(scenario),
        id: scenario.id,
        itemCount: null,
        message: error instanceof Error ? error.message : String(error),
        minItems: scenario.minItems ?? null,
        ok: false,
      };
    }
  }

  async function executeScenario(qa, scenario, waitMs, intervalMs) {
    await assertProjectContext(qa, scenario, "before opening " + scenario.activeFile);
    await openScenarioFile(qa, scenario, waitMs, intervalMs);
    await assertProjectContext(qa, scenario, "after opening " + scenario.activeFile);

    const activeFile = qa.getActiveFile();

    if (!activeFile) {
      throw new Error("No active editor file.");
    }

    if (activeFile !== scenario.activeFile) {
      throw new Error("Active file mismatch. Expected " + scenario.activeFile + ", got " + activeFile + ".");
    }

    const value = qa.getValue();

    if (typeof value !== "string") {
      throw new Error("Active editor has no text model.");
    }

    const position = positionFromCursor(value, scenario.cursor);

    if (!qa.setCursor(position)) {
      throw new Error("setCursor returned false.");
    }

    if (scenario.action === "completion") {
      return await completionScenario(qa, scenario, activeFile);
    }

    if (scenario.action === "definition") {
      return await definitionScenario(qa, scenario, activeFile, waitMs, intervalMs);
    }

    throw new Error("Unsupported scenario action " + scenario.action + ".");
  }

  async function openScenarioFile(qa, scenario, waitMs, intervalMs) {
    if (typeof qa.openWorkspaceFile !== "function") {
      return;
    }

    const opened = await qa.openWorkspaceFile(scenario.activeFile);

    if (opened === false) {
      throw new Error("openWorkspaceFile returned false for " + scenario.activeFile + ".");
    }

    await waitFor(() => qa.getActiveFile() === scenario.activeFile, waitMs, intervalMs);
  }

  async function assertProjectContext(qa, scenario, phase) {
    if (!scenario.projectRoot) {
      throw new Error("Scenario " + scenario.id + " has no projectRoot.");
    }

    if (!isPathInsideRoot(scenario.activeFile, scenario.projectRoot)) {
      throw new Error(
        "Scenario activeFile is outside projectRoot. Scenario " +
          scenario.id +
          " projectRoot is " +
          scenario.projectRoot +
          ", activeFile is " +
          scenario.activeFile +
          ".",
      );
    }

    if (typeof qa.getWorkspaceRoot === "function") {
      const workspaceRoot = await qa.getWorkspaceRoot();

      if (typeof workspaceRoot === "string" && workspaceRoot.length > 0) {
        if (normalizePath(workspaceRoot) !== normalizePath(scenario.projectRoot)) {
          throw new Error(
            "Workspace root mismatch " +
              phase +
              ". Expected " +
              scenario.projectRoot +
              ", got " +
              workspaceRoot +
              ". Open the matching workspace/project tab before running this scenario.",
          );
        }

        return;
      }
    }

    const activeFile = qa.getActiveFile();

    if (!activeFile) {
      return;
    }

    if (!isPathInsideRoot(activeFile, scenario.projectRoot)) {
      throw new Error(
        "Active file is outside scenario projectRoot " +
          phase +
          ". Expected an active file under " +
          scenario.projectRoot +
          ", got " +
          activeFile +
          ". Open the matching workspace/project tab before running this scenario.",
      );
    }
  }

  async function completionScenario(qa, scenario, activeFile) {
    const items = await qa.getCompletionItems();
    const labels = items.map((item) => item.label);
    const missing = (scenario.expectLabels ?? []).filter((label) => !labels.includes(label));

    if (missing.length > 0) {
      return completionResult(qa, scenario, activeFile, items, labels, false, "Missing completion labels: " + missing.join(", ") + ".");
    }

    if (scenario.minItems && items.length < scenario.minItems) {
      return completionResult(
        qa,
        scenario,
        activeFile,
        items,
        labels,
        false,
        "Expected at least " + scenario.minItems + " completion item(s), got " + items.length + ".",
      );
    }

    return completionResult(qa, scenario, activeFile, items, labels, true, "completion returned " + items.length + " item(s)");
  }

  function completionResult(qa, scenario, activeFile, items, labels, ok, message) {
    return {
      action: scenario.action,
      activeFile,
      actualActiveFile: qa.getActiveFile(),
      actualLabels: labels.slice(0, 20),
      expectedLabels: scenario.expectLabels ?? [],
      expectedTarget: expectedTargetFor(scenario),
      id: scenario.id,
      itemCount: items.length,
      message,
      minItems: scenario.minItems ?? null,
      ok,
    };
  }

  async function definitionScenario(qa, scenario, previousFile, waitMs, intervalMs) {
    if (!(await qa.triggerDefinition())) {
      throw new Error("triggerDefinition returned false.");
    }

    const nextFile = await waitForDefinitionTarget(qa, scenario, previousFile, waitMs, intervalMs);

    return {
      action: scenario.action,
      activeFile: previousFile,
      actualActiveFile: nextFile,
      actualLabels: [],
      expectedLabels: scenario.expectLabels ?? [],
      expectedTarget: expectedTargetFor(scenario),
      id: scenario.id,
      message: "definition navigated to " + nextFile,
      ok: true,
      targetFile: nextFile,
    };
  }

  function expectedTargetFor(scenario) {
    if (scenario.expectActiveFile) {
      return scenario.expectActiveFile;
    }

    if (scenario.expectActiveFileContains) {
      return "active file containing " + scenario.expectActiveFileContains;
    }

    return scenario.action === "definition" ? "any file different from source" : "";
  }

  function safeActiveFile(qa) {
    try {
      return qa.getActiveFile ? qa.getActiveFile() : "";
    } catch {
      return "";
    }
  }

  async function waitForBridge(waitMs, intervalMs) {
    const bridge = await waitFor(() => window.__codevoQa, waitMs, intervalMs);

    if (!bridge) {
      throw new Error(
        "window.__codevoQa is not installed. Start with npm run debug:qa. " +
          "For an already running dev app, enable the localStorage fallback with " +
          "localStorage.setItem('codevo.qaBridge', '1') and reload.",
      );
    }

    return bridge;
  }

  async function waitForDefinitionTarget(qa, scenario, previousFile, waitMs, intervalMs) {
    return await waitFor(() => {
      const currentFile = qa.getActiveFile();

      if (!currentFile) {
        return null;
      }

      if (scenario.expectActiveFile && currentFile === scenario.expectActiveFile) {
        return currentFile;
      }

      if (scenario.expectActiveFileContains && currentFile.includes(scenario.expectActiveFileContains)) {
        return currentFile;
      }

      if (!scenario.expectActiveFile && !scenario.expectActiveFileContains && currentFile !== previousFile) {
        return currentFile;
      }

      return null;
    }, waitMs, intervalMs);
  }

  function positionFromCursor(source, cursor) {
    const anchor = cursor.after ?? cursor.before;
    const occurrence = cursorOccurrence(cursor);
    const index = indexOfOccurrence(source, anchor, occurrence);

    if (!anchor) {
      throw new Error("Scenario cursor must define after or before.");
    }

    if (index < 0) {
      throw new Error(
        "Cursor anchor occurrence " + occurrence + " not found: " + anchor,
      );
    }

    const offset = cursor.after ? index + anchor.length : index;
    const adjustedOffset = offset + (cursor.offset ?? 0);

    if (adjustedOffset < 0 || adjustedOffset > source.length) {
      throw new Error("Cursor offset is outside the active file.");
    }

    return offsetToPosition(source, adjustedOffset);
  }

  function cursorOccurrence(cursor) {
    const occurrence = cursor.occurrence ?? 1;

    if (!Number.isInteger(occurrence) || occurrence < 1) {
      return 1;
    }

    return occurrence;
  }

  function indexOfOccurrence(source, needle, occurrence) {
    let index = -1;
    let fromIndex = 0;

    for (let count = 0; count < occurrence; count += 1) {
      index = source.indexOf(needle, fromIndex);

      if (index < 0) {
        return -1;
      }

      fromIndex = index + needle.length;
    }

    return index;
  }

  function offsetToPosition(source, offset) {
    const prefix = source.slice(0, offset);
    const lines = prefix.split("\n");

    return {
      column: lines[lines.length - 1].length + 1,
      lineNumber: lines.length,
    };
  }

  function isPathInsideRoot(path, root) {
    const normalizedPath = normalizePath(path);
    const normalizedRoot = normalizePath(root);

    return normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + "/");
  }

  function normalizePath(path) {
    return String(path).replace(/\\/g, "/").replace(/\/+$/, "");
  }

  async function waitFor(read, waitMs, intervalMs) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < waitMs) {
      const value = read();

      if (value) {
        return value;
      }

      await sleep(intervalMs);
    }

    throw new Error("Timed out after " + waitMs + "ms.");
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}`;
}
