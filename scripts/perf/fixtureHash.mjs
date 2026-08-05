import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

export const DEFAULT_FIXTURE_TREE_LIMITS = Object.freeze({
  maxFiles: 10_000,
  maxDirectories: 5_000,
  maxEntries: 20_000,
  maxEntriesPerDirectory: 10_000,
  maxDepth: 32,
  maxTotalBytes: 128 * 1024 * 1024,
  maxFileBytes: 16 * 1024 * 1024,
  maxRelativePathBytes: 1_024,
});

function assertPositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return value;
}

function normalizeLimits(overrides = {}) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(DEFAULT_FIXTURE_TREE_LIMITS).map(([name, fallback]) => [
        name,
        assertPositiveInteger(overrides[name] ?? fallback, name),
      ]),
    ),
  );
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function canonicalExistingDirectory(rootDir) {
  const rootStat = lstatSync(rootDir);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("Fixture root must be a real directory, not a symlink or special file.");
  }
  return realpathSync(rootDir);
}

function normalizeExcludedDirectoryNames(names) {
  if (!Array.isArray(names)) {
    throw new Error("excludedDirectoryNames must be an array.");
  }
  const result = new Set();
  for (const name of names) {
    if (
      typeof name !== "string" ||
      name.length === 0 ||
      name === "." ||
      name === ".." ||
      name.includes("/") ||
      name.includes("\\")
    ) {
      throw new Error("Excluded directory names must be single, non-empty path segments.");
    }
    result.add(name);
  }
  return result;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function collectFiles(canonicalRoot, relativeDir, depth, state) {
  if (depth > state.limits.maxDepth) {
    throw new Error(`Fixture tree exceeds maxDepth (${state.limits.maxDepth}).`);
  }

  const absoluteDir = path.join(canonicalRoot, relativeDir);
  const canonicalDir = realpathSync(absoluteDir);
  if (!isWithin(canonicalRoot, canonicalDir)) {
    throw new Error("Fixture directory escapes its canonical root.");
  }

  const entries = [];
  const directory = opendirSync(absoluteDir);
  try {
    for (
      let directoryEntry = directory.readSync();
      directoryEntry;
      directoryEntry = directory.readSync()
    ) {
      state.entryCount += 1;
      if (state.entryCount > state.limits.maxEntries) {
        throw new Error(`Fixture tree exceeds maxEntries (${state.limits.maxEntries}).`);
      }
      if (entries.length >= state.limits.maxEntriesPerDirectory) {
        throw new Error(
          `Fixture directory exceeds maxEntriesPerDirectory (${state.limits.maxEntriesPerDirectory}).`,
        );
      }
      entries.push(directoryEntry.name);
    }
  } finally {
    directory.closeSync();
  }
  entries.sort(compareUtf8);

  for (const entry of entries) {
    const relativePath = relativeDir === "" ? entry : `${relativeDir}/${entry}`;
    if (Buffer.byteLength(relativePath, "utf8") > state.limits.maxRelativePathBytes) {
      throw new Error(
        `Fixture path exceeds maxRelativePathBytes (${state.limits.maxRelativePathBytes}).`,
      );
    }

    const absolutePath = path.join(canonicalRoot, ...relativePath.split("/"));
    const entryStat = lstatSync(absolutePath);
    if (entryStat.isSymbolicLink()) {
      throw new Error(`Fixture entry is a symbolic link: ${relativePath}`);
    }
    if (entryStat.isDirectory()) {
      if (!state.excludedDirectoryNames.has(entry)) {
        if (state.directories.length >= state.limits.maxDirectories) {
          throw new Error(`Fixture tree exceeds maxDirectories (${state.limits.maxDirectories}).`);
        }
        state.directories.push(relativePath);
        collectFiles(canonicalRoot, relativePath, depth + 1, state);
      }
      continue;
    }
    if (!entryStat.isFile()) {
      throw new Error(`Fixture entry is not a regular file: ${relativePath}`);
    }
    if (entryStat.size > state.limits.maxFileBytes) {
      throw new Error(`Fixture file exceeds maxFileBytes (${state.limits.maxFileBytes}).`);
    }
    if (state.files.length >= state.limits.maxFiles) {
      throw new Error(`Fixture tree exceeds maxFiles (${state.limits.maxFiles}).`);
    }
    state.totalBytes += entryStat.size;
    if (state.totalBytes > state.limits.maxTotalBytes) {
      throw new Error(`Fixture tree exceeds maxTotalBytes (${state.limits.maxTotalBytes}).`);
    }

    const canonicalFile = realpathSync(absolutePath);
    if (!isWithin(canonicalRoot, canonicalFile)) {
      throw new Error(`Fixture file escapes its canonical root: ${relativePath}`);
    }
    state.files.push({
      absolutePath: canonicalFile,
      device: entryStat.dev,
      inode: entryStat.ino,
      relativePath,
      size: entryStat.size,
    });
  }
}

function readCapturedRegularFile(file) {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const descriptor = openSync(file.absolutePath, constants.O_RDONLY | noFollow);
  try {
    const openedStat = fstatSync(descriptor);
    if (
      !openedStat.isFile() ||
      openedStat.dev !== file.device ||
      openedStat.ino !== file.inode ||
      openedStat.size !== file.size
    ) {
      throw new Error(`Fixture changed while it was being opened: ${file.relativePath}`);
    }
    const contents = Buffer.allocUnsafe(file.size);
    let offset = 0;
    while (offset < contents.byteLength) {
      const bytesRead = readSync(
        descriptor,
        contents,
        offset,
        contents.byteLength - offset,
        offset,
      );
      if (bytesRead === 0) {
        throw new Error(`Fixture changed while it was being read: ${file.relativePath}`);
      }
      offset += bytesRead;
    }
    const overflowProbe = Buffer.allocUnsafe(1);
    if (readSync(descriptor, overflowProbe, 0, 1, offset) !== 0) {
      throw new Error(`Fixture grew while it was being read: ${file.relativePath}`);
    }
    const finalStat = fstatSync(descriptor);
    if (
      finalStat.dev !== file.device ||
      finalStat.ino !== file.inode ||
      finalStat.size !== file.size
    ) {
      throw new Error(`Fixture changed while it was being read: ${file.relativePath}`);
    }
    return contents;
  } finally {
    closeSync(descriptor);
  }
}

export function canonicalFixtureDigest(hashes, directories = []) {
  const digest = createHash("sha256");
  for (const relativePath of [...directories].sort(compareUtf8)) {
    digest.update(`D:${Buffer.byteLength(relativePath, "utf8")}:${relativePath}\n`);
  }
  for (const [relativePath, fileDigest] of Object.entries(hashes ?? {}).sort(([left], [right]) =>
    compareUtf8(left, right),
  )) {
    digest.update(
      `F:${Buffer.byteLength(relativePath, "utf8")}:${relativePath}:sha256:${fileDigest}\n`,
    );
  }
  return digest.digest("hex");
}

export function computeFixtureManifest(
  rootDir,
  { excludedDirectoryNames = [], limits: limitOverrides = {} } = {},
) {
  const canonicalRoot = canonicalExistingDirectory(rootDir);
  const state = {
    directories: [],
    entryCount: 0,
    excludedDirectoryNames: normalizeExcludedDirectoryNames(excludedDirectoryNames),
    files: [],
    limits: normalizeLimits(limitOverrides),
    totalBytes: 0,
  };
  collectFiles(canonicalRoot, "", 0, state);

  const hashEntries = [];
  for (const file of state.files) {
    const contents = readCapturedRegularFile(file);
    if (contents.byteLength !== file.size) {
      throw new Error(`Fixture changed while it was being read: ${file.relativePath}`);
    }
    hashEntries.push([file.relativePath, createHash("sha256").update(contents).digest("hex")]);
  }
  const hashes = Object.fromEntries(hashEntries);

  return Object.freeze({
    algorithm: "sha256",
    aggregateDigest: canonicalFixtureDigest(hashes, state.directories),
    directories: Object.freeze(state.directories),
    directoryCount: state.directories.length,
    fileCount: state.files.length,
    totalBytes: state.totalBytes,
    hashes: Object.freeze(hashes),
  });
}

export function computeFixtureHashes(rootDir, options) {
  return computeFixtureManifest(rootDir, options).hashes;
}

export function fixtureHashFenceFailure(before, after) {
  return canonicalFixtureDigest(before) === canonicalFixtureDigest(after)
    ? null
    : "Performance fixtures changed while the measurement was running; the run is invalid.";
}
