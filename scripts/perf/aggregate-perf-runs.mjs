#!/usr/bin/env node

import console from "node:console";
import { randomUUID } from "node:crypto";
import { link, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { aggregatePerfRunFiles } from "./perfRunAggregator.mjs";

const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export async function runAggregateCli(
  args,
  { writeStdout = console.log, aggregate = aggregatePerfRunFiles } = {},
) {
  const options = parseAggregateArgs(args);
  const artifact = await aggregate(options.input);
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;

  if (options.output === null) {
    writeStdout(serialized.trimEnd());
    return artifact;
  }

  await assertOutputDoesNotAliasInput(options.output, options.input);
  await writeAggregateArtifactExclusive(options.output, serialized);
  return artifact;
}

export async function writeAggregateArtifactExclusive(
  outputPath,
  serialized,
  { openFile = open, linkFile = link, unlinkFile = unlink, createId = randomUUID } = {},
) {
  const temporaryPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.${createId()}.tmp`,
  );
  let descriptor = null;
  try {
    descriptor = await openFile(temporaryPath, "wx", 0o600);
    await descriptor.writeFile(serialized, "utf8");
    await descriptor.sync();
    await descriptor.close();
    descriptor = null;
    await linkFile(temporaryPath, outputPath);
  } finally {
    if (descriptor !== null) await descriptor.close().catch(() => {});
    await unlinkFile(temporaryPath).catch(() => {});
  }
}

export function parseAggregateArgs(args) {
  const values = {
    codevoClean: [],
    codevoConfirmation: null,
    vscodeClean: [],
    vscodeConfirmation: null,
    output: null,
  };
  const repeated = new Set(["--codevo-clean", "--vscode-clean"]);
  const flags = new Map([
    ["--codevo-clean", "codevoClean"],
    ["--codevo-confirmation", "codevoConfirmation"],
    ["--vscode-clean", "vscodeClean"],
    ["--vscode-confirmation", "vscodeConfirmation"],
    ["--output", "output"],
  ]);

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    const key = flags.get(flag);
    if (key === undefined) throw new Error(`Unknown perf aggregate flag: ${String(flag)}.`);
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} requires an explicit absolute file path.`);
    }
    if (!path.isAbsolute(value)) throw new Error(`${flag} requires an absolute file path.`);
    if (repeated.has(flag)) values[key].push(value);
    else {
      if (values[key] !== null) throw new Error(`${flag} may be provided only once.`);
      values[key] = value;
    }
  }

  if (values.codevoClean.length !== 3 || values.vscodeClean.length !== 3) {
    throw new Error("Exactly three --codevo-clean and three --vscode-clean paths are required.");
  }
  if (values.codevoConfirmation === null || values.vscodeConfirmation === null) {
    throw new Error("Both editor confirmation paths are required.");
  }

  return {
    input: {
      codevo: { clean: values.codevoClean, confirmation: values.codevoConfirmation },
      vscode: { clean: values.vscodeClean, confirmation: values.vscodeConfirmation },
    },
    output: values.output,
  };
}

async function assertOutputDoesNotAliasInput(outputPath, input) {
  const resolvedOutput = path.resolve(outputPath);
  const inputPaths = [
    ...input.codevo.clean,
    input.codevo.confirmation,
    ...input.vscode.clean,
    input.vscode.confirmation,
  ];

  for (const inputPath of inputPaths) {
    const canonicalInput = await realpath(inputPath);
    if (resolvedOutput === canonicalInput || resolvedOutput === path.resolve(inputPath)) {
      throw new Error("Aggregate output must not overwrite or alias a raw capture input.");
    }
  }
}

async function main(args) {
  await runAggregateCli(args);
}
