import { execFileSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import * as prettier from "prettier";

const MAX_BYTES = 64 * 1024 * 1024;

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_BYTES,
    timeout: 30_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function changes(cwd, args) {
  const tokens = git(cwd, ["diff", "--name-status", "-z", "--find-renames", ...args, "--"])
    .split("\0")
    .filter(Boolean);
  const entries = new Map();
  for (let index = 0; index < tokens.length;) {
    const kind = tokens[index++][0];
    const original = tokens[index++];
    const path = kind === "R" || kind === "C" ? tokens[index++] : original;
    if (/\.tsx?$/.test(path)) {
      entries.set(path, { path, baselinePath: kind === "A" ? null : original, kind });
    }
  }
  return entries;
}

/** Check committed changes and local index/worktree changes without hiding new files. */
export async function checkChangedFormat({ cwd = process.cwd(), base = "HEAD^" } = {}) {
  let commit;
  try {
    commit = git(cwd, ["rev-parse", "--verify", `${base}^{commit}`]).trim();
  } catch {
    throw new Error(`Unable to resolve format-check base commit: ${base}`);
  }
  const committed = changes(cwd, [commit, "HEAD"]);
  const working = changes(cwd, [commit]);
  const stagedBaseline = changes(cwd, ["--cached", commit]);
  const staged = changes(cwd, ["--cached", "HEAD"]);
  const candidates = new Map([...committed, ...working]);
  // Preserve the index's rename ancestry when further unstaged edits change similarity.
  // A combined base-to-worktree diff can otherwise pair unrelated similar files.
  for (const [path, entry] of stagedBaseline) {
    if (entry.kind !== "D" && candidates.has(path)) candidates.set(path, entry);
  }
  for (const path of git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter((path) => /\.tsx?$/.test(path))) {
    candidates.set(path, { path, baselinePath: null, kind: "A" });
  }

  const failures = new Set();
  const skippedLegacy = new Set();
  const checked = new Set();
  const baselineChecks = new Map();
  async function check(entry, current, label) {
    const absolute = resolve(cwd, entry.path);
    const info = await prettier.getFileInfo(absolute, {
      ignorePath: resolve(cwd, ".prettierignore"),
    });
    if (info.ignored) return;
    const options = (await prettier.resolveConfig(absolute)) ?? {};
    checked.add(entry.path);
    if (entry.baselinePath !== null) {
      const baselinePath = entry.baselinePath;
      if (!baselineChecks.has(baselinePath)) {
        const baseline = git(cwd, ["show", `${commit}:${baselinePath}`]);
        baselineChecks.set(
          baselinePath,
          await prettier.check(baseline, {
            ...options,
            filepath: resolve(cwd, baselinePath),
          }),
        );
      }
      if (!baselineChecks.get(baselinePath)) {
        skippedLegacy.add(entry.path);
        return;
      }
    }
    if (!(await prettier.check(current, { ...options, filepath: absolute }))) {
      failures.add(label);
    }
  }

  for (const entry of candidates.values()) {
    let stat;
    try {
      stat = await lstat(resolve(cwd, entry.path));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (!stat.isFile() || stat.size > MAX_BYTES) {
      throw new Error(
        `Expected a regular TS/TSX file of at most ${MAX_BYTES} bytes: ${entry.path}`,
      );
    }
    await check(entry, await readFile(resolve(cwd, entry.path), "utf8"), entry.path);
  }
  for (const entry of staged.values()) {
    if (entry.kind === "D") continue;
    // The index may differ from the working tree: verify what a commit would actually contain.
    const baseline = stagedBaseline.get(entry.path) ?? {
      ...entry,
      baselinePath: entry.path,
    };
    await check(baseline, git(cwd, ["show", `:${entry.path}`]), `${entry.path} (staged)`);
  }
  return {
    checked: checked.size,
    failures: [...failures].sort(),
    skippedLegacy: [...skippedLegacy].sort(),
  };
}

async function main() {
  const base = process.argv[2]?.trim() || "HEAD^";
  try {
    const result = await checkChangedFormat({ base });
    if (result.skippedLegacy.length > 0) {
      console.log(
        `Skipped ${result.skippedLegacy.length} modified legacy file(s) that were already unformatted at ${base}:`,
      );
      for (const path of result.skippedLegacy) console.log(`  ${path}`);
    }
    if (result.failures.length > 0) {
      console.error("Changed files must preserve the Prettier-clean baseline; format these files:");
      for (const path of result.failures) console.error(`  ${path}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Changed-file format ratchet passed for ${result.checked} TS/TSX file(s).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
