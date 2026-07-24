import { spawnSync } from "node:child_process";
import console from "node:console";
import { lstatSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const repositoryRoot = process.cwd();
const rustSourceRoot = join(repositoryRoot, "src-tauri", "src");
const MAX_DIAGNOSTIC_LENGTH = 512;

function bounded(value) {
  const text = String(value).replaceAll(/\p{Cc}/gu, "?");
  return text.length <= MAX_DIAGNOSTIC_LENGTH ? text : `${text.slice(0, MAX_DIAGNOSTIC_LENGTH)}…`;
}

function displayPath(root, path) {
  return bounded(relative(root, path) || ".");
}

function discoveryError(root, path, action, error) {
  const detail = error instanceof Error ? `: ${bounded(error.message)}` : "";
  return new Error(`Rust source discovery could not ${action} ${displayPath(root, path)}${detail}`);
}

function checkedLstat(root, path) {
  try {
    return lstatSync(path);
  } catch (error) {
    throw discoveryError(root, path, "inspect", error);
  }
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function discoverRustSources(sourceRoot) {
  const root = resolve(sourceRoot);
  const files = [];
  const identities = new Map();

  function walk(directory) {
    const before = checkedLstat(root, directory);
    if (before.isSymbolicLink()) {
      throw discoveryError(root, directory, "accept symbolic link");
    }
    if (!before.isDirectory()) {
      throw discoveryError(root, directory, "enter non-directory");
    }

    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      throw discoveryError(root, directory, "read directory", error);
    }
    entries.sort((left, right) => compareNames(left.name, right.name));

    for (const entry of entries) {
      const path = join(directory, entry.name);
      const local = relative(root, path);
      if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) {
        throw discoveryError(root, path, "accept path outside source root");
      }
      const metadata = checkedLstat(root, path);
      if (metadata.isSymbolicLink()) {
        throw discoveryError(root, path, "accept symbolic link");
      }
      if (metadata.isDirectory()) {
        walk(path);
      } else if (metadata.isFile() && entry.name.endsWith(".rs")) {
        files.push(path);
        identities.set(path, metadata);
      }
    }

    const after = checkedLstat(root, directory);
    if (!after.isDirectory() || !sameIdentity(before, after)) {
      throw discoveryError(root, directory, "accept directory changed during discovery");
    }
  }

  walk(root);
  for (const path of files) {
    const current = checkedLstat(root, path);
    if (
      !current.isFile() ||
      current.isSymbolicLink() ||
      !sameIdentity(identities.get(path), current)
    ) {
      throw discoveryError(root, path, "accept file changed during discovery");
    }
  }
  return files.sort();
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, stdio: "inherit" });
  if (result.error) {
    throw new Error(`Unable to run ${command}: ${bounded(result.error.message)}`);
  }
  if (result.status !== 0) return result.status ?? 1;
  return 0;
}

function main() {
  const discovered = discoverRustSources(rustSourceRoot);
  const cargoStatus = run("cargo", ["fmt", "--manifest-path", "src-tauri/Cargo.toml", "--check"]);
  if (cargoStatus !== 0) return cargoStatus;

  const verified = discoverRustSources(rustSourceRoot);
  if (
    discovered.length !== verified.length ||
    discovered.some((path, index) => path !== verified[index])
  ) {
    throw new Error("Rust source tree changed during format checking.");
  }
  const sources = verified.map((path) => relative(repositoryRoot, path));
  const rustfmtStatus = run("rustfmt", ["--edition", "2021", "--check", ...sources]);
  if (rustfmtStatus !== 0) return rustfmtStatus;

  console.log(`Rust format check passed for ${sources.length} source file(s).`);
  return 0;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(bounded(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}
