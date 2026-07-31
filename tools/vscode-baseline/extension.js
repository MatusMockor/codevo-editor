const vscode = require("vscode");
const path = require("path");
const fs = require("fs");

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

async function runTimed(repetitions, operation) {
  const samples = [];
  const outcomes = [];
  for (let index = 0; index < repetitions; index += 1) {
    const startedAt = performance.now();
    const outcome = await operation(index);
    samples.push(performance.now() - startedAt);
    outcomes.push(outcome);
  }
  return { samples, outcomes };
}

function measurement(id, samples, method, resultCounts) {
  const { p50, p95 } = percentilesFromSamples(samples);
  const base = { id, unit: "ms", samples, p50, p95, method };
  if (resultCounts === undefined) {
    return base;
  }
  return { ...base, resultCounts };
}

function assertResultBearing(id, resultCounts) {
  const allNonEmpty = resultCounts.every((count) => count > 0);
  if (allNonEmpty) {
    return;
  }
  throw new Error(id + " returned an empty result on at least one repetition (counts: " + resultCounts.join(",") + ")");
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

async function captureScenario(results, id, operation) {
  try {
    results.push(await operation());
  } catch (error) {
    results.push({ id, error: String(error && error.message || error) });
  }
}

async function captureTypingScenario(results, root, id, filename) {
  await captureScenario(results, id, async () => {
    const uri = vscode.Uri.file(path.join(root, filename));
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    const line = Math.floor(document.lineCount / 2);
    const position = new vscode.Position(line, document.lineAt(line).text.length);
    editor.selection = new vscode.Selection(position, position);
    const samples = [];
    const probe = "const perfProbe = 1;\n";
    try {
      for (let repetition = 0; repetition < 5; repetition += 1) {
        for (const char of probe) {
          const startedAt = performance.now();
          await vscode.commands.executeCommand("type", { text: char });
          samples.push(performance.now() - startedAt);
        }
      }
    } finally {
      await vscode.commands.executeCommand("workbench.action.files.revert");
    }
    return measurement(id, samples, "type-command-await");
  });
}

async function captureProviderScenario(results, id, repetitions, method, operation, getCount) {
  await captureScenario(results, id, async () => {
    const { samples, outcomes } = await runTimed(repetitions, operation);
    const resultCounts = outcomes.map(getCount);
    assertResultBearing(id, resultCounts);
    return measurement(id, samples, method, resultCounts);
  });
}

function discoverKindTargets(document, text, count) {
  const declarationPattern = /export type (\w+Kind) = "a" \| "b" \| "c";/g;
  const declarations = [];
  let match = declarationPattern.exec(text);
  while (match) {
    const name = match[1];
    declarations.push({ name, declIndex: match.index + match[0].indexOf(name) });
    match = declarationPattern.exec(text);
  }
  if (declarations.length === 0) {
    return [];
  }
  const step = Math.max(1, Math.floor(declarations.length / count));
  const targets = [];
  for (let cursor = 0; cursor < declarations.length && targets.length < count; cursor += step) {
    const declaration = declarations[cursor];
    const refIndex = text.indexOf(declaration.name, declaration.declIndex + declaration.name.length);
    if (refIndex === -1) {
      continue;
    }
    targets.push({
      name: declaration.name,
      declPosition: document.positionAt(declaration.declIndex),
      refPosition: document.positionAt(refIndex),
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

async function runLargeFilesScenarios(root) {
  const results = [];
  await captureTypingScenario(results, root, "typing-large-5k", "large-5k.ts");
  await captureTypingScenario(results, root, "typing-large-20k", "large-20k.ts");
  await captureTypingScenario(results, root, "typing-large-100k", "large-100k.ts");

  const filenames = ["large-5k.ts", "large-20k.ts", "large-100k.ts", "minified.ts", "huge-union.ts"];
  await captureScenario(results, "tab-switch-cycle", async () => {
    const uris = filenames.map((filename) => vscode.Uri.file(path.join(root, filename)));
    for (const uri of uris) {
      await vscode.commands.executeCommand("vscode.open", uri);
    }
    const samples = [];
    for (let cycle = 0; cycle < 6; cycle += 1) {
      for (const uri of uris) {
        const startedAt = performance.now();
        await vscode.commands.executeCommand("vscode.open", uri);
        samples.push(performance.now() - startedAt);
      }
    }
    return measurement("tab-switch-cycle", samples, "vscode.open-await");
  });

  const uri = vscode.Uri.file(path.join(root, "large-20k.ts"));
  let document;
  try {
    document = await vscode.workspace.openTextDocument(uri);
  } catch (error) {
    const ids = ["completion-large-20k", "definition-large-20k", "references-large-20k", "rename-large-20k"];
    for (const id of ids) {
      results.push({ id, error: String(error && error.message || error) });
    }
    return results;
  }
  const text = document.getText();
  const completionPosition = findGlobalCompletionPosition(document, text);
  const targets = discoverKindTargets(document, text, 10);
  if (targets.length === 0) {
    const ids = ["definition-large-20k", "references-large-20k", "rename-large-20k"];
    for (const id of ids) {
      results.push({ id, error: "no Kind-type declarations found to build navigation targets" });
    }
  }

  await captureProviderScenario(
    results,
    "completion-large-20k",
    10,
    "executeCompletionItemProvider",
    async () => vscode.commands.executeCommand("vscode.executeCompletionItemProvider", uri, completionPosition),
    completionCount,
  );

  if (targets.length > 0) {
    await captureProviderScenario(
      results,
      "definition-large-20k",
      10,
      "executeDefinitionProvider",
      async (index) =>
        vscode.commands.executeCommand(
          "vscode.executeDefinitionProvider",
          uri,
          targets[index % targets.length].refPosition,
        ),
      locationsCount,
    );
    await captureProviderScenario(
      results,
      "references-large-20k",
      10,
      "executeReferenceProvider",
      async (index) =>
        vscode.commands.executeCommand(
          "vscode.executeReferenceProvider",
          uri,
          targets[index % targets.length].declPosition,
        ),
      locationsCount,
    );
    await captureProviderScenario(
      results,
      "rename-large-20k",
      10,
      "executeDocumentRenameProvider",
      async (index) => {
        const target = targets[index % targets.length];
        return vscode.commands.executeCommand(
          "vscode.executeDocumentRenameProvider",
          uri,
          target.declPosition,
          target.name + "Renamed" + index,
        );
      },
      renameEditCount,
    );
  }
  return results;
}

async function runMonorepoScenarios() {
  const results = [];
  await captureProviderScenario(
    results,
    "quickopen-monorepo",
    10,
    "findFiles-proxy",
    async () => vscode.workspace.findFiles("**/file-0*.ts", "**/node_modules/**", 200),
    filesCount,
  );
  return results;
}

async function runScenarios() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return [{ id: "harness", error: "no workspace folder is open" }];
  }
  const root = folders[0].uri.fsPath;
  const isLargeFilesRoot = fs.existsSync(path.join(root, "large-20k.ts"));
  if (isLargeFilesRoot) {
    return runLargeFilesScenarios(root);
  }
  return runMonorepoScenarios();
}

function activate(context) {
  void context;
  (async () => {
    let scenarios = [];
    try {
      scenarios = await runScenarios();
    } catch (error) {
      scenarios = [{ id: "harness", error: String((error && error.message) || error) }];
    } finally {
      const outPath = process.env.CODEVO_BASELINE_OUT;
      if (outPath) {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, JSON.stringify({ scenarios }, null, 2) + "\n");
      }
      await vscode.commands.executeCommand("workbench.action.closeWindow");
    }
  })();
}

module.exports = { activate };
