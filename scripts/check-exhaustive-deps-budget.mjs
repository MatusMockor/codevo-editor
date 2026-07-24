import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const EXHAUSTIVE_DEPS_RULE = "react-hooks/exhaustive-deps";

export function snapshotFromEslintReport(report, projectRoot) {
  const files = {};

  for (const result of report) {
    const count = result.messages.filter(
      (message) => message.ruleId === EXHAUSTIVE_DEPS_RULE,
    ).length;
    if (count === 0) continue;

    const relativePath = path.relative(projectRoot, result.filePath).split(path.sep).join("/");
    files[relativePath] = count;
  }

  const sortedFiles = Object.fromEntries(
    Object.entries(files).sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    budget: Object.values(sortedFiles).reduce((sum, count) => sum + count, 0),
    files: sortedFiles,
    rule: EXHAUSTIVE_DEPS_RULE,
  };
}

export function compareSnapshots(baseline, current) {
  const growth = [];
  const reductions = [];
  const paths = new Set([...Object.keys(baseline.files), ...Object.keys(current.files)]);

  for (const filePath of [...paths].sort()) {
    const expected = baseline.files[filePath] ?? 0;
    const actual = current.files[filePath] ?? 0;
    if (actual > expected) growth.push({ actual, expected, path: filePath });
    if (actual < expected) reductions.push({ actual, expected, path: filePath });
  }

  return { growth, reductions };
}

async function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDirectory, "..");
  const baselinePath = path.join(scriptDirectory, "react-hooks-exhaustive-deps-baseline.json");
  const eslintPath = path.join(projectRoot, "node_modules/eslint/bin/eslint.js");
  const result = spawnSync(
    process.execPath,
    [eslintPath, "src", "--rule", `${EXHAUSTIVE_DEPS_RULE}: warn`, "--format", "json"],
    { cwd: projectRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );

  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (!result.stdout.trim()) {
    console.error("ESLint did not produce a JSON report.");
    process.exit(2);
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    console.error(`Unable to parse the ESLint JSON report: ${error.message}`);
    process.exit(2);
  }
  if (result.status !== 0 && report.some((entry) => entry.errorCount > 0)) {
    console.error("ESLint reported errors while measuring exhaustive-deps debt.");
    process.exit(result.status ?? 1);
  }

  const current = snapshotFromEslintReport(report, projectRoot);
  if (process.argv.includes("--update")) {
    await writeFile(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`Updated exhaustive-deps baseline to ${current.budget} violation(s).`);
    return;
  }

  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  if (baseline.rule !== EXHAUSTIVE_DEPS_RULE) {
    console.error(`Baseline rule must be ${EXHAUSTIVE_DEPS_RULE}.`);
    process.exit(2);
  }

  const { growth, reductions } = compareSnapshots(baseline, current);
  console.log(`React exhaustive-deps budget: ${current.budget}/${baseline.budget}`);

  if (growth.length > 0) {
    console.error("Exhaustive-deps debt increased:");
    for (const entry of growth) {
      console.error(`  ${entry.path}: ${entry.actual}/${entry.expected}`);
    }
  }
  if (current.budget > baseline.budget) {
    console.error(`Total budget exceeded by ${current.budget - baseline.budget}.`);
  }
  if (reductions.length > 0) {
    console.error("Debt decreased; lock in the lower per-file limits with:");
    console.error("  npm run lint:exhaustive-deps:update");
    for (const entry of reductions) {
      console.error(`  ${entry.path}: ${entry.expected} -> ${entry.actual}`);
    }
  }

  if (growth.length > 0 || reductions.length > 0 || current.budget !== baseline.budget) {
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
