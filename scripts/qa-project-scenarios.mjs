#!/usr/bin/env node

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_POLL_MS = 100;

const scenarios = [
  {
    action: "completion",
    activeFile:
      "/Users/matusmockor/Developer/invoices/app/Http/Controllers/Auth/AuthenticatedSessionController.php",
    cursor: { after: "$request->" },
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
    action: "completion",
    activeFile:
      "/Users/matusmockor/Developer/Efabrica/boxes/ebox-crm/app/modules/subscriptionsModule/templates/SubscriptionTypesAdmin/default.latte",
    cursor: { after: 'n:href="SubscriptionTypesAdmin:' },
    expectLabels: ["show", "new"],
    id: "ebox-crm-latte-link-completion",
    minItems: 1,
    projectRoot: "/Users/matusmockor/Developer/Efabrica/boxes/ebox-crm",
  },
  {
    action: "definition",
    activeFile:
      "/Users/matusmockor/Developer/Efabrica/boxes/ebox-crm/app/modules/subscriptionsModule/templates/SubscriptionTypesAdmin/default.latte",
    cursor: { after: 'n:href="SubscriptionTypesAdmin:Show' },
    expectActiveFileContains: "SubscriptionTypesAdminPresenter.php",
    id: "ebox-crm-latte-link-definition",
    projectRoot: "/Users/matusmockor/Developer/Efabrica/boxes/ebox-crm",
  },
];

const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));

main().catch((error) => {
  console.error(`qa-project-scenarios failed: ${error.message}`);
  process.exitCode = 1;
});

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

  if (options.scenarioIds.length === 0) {
    printHelp();
    throw new Error("Pass at least one --scenario.");
  }

  const selectedScenarios = selectScenarios(options.scenarioIds);

  if (options.printSnippet) {
    console.log(snippetFor(selectedScenarios));
    return;
  }

  if (!options.cdpUrl) {
    printHelp();
    throw new Error("Pass --cdp-url, --print-snippet, or --list.");
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
    cdpUrl: "",
    help: false,
    list: false,
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

    if (arg === "--list") {
      options.list = true;
      continue;
    }

    if (arg === "--print-snippet") {
      options.printSnippet = true;
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

function selectScenarios(ids) {
  for (const id of ids) {
    if (scenarioIds.has(id)) {
      continue;
    }

    throw new Error(`Unknown scenario "${id}". Run --list to see available scenarios.`);
  }

  return scenarios.filter((scenario) => ids.includes(scenario.id));
}

function printHelp() {
  console.log(`Usage: node ./scripts/qa-project-scenarios.mjs [options]

Options:
  --list                  List built-in real-project scenarios.
  --scenario <id>         Run only one scenario. Can be repeated.
  --cdp-url <url>         Chrome DevTools HTTP endpoint, for example http://127.0.0.1:9222.
  --target-url <text>     Select the CDP page whose URL contains this text.
  --print-snippet         Print an in-page snippet for Tauri WebView DevTools.
  --timeout-ms <ms>       Per-wait timeout. Default: ${DEFAULT_TIMEOUT_MS}.

The app must be running with the dev-only window.__codevoQa bridge enabled. If
the bridge exposes openWorkspaceFile(path), the harness opens each scenario file
before setting the cursor. Older bridges still require the active editor tab to
match each selected scenario's activeFile. Run scenarios from the matching
workspace/project tab; getWorkspaceRoot() is checked when the bridge exposes it.
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

function snippetFor(selectedScenarios) {
  return `await (${inPageRunnerSource()})(${JSON.stringify({
    scenarios: selectedScenarios,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  })});`;
}

async function runViaCdp(cdpUrl, options) {
  assertWebSocketAvailable();

  const targets = await cdpTargets(cdpUrl);
  const target = selectCdpTarget(targets, options.targetUrl);

  if (!target.webSocketDebuggerUrl) {
    throw new Error(`CDP target "${target.title ?? target.url}" has no webSocketDebuggerUrl.`);
  }

  const client = await CdpClient.connect(target.webSocketDebuggerUrl);

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

  throw new Error("This Node runtime does not expose global WebSocket; use --print-snippet.");
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
    throw new Error("No CDP page targets found.");
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

  return exceptionDetails.text ?? "Runtime.evaluate failed.";
}

function printRunResult(result) {
  if (!Array.isArray(result)) {
    throw new Error("Scenario runner did not return an array.");
  }

  for (const item of result) {
    console.log(`${item.ok ? "PASS" : "FAIL"} ${item.id}`);
    console.log(`  ${item.message}`);
  }

  if (result.every((item) => item.ok)) {
    return;
  }

  process.exitCode = 1;
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
    message: result.message,
  })));

  return results;

  async function runScenario(qa, scenario, waitMs, intervalMs) {
    try {
      return await executeScenario(qa, scenario, waitMs, intervalMs);
    } catch (error) {
      return {
        id: scenario.id,
        message: error instanceof Error ? error.message : String(error),
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
      return await completionScenario(qa, scenario);
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

  async function completionScenario(qa, scenario) {
    const items = await qa.getCompletionItems();
    const labels = items.map((item) => item.label);
    const missing = (scenario.expectLabels ?? []).filter((label) => !labels.includes(label));

    if (missing.length > 0) {
      throw new Error("Missing completion labels: " + missing.join(", ") + ". Saw: " + labels.slice(0, 20).join(", "));
    }

    if (scenario.minItems && items.length < scenario.minItems) {
      throw new Error("Expected at least " + scenario.minItems + " completion item(s), got " + items.length + ".");
    }

    return {
      id: scenario.id,
      itemCount: items.length,
      labels: labels.slice(0, 20),
      message: "completion returned " + items.length + " item(s)",
      ok: true,
    };
  }

  async function definitionScenario(qa, scenario, previousFile, waitMs, intervalMs) {
    if (!(await qa.triggerDefinition())) {
      throw new Error("triggerDefinition returned false.");
    }

    const nextFile = await waitForDefinitionTarget(qa, scenario, previousFile, waitMs, intervalMs);

    return {
      id: scenario.id,
      message: "definition navigated to " + nextFile,
      ok: true,
      targetFile: nextFile,
    };
  }

  async function waitForBridge(waitMs, intervalMs) {
    const bridge = await waitFor(() => window.__codevoQa, waitMs, intervalMs);

    if (!bridge) {
      throw new Error("window.__codevoQa is not installed. Start with npm run debug:qa or enable codevo.qaBridge.");
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
    const index = source.indexOf(anchor);

    if (!anchor) {
      throw new Error("Scenario cursor must define after or before.");
    }

    if (index < 0) {
      throw new Error("Cursor anchor not found: " + anchor);
    }

    const offset = cursor.after ? index + anchor.length : index;
    const adjustedOffset = offset + (cursor.offset ?? 0);

    if (adjustedOffset < 0 || adjustedOffset > source.length) {
      throw new Error("Cursor offset is outside the active file.");
    }

    return offsetToPosition(source, adjustedOffset);
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
