#!/usr/bin/env node

import { open, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGapReport, renderGapReportMarkdown, DEFAULT_TOLERANCES } from "./gapReport.mjs";
import { MAX_CAPTURE_JSON_BYTES, parseCaptureRunJson } from "./perfCaptureContract.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "../..");
const resultsDirectory = path.join(repoRoot, "perf/results");
const baselinePath = path.join(repoRoot, "perf/baselines/vscode.json");

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

async function main() {
  const resultPath = await newestCodevoResultPath();
  const codevo = await readCaptureFile(resultPath, "codevo");
  const baseline = await readCaptureFile(baselinePath, "vscode");
  const report = buildGapReport({ codevo, baseline, tolerances: DEFAULT_TOLERANCES });

  console.log(renderGapReportMarkdown(report));

  if (report.failures.length > 0 || report.failedPaths.length > 0) {
    process.exitCode = 1;
  }
}

export async function readCaptureFile(filePath, expectedEditor, openFile = open) {
  const descriptor = await openFile(filePath, "r");

  try {
    const stat = await descriptor.stat();
    if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > MAX_CAPTURE_JSON_BYTES) {
      throw new Error(
        `Perf capture ${filePath} is ${String(stat.size)} bytes, above the ${MAX_CAPTURE_JSON_BYTES} byte bound.`,
      );
    }

    const raw = await readBoundedDescriptor(descriptor);
    return parseCaptureRunJson(raw, { expectedEditor });
  } finally {
    await descriptor.close();
  }
}

async function readBoundedDescriptor(descriptor) {
  const chunks = [];
  let total = 0;

  while (total <= MAX_CAPTURE_JSON_BYTES) {
    const remaining = MAX_CAPTURE_JSON_BYTES + 1 - total;
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
    const { bytesRead } = await descriptor.read(buffer, 0, buffer.length, null);

    if (bytesRead === 0) {
      return Buffer.concat(chunks, total).toString("utf8");
    }

    chunks.push(buffer.subarray(0, bytesRead));
    total += bytesRead;
  }

  throw new Error(
    `Perf capture grew above the ${MAX_CAPTURE_JSON_BYTES} byte bound while reading.`,
  );
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
