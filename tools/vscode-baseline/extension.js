const vscode = require("vscode");
const os = require("os");
const path = require("path");
const fs = require("fs");

const CUT_POINT_PROVIDER = "provider-ui-ready";
const CUT_POINT_TYPING = "typing-dispatch";
const CUT_POINT_TAB_SWITCH = "tab-switch-open-resolved";
const CUT_POINT_FILE_SEARCH = "file-search-engine";

const LSP_WARMUP_COUNT = 2;
const LSP_SAMPLE_COUNT = 10;
const KIND_TARGET_COUNT = 10;
const LSP_READINESS_TIMEOUT_MS = 60000;
const LSP_READINESS_INTERVAL_MS = 500;
const LSP_READINESS_MIN_COMPLETION_ITEMS = 1000;

const TYPING_WARMUP_KEYSTROKES = 10;
const TYPING_SAMPLE_KEYSTROKES = 50;
const TYPING_PROBE_TEXT = 'const perfTypingProbe00 = "abcdefghijklmnopqrstuvwxyz0123456789";';
const TYPING_CHANGE_TIMEOUT_MS = 10000;

const TAB_SWITCH_CYCLES = 6;

const FILE_SEARCH_QUERIES = [
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
const FILE_SEARCH_RESULT_CAP = 80;
const FILE_SEARCH_EXCLUDE_GLOB = "**/node_modules/**";

const TIMER_QUANTIZATION_SAMPLE_COUNT = 20000;

const TAB_SWITCH_WINDOW_NOTE = "awaits vscode.open resolution only; no frame settlement";
const TYPING_WINDOW_NOTE =
  "type command dispatch until workspace.onDidChangeTextDocument fires for the same document; " +
  "the extension host cannot observe layout, rendering or paint, so no frame cost is included; " +
  "the TypeScript service was proven ready on this document before the first keystroke";
const FILE_SEARCH_WINDOW_NOTE =
  "vscode.workspace.findFiles engine query capped at 80 results; this is the file-search engine " +
  "only and is never the Quick Open picker, its fuzzy ranking, or its list rendering";
const COMPLETION_UNBOUNDED_WINDOW_NOTE =
  "global unfiltered completion; VS Code converts the whole ambient symbol table while Codevo " +
  "caps its projection, so this row is permanently non-comparable by result counts";

const LARGE_FILE_NAMES = [
  "large-5k.ts",
  "large-20k.ts",
  "large-100k.ts",
  "minified.ts",
  "huge-union.ts",
];

const CANONICAL_SCENARIO_IDS = {
  completionBounded: "completion-bounded",
  completionUnbounded: "completion-unbounded",
  definition: "definition-medium-2k",
  references: "references-medium-2k",
  rename: "rename-medium-2k",
};

const CAPABILITY_SCENARIO_IDS = {
  completionBounded: null,
  completionUnbounded: "completion-large-20k",
  definition: "definition-large-20k",
  references: "references-large-20k",
  rename: "rename-large-20k",
};

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function measureTimerQuantizationMs(sampleCount) {
  let minimum = Number.POSITIVE_INFINITY;
  let previous = performance.now();
  for (let index = 0; index < sampleCount; index += 1) {
    const current = performance.now();
    const delta = current - previous;
    previous = current;
    if (delta > 0 && delta < minimum) {
      minimum = delta;
    }
  }
  if (minimum === Number.POSITIVE_INFINITY) {
    return 0;
  }
  return minimum;
}

function percentilesFromSamples(samples) {
  if (samples.length === 0) {
    return { p50: 0, p95: 0 };
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const p50 = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  return { p50, p95 };
}

function scenarioResult(fields) {
  const { p50, p95 } = percentilesFromSamples(fields.samples.map((sample) => sample.ms));
  const base = {
    id: fields.id,
    cutPoint: fields.cutPoint,
    warmups: fields.warmups,
    targets: fields.targets,
    unit: "ms",
    samples: fields.samples,
    p50,
    p95,
    method: fields.method,
    status: "ok",
  };
  const withLanguageServer =
    fields.languageServerStatus === undefined
      ? base
      : { ...base, languageServerStatus: fields.languageServerStatus };
  if (fields.windowNote === undefined) {
    return withLanguageServer;
  }
  return { ...withLanguageServer, windowNote: fields.windowNote };
}

function failureResult(id, status, message) {
  return { id, status, error: message };
}

function errorMessage(error) {
  return String((error && error.message) || error);
}

function completionCount(list) {
  if (list && Array.isArray(list.items)) {
    return list.items.length;
  }
  return 0;
}

function locationsCount(locations) {
  if (Array.isArray(locations)) {
    return locations.length;
  }
  return 0;
}

function renameEditCount(edit) {
  if (edit && typeof edit.size === "number") {
    return edit.size;
  }
  return 0;
}

function filesCount(files) {
  if (Array.isArray(files)) {
    return files.length;
  }
  return 0;
}

function positionLabel(prefix, position) {
  return prefix + "@" + (position.line + 1) + ":" + (position.character + 1);
}

function repeatedTargets(label, count) {
  const targets = [];
  for (let index = 0; index < count; index += 1) {
    targets.push(label);
  }
  return targets;
}

async function captureScenario(results, id, operation) {
  try {
    results.push(await operation());
  } catch (error) {
    results.push(failureResult(id, "invalid", errorMessage(error)));
  }
}

async function captureProviderScenario(results, spec) {
  await captureScenario(results, spec.id, async () => {
    for (let index = 0; index < LSP_WARMUP_COUNT; index += 1) {
      await spec.invoke(index);
    }
    const samples = [];
    const emptyTargets = [];
    for (let index = 0; index < LSP_SAMPLE_COUNT; index += 1) {
      const startedAt = performance.now();
      const outcome = await spec.invoke(index);
      const elapsed = performance.now() - startedAt;
      const resultCount = spec.countOf(outcome);
      samples.push({ ms: elapsed, resultCount });
      if (resultCount <= 0) {
        emptyTargets.push(spec.targets[index]);
      }
    }
    if (emptyTargets.length > 0) {
      return failureResult(
        spec.id,
        "no-result",
        "empty provider result for targets: " + emptyTargets.join(", "),
      );
    }
    return scenarioResult({
      id: spec.id,
      cutPoint: CUT_POINT_PROVIDER,
      warmups: LSP_WARMUP_COUNT,
      targets: spec.targets,
      samples,
      method: spec.method,
      languageServerStatus: spec.languageServerStatus,
      windowNote: spec.windowNote,
    });
  });
}

function waitForDocumentChange(document, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      subscription.dispose();
      reject(
        new Error("no workspace.onDidChangeTextDocument observed within " + timeoutMs + " ms"),
      );
    }, timeoutMs);
    const subscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (settled) {
        return;
      }
      if (event.document.uri.toString() !== document.uri.toString()) {
        return;
      }
      if (event.contentChanges.length === 0) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      subscription.dispose();
      resolve(performance.now());
    });
  });
}

async function captureTypingScenario(results, root, id, filename) {
  await captureScenario(results, id, async () => {
    const uri = vscode.Uri.file(path.join(root, filename));
    const document = await vscode.workspace.openTextDocument(uri);
    const endPosition = document.lineAt(document.lineCount - 1).range.end;
    const ready = await waitForLanguageServerReadiness(uri, endPosition);
    if (!ready) {
      return failureResult(id, "not-run", readinessFailureText(filename));
    }
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(endPosition, endPosition);
    const keystrokeCount = TYPING_WARMUP_KEYSTROKES + TYPING_SAMPLE_KEYSTROKES;
    const samples = [];
    const targets = [];
    try {
      for (let keystroke = 0; keystroke < keystrokeCount; keystroke += 1) {
        const character = TYPING_PROBE_TEXT[keystroke % TYPING_PROBE_TEXT.length];
        const changeObserved = waitForDocumentChange(document, TYPING_CHANGE_TIMEOUT_MS);
        const startedAt = performance.now();
        await vscode.commands.executeCommand("type", { text: character });
        const changedAt = await changeObserved;
        if (keystroke < TYPING_WARMUP_KEYSTROKES) {
          continue;
        }
        samples.push({ ms: changedAt - startedAt });
        targets.push(character);
      }
    } finally {
      await vscode.commands.executeCommand("workbench.action.files.revert");
    }
    return scenarioResult({
      id,
      cutPoint: CUT_POINT_TYPING,
      warmups: TYPING_WARMUP_KEYSTROKES,
      targets,
      samples,
      method: "type-command-to-onDidChangeTextDocument",
      languageServerStatus: "running",
      windowNote: TYPING_WINDOW_NOTE,
    });
  });
}

async function captureTabSwitchScenario(results, root) {
  await captureScenario(results, "tab-switch-cycle", async () => {
    const uris = LARGE_FILE_NAMES.map((filename) => vscode.Uri.file(path.join(root, filename)));
    for (const uri of uris) {
      await vscode.commands.executeCommand("vscode.open", uri);
    }
    const samples = [];
    const targets = [];
    for (let cycle = 0; cycle < TAB_SWITCH_CYCLES; cycle += 1) {
      for (let index = 0; index < uris.length; index += 1) {
        const startedAt = performance.now();
        await vscode.commands.executeCommand("vscode.open", uris[index]);
        samples.push({ ms: performance.now() - startedAt });
        targets.push(LARGE_FILE_NAMES[index]);
      }
    }
    return scenarioResult({
      id: "tab-switch-cycle",
      cutPoint: CUT_POINT_TAB_SWITCH,
      warmups: uris.length,
      targets,
      samples,
      method: "vscode.open-await",
      windowNote: TAB_SWITCH_WINDOW_NOTE,
    });
  });
}

function discoverKindTargets(document, text, count) {
  const declarationPattern = /export type (\w+Kind) = "a" \| "b" \| "c";/g;
  const targets = [];
  let match = declarationPattern.exec(text);
  while (match && targets.length < count) {
    const name = match[1];
    const declIndex = match.index + match[0].indexOf(name);
    const fieldIndex = text.indexOf(": " + name + ";", declIndex + name.length);
    match = declarationPattern.exec(text);
    if (fieldIndex === -1) {
      continue;
    }
    targets.push({
      name,
      declPosition: document.positionAt(declIndex),
      refPosition: document.positionAt(fieldIndex + 2),
    });
  }
  return targets;
}

function findGlobalCompletionPosition(document, text) {
  const blankLineIndex = text.indexOf("\n\n");
  if (blankLineIndex === -1) {
    return document.positionAt(0);
  }
  return document.positionAt(blankLineIndex + 1);
}

function findMemberCompletionPosition(document, text) {
  const memberIndex = text.indexOf("input.");
  if (memberIndex === -1) {
    return null;
  }
  return document.positionAt(memberIndex + "input.".length);
}

function readinessFailureText(filename) {
  return (
    "no completion list of at least " +
    LSP_READINESS_MIN_COMPLETION_ITEMS +
    " items was produced for " +
    filename +
    " within " +
    LSP_READINESS_TIMEOUT_MS +
    " ms, so the TypeScript language service was never proven ready"
  );
}

async function waitForLanguageServerReadiness(uri, position) {
  const deadline = Date.now() + LSP_READINESS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const list = await vscode.commands.executeCommand(
      "vscode.executeCompletionItemProvider",
      uri,
      position,
    );
    if (completionCount(list) >= LSP_READINESS_MIN_COMPLETION_ITEMS) {
      return true;
    }
    await sleep(LSP_READINESS_INTERVAL_MS);
  }
  return false;
}

function scenarioIdList(ids) {
  return [
    ids.completionBounded,
    ids.completionUnbounded,
    ids.definition,
    ids.references,
    ids.rename,
  ].filter((id) => id !== null);
}

async function captureLspScenarios(results, root, filename, ids) {
  const uri = vscode.Uri.file(path.join(root, filename));
  let document;
  try {
    document = await vscode.workspace.openTextDocument(uri);
  } catch (error) {
    for (const id of scenarioIdList(ids)) {
      results.push(failureResult(id, "invalid", errorMessage(error)));
    }
    return;
  }

  const text = document.getText();
  const readinessPosition = document.lineAt(document.lineCount - 1).range.end;
  const ready = await waitForLanguageServerReadiness(uri, readinessPosition);
  if (!ready) {
    for (const id of scenarioIdList(ids)) {
      results.push(failureResult(id, "not-run", readinessFailureText(filename)));
    }
    return;
  }
  const languageServerStatus = "running";

  const memberPosition = findMemberCompletionPosition(document, text);
  if (ids.completionBounded !== null && memberPosition === null) {
    results.push(
      failureResult(
        ids.completionBounded,
        "no-result",
        filename + " contains no `input.` member expression to anchor bounded completion",
      ),
    );
  }
  if (ids.completionBounded !== null && memberPosition !== null) {
    await captureProviderScenario(results, {
      id: ids.completionBounded,
      method: "executeCompletionItemProvider",
      languageServerStatus,
      targets: repeatedTargets(positionLabel("member:input.", memberPosition), LSP_SAMPLE_COUNT),
      countOf: completionCount,
      invoke: async () =>
        vscode.commands.executeCommand("vscode.executeCompletionItemProvider", uri, memberPosition),
    });
  }

  const globalPosition = findGlobalCompletionPosition(document, text);
  await captureProviderScenario(results, {
    id: ids.completionUnbounded,
    method: "executeCompletionItemProvider",
    languageServerStatus,
    windowNote: COMPLETION_UNBOUNDED_WINDOW_NOTE,
    targets: repeatedTargets(positionLabel("global:blank-line", globalPosition), LSP_SAMPLE_COUNT),
    countOf: completionCount,
    invoke: async () =>
      vscode.commands.executeCommand("vscode.executeCompletionItemProvider", uri, globalPosition),
  });

  const kindTargets = discoverKindTargets(document, text, KIND_TARGET_COUNT);
  if (kindTargets.length < KIND_TARGET_COUNT) {
    for (const id of [ids.definition, ids.references, ids.rename]) {
      results.push(
        failureResult(
          id,
          "no-result",
          filename +
            " yielded only " +
            kindTargets.length +
            " of the required " +
            KIND_TARGET_COUNT +
            " `*Kind` declarations with a `: <name>;` field usage",
        ),
      );
    }
    return;
  }
  const kindNames = kindTargets.map((target) => target.name);

  await captureProviderScenario(results, {
    id: ids.definition,
    method: "executeDefinitionProvider",
    languageServerStatus,
    targets: kindNames,
    countOf: locationsCount,
    invoke: async (index) =>
      vscode.commands.executeCommand(
        "vscode.executeDefinitionProvider",
        uri,
        kindTargets[index].refPosition,
      ),
  });

  await captureProviderScenario(results, {
    id: ids.references,
    method: "executeReferenceProvider",
    languageServerStatus,
    targets: kindNames,
    countOf: locationsCount,
    invoke: async (index) =>
      vscode.commands.executeCommand(
        "vscode.executeReferenceProvider",
        uri,
        kindTargets[index].declPosition,
      ),
  });

  await captureProviderScenario(results, {
    id: ids.rename,
    method: "executeDocumentRenameProvider",
    languageServerStatus,
    targets: kindNames,
    countOf: renameEditCount,
    invoke: async (index) =>
      vscode.commands.executeCommand(
        "vscode.executeDocumentRenameProvider",
        uri,
        kindTargets[index].declPosition,
        kindTargets[index].name + "Renamed",
      ),
  });
}

async function runLargeFilesScenarios(root) {
  const results = [];
  await captureTabSwitchScenario(results, root);
  await captureTypingScenario(results, root, "typing-large-5k", "large-5k.ts");
  await captureTypingScenario(results, root, "typing-large-20k", "large-20k.ts");
  await captureTypingScenario(results, root, "typing-large-100k", "large-100k.ts");
  await captureLspScenarios(results, root, "medium-2k.ts", CANONICAL_SCENARIO_IDS);
  await captureLspScenarios(results, root, "large-20k.ts", CAPABILITY_SCENARIO_IDS);
  return results;
}

function fileSearchGlob(query) {
  return "{**/*" + query + "*,**/*" + query + "*/**}";
}

async function runFileSearchQuery(query) {
  return vscode.workspace.findFiles(
    fileSearchGlob(query),
    FILE_SEARCH_EXCLUDE_GLOB,
    FILE_SEARCH_RESULT_CAP,
  );
}

async function captureFileSearchScenario(results) {
  await captureScenario(results, "file-search-engine", async () => {
    for (let index = 0; index < LSP_WARMUP_COUNT; index += 1) {
      await runFileSearchQuery(FILE_SEARCH_QUERIES[index]);
    }
    const samples = [];
    const emptyQueries = [];
    for (const query of FILE_SEARCH_QUERIES) {
      const startedAt = performance.now();
      const files = await runFileSearchQuery(query);
      const elapsed = performance.now() - startedAt;
      const resultCount = filesCount(files);
      samples.push({ ms: elapsed, resultCount });
      if (resultCount === 0) {
        emptyQueries.push(query);
      }
    }
    if (emptyQueries.length === FILE_SEARCH_QUERIES.length) {
      return failureResult(
        "file-search-engine",
        "no-result",
        "every query returned an empty result list, so the file-search engine did no measurable work",
      );
    }
    const emptyNote =
      emptyQueries.length === 0
        ? ""
        : "; queries with no match in this fixture: " + emptyQueries.join(", ");
    return scenarioResult({
      id: "file-search-engine",
      cutPoint: CUT_POINT_FILE_SEARCH,
      warmups: LSP_WARMUP_COUNT,
      targets: [...FILE_SEARCH_QUERIES],
      samples,
      method: "workspace.findFiles",
      windowNote: FILE_SEARCH_WINDOW_NOTE + emptyNote,
    });
  });
}

async function runMonorepoScenarios() {
  const results = [];
  await captureFileSearchScenario(results);
  return results;
}

async function runScenarios() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return [failureResult("harness", "invalid", "no workspace folder is open")];
  }
  const root = folders[0].uri.fsPath;
  const isLargeFilesRoot = fs.existsSync(path.join(root, "large-20k.ts"));
  if (isLargeFilesRoot) {
    return runLargeFilesScenarios(root);
  }
  return runMonorepoScenarios();
}

function buildEnvironment(timerQuantizationMs) {
  return {
    editor: "vscode",
    version: vscode.version,
    bundleMode: "production",
    timerQuantizationMs,
    platform: process.platform + "-" + process.arch + "-" + os.release(),
    capturedAt: new Date().toISOString(),
  };
}

function activate(context) {
  void context;
  (async () => {
    const timerQuantizationMs = measureTimerQuantizationMs(TIMER_QUANTIZATION_SAMPLE_COUNT);
    const environment = buildEnvironment(timerQuantizationMs);
    let scenarios = [];
    try {
      scenarios = await runScenarios();
    } catch (error) {
      scenarios = [failureResult("harness", "invalid", errorMessage(error))];
    } finally {
      const outPath = process.env.CODEVO_BASELINE_OUT;
      if (outPath) {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, JSON.stringify({ environment, scenarios }, null, 2) + "\n");
      }
      await vscode.commands.executeCommand("workbench.action.closeWindow");
    }
  })();
}

module.exports = { activate };
