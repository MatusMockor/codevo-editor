import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import process from "node:process";
import * as prettier from "prettier";

const requestedBase = process.argv[2]?.trim();
const base = requestedBase || "HEAD^";

try {
  execFileSync("git", ["rev-parse", "--verify", `${base}^{commit}`], { stdio: "ignore" });
} catch {
  console.error(`Unable to resolve format-check base commit: ${base}`);
  process.exit(2);
}

const output = execFileSync(
  "git",
  ["diff", "--name-status", "-z", "--diff-filter=ACMR", base, "HEAD", "--", "*.ts", "*.tsx"],
  { encoding: "utf8" },
);
const tokens = output.split("\0").filter(Boolean);
const changed = [];

for (let index = 0; index < tokens.length;) {
  const status = tokens[index++];
  const kind = status[0];
  if (kind === "R" || kind === "C") {
    changed.push({ baselinePath: tokens[index++], kind, path: tokens[index++] });
  } else {
    const path = tokens[index++];
    changed.push({ baselinePath: path, kind, path });
  }
}

const failures = [];
const skippedLegacy = [];
for (const entry of changed) {
  const options = (await prettier.resolveConfig(entry.path)) ?? {};
  const current = await readFile(entry.path, "utf8");

  if (entry.kind !== "A") {
    const baseline = execFileSync("git", ["show", `${base}:${entry.baselinePath}`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (!(await prettier.check(baseline, { ...options, filepath: entry.baselinePath }))) {
      skippedLegacy.push(entry.path);
      continue;
    }
  }

  if (!(await prettier.check(current, { ...options, filepath: entry.path }))) {
    failures.push(entry.path);
  }
}

if (skippedLegacy.length > 0) {
  console.log(
    `Skipped ${skippedLegacy.length} modified legacy file(s) that were already unformatted at ${base}:`,
  );
  for (const path of skippedLegacy) console.log(`  ${path}`);
}

if (failures.length > 0) {
  console.error("Changed files must preserve the Prettier-clean baseline; format these files:");
  for (const path of failures) console.error(`  ${path}`);
  process.exit(1);
}

console.log(`Changed-file format ratchet passed for ${changed.length} TS/TSX file(s).`);
