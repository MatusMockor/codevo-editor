import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_JSON_DEPTH = 128;
const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

async function readBounded(rootDirectory, relativePath) {
  const path = resolve(rootDirectory, relativePath);
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`${relativePath} is not a regular file`);
  if (metadata.size > MAX_MANIFEST_BYTES) throw new Error(`${relativePath} exceeds the size limit`);
  const source = await readFile(path, "utf8");
  if (Buffer.byteLength(source, "utf8") > MAX_MANIFEST_BYTES) {
    throw new Error(`${relativePath} exceeds the size limit`);
  }
  return source;
}

function requireVersion(value, source) {
  if (typeof value !== "string") throw new Error(`${source} version must be a string`);
  const match = value.match(VERSION_PATTERN);
  if (!match) throw new Error(`${source} has a malformed semantic version`);
  const prereleaseIdentifiers = match[4]?.split(".") ?? [];
  if (prereleaseIdentifiers.some((identifier) => /^0\d+$/.test(identifier))) {
    throw new Error(`${source} has a malformed semantic version`);
  }
  return value;
}

function parseJson(source, relativePath) {
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(`${relativePath} is not valid JSON`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${relativePath} must contain a JSON object`);
  }
  rejectDuplicateJsonKeys(source, relativePath);
  return value;
}

function rejectDuplicateJsonKeys(source, relativePath) {
  let index = 0;
  const skipWhitespace = () => {
    while (/\s/.test(source[index] ?? "")) index += 1;
  };
  const parseString = () => {
    const start = index;
    index += 1;
    while (index < source.length) {
      if (source[index] === "\\") {
        index += 2;
        continue;
      }
      if (source[index] === '"') {
        index += 1;
        return JSON.parse(source.slice(start, index));
      }
      index += 1;
    }
    throw new Error(`${relativePath} contains an unterminated JSON string`);
  };
  const parseValue = (depth) => {
    if (depth > MAX_JSON_DEPTH) throw new Error(`${relativePath} exceeds the JSON depth limit`);
    skipWhitespace();
    if (source[index] === '"') {
      parseString();
      return;
    }
    if (source[index] === "[") {
      index += 1;
      skipWhitespace();
      while (source[index] !== "]") {
        parseValue(depth + 1);
        skipWhitespace();
        if (source[index] !== ",") break;
        index += 1;
        skipWhitespace();
      }
      index += 1;
      return;
    }
    if (source[index] === "{") {
      index += 1;
      skipWhitespace();
      const keys = new Set();
      while (source[index] !== "}") {
        const key = parseString();
        if (keys.has(key)) {
          throw new Error(`${relativePath} contains duplicate key ${JSON.stringify(key)}`);
        }
        keys.add(key);
        skipWhitespace();
        index += 1;
        parseValue(depth + 1);
        skipWhitespace();
        if (source[index] !== ",") break;
        index += 1;
        skipWhitespace();
      }
      index += 1;
      return;
    }
    while (index < source.length && !/[\s,}\]]/.test(source[index])) index += 1;
  };
  parseValue(0);
}

function parseCargoPackageVersion(source, relativePath) {
  const packageSection = source.match(/(?:^|\n)\[package\]\r?\n([\s\S]*?)(?=\r?\n\[|$)/g);
  if (packageSection?.length !== 1)
    throw new Error(`${relativePath} must contain one package section`);
  const versions = Array.from(packageSection[0].matchAll(/^version\s*=\s*"([^"]*)"\s*$/gm));
  if (versions.length !== 1) throw new Error(`${relativePath} package version is ambiguous`);
  return requireVersion(versions[0][1], relativePath);
}

function parseCargoLockVersion(source, relativePath) {
  const packages = source.split(/^\[\[package\]\]\s*$/m).slice(1);
  const matches = packages.flatMap((entry) => {
    const name = entry.match(/^name\s*=\s*"([^"]*)"\s*$/m)?.[1];
    if (name !== "codevo-editor") return [];
    const versions = Array.from(entry.matchAll(/^version\s*=\s*"([^"]*)"\s*$/gm));
    if (versions.length !== 1)
      throw new Error(`${relativePath} Codevo package version is ambiguous`);
    return [requireVersion(versions[0][1], relativePath)];
  });
  if (matches.length !== 1) throw new Error(`${relativePath} must contain one Codevo package`);
  return matches[0];
}

export async function inspectVersionSync(rootDirectory) {
  const [packageSource, packageLockSource, cargoSource, cargoLockSource, tauriSource] =
    await Promise.all([
      readBounded(rootDirectory, "package.json"),
      readBounded(rootDirectory, "package-lock.json"),
      readBounded(rootDirectory, "src-tauri/Cargo.toml"),
      readBounded(rootDirectory, "src-tauri/Cargo.lock"),
      readBounded(rootDirectory, "src-tauri/tauri.conf.json"),
    ]);
  const packageManifest = parseJson(packageSource, "package.json");
  const packageLock = parseJson(packageLockSource, "package-lock.json");
  const tauriConfig = parseJson(tauriSource, "src-tauri/tauri.conf.json");
  const rootLockPackage = packageLock.packages?.[""];
  if (
    rootLockPackage === null ||
    typeof rootLockPackage !== "object" ||
    Array.isArray(rootLockPackage)
  ) {
    throw new Error('package-lock.json must contain the root package at packages[""]');
  }
  const authority = requireVersion(packageManifest.version, "package.json");
  const versions = [
    ["package-lock.json", requireVersion(packageLock.version, "package-lock.json")],
    [
      'package-lock.json packages[""]',
      requireVersion(rootLockPackage.version, 'package-lock.json packages[""]'),
    ],
    ["src-tauri/Cargo.toml", parseCargoPackageVersion(cargoSource, "src-tauri/Cargo.toml")],
    ["src-tauri/Cargo.lock", parseCargoLockVersion(cargoLockSource, "src-tauri/Cargo.lock")],
    ["src-tauri/tauri.conf.json", requireVersion(tauriConfig.version, "src-tauri/tauri.conf.json")],
  ];
  const mismatch = versions.find(([, version]) => version !== authority);
  if (mismatch) {
    throw new Error(
      `${mismatch[0]} version ${mismatch[1]} does not match package.json ${authority}`,
    );
  }
  return authority;
}

async function main() {
  try {
    const version = await inspectVersionSync(process.cwd());
    process.stdout.write(`Version manifests are synchronized at ${version}\n`);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown version synchronization error";
    process.stderr.write(`Version sync check failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
