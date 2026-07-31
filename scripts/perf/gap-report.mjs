#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGapReport, renderGapReportMarkdown, DEFAULT_TOLERANCES } from "./gapReport.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "../..");
const resultsDirectory = path.join(repoRoot, "perf/results");
const baselinePath = path.join(repoRoot, "perf/baselines/vscode.json");

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const resultPath = await newestCodevoResultPath();
  const codevo = JSON.parse(await readFile(resultPath, "utf8"));
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  const report = buildGapReport({ codevo, baseline, tolerances: DEFAULT_TOLERANCES });

  console.log(renderGapReportMarkdown(report));

  if (report.failures.length > 0 || report.failedPaths.length > 0) {
    process.exitCode = 1;
  }
}

async function newestCodevoResultPath() {
  const entries = await readdirSafe(resultsDirectory);
  const resultFiles = entries.filter((name) => /^codevo-.*\.json$/.test(name)).sort();

  if (resultFiles.length === 0) {
    throw new Error(
      `No Codevo perf results found in ${path.relative(repoRoot, resultsDirectory)}/. Run npm run perf:run first.`,
    );
  }

  return path.join(resultsDirectory, resultFiles[resultFiles.length - 1]);
}

async function readdirSafe(directory) {
  try {
    return await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}
