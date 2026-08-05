import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_FIXTURE_TREE_LIMITS, computeFixtureManifest } from "./fixtureHash.mjs";

const SNAPSHOT_PREFIX = "codevo-perf-fixture-";
const OWNERSHIP_FILE = ".codevo-perf-snapshot-owner.json";
const WORK_DIRECTORY = "work";

export const PERF_FIXTURE_EXCLUDED_DIRECTORIES = Object.freeze([
  ".git",
  ".cache",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
]);

function isDirectChild(parent, candidate) {
  return path.dirname(candidate) === parent && path.basename(candidate).startsWith(SNAPSHOT_PREFIX);
}

function assertRealDirectory(directory, label) {
  const entry = lstatSync(directory);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error(`${label} must be a real directory.`);
  }
  return realpathSync(directory);
}

function portableMetadata(manifest) {
  return Object.freeze({
    schemaVersion: 1,
    algorithm: manifest.algorithm,
    digest: manifest.aggregateDigest,
    directoryCount: manifest.directoryCount,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
  });
}

function readOwnershipMarker(markerPath, markerStat) {
  const maxMarkerBytes = 1_024;
  if (markerStat.size > maxMarkerBytes) {
    throw new Error("Refusing to clean a snapshot with an oversized ownership marker.");
  }
  const descriptor = openSync(markerPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const openedStat = fstatSync(descriptor);
    if (
      !openedStat.isFile() ||
      openedStat.dev !== markerStat.dev ||
      openedStat.ino !== markerStat.ino ||
      openedStat.size !== markerStat.size
    ) {
      throw new Error("Refusing to clean a snapshot with a replaced ownership marker.");
    }
    const contents = Buffer.allocUnsafe(markerStat.size);
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
        throw new Error("Refusing to clean a snapshot with a truncated ownership marker.");
      }
      offset += bytesRead;
    }
    const overflowProbe = Buffer.allocUnsafe(1);
    if (readSync(descriptor, overflowProbe, 0, 1, offset) !== 0) {
      throw new Error("Refusing to clean a snapshot with a growing ownership marker.");
    }
    return contents.toString("utf8");
  } finally {
    closeSync(descriptor);
  }
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function readSourceFile(canonicalSourceRoot, relativePath, expectedDigest) {
  const sourcePath = path.join(canonicalSourceRoot, ...relativePath.split("/"));
  const sourceStat = lstatSync(sourcePath);
  if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
    throw new Error(`Fixture source stopped being a regular file: ${relativePath}`);
  }
  const canonicalSourcePath = realpathSync(sourcePath);
  if (!isWithin(canonicalSourceRoot, canonicalSourcePath)) {
    throw new Error(`Fixture source escapes its canonical root: ${relativePath}`);
  }
  const descriptor = openSync(
    canonicalSourcePath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const openedStat = fstatSync(descriptor);
    if (
      !openedStat.isFile() ||
      openedStat.dev !== sourceStat.dev ||
      openedStat.ino !== sourceStat.ino ||
      openedStat.size !== sourceStat.size
    ) {
      throw new Error(`Fixture source changed while it was opened: ${relativePath}`);
    }
    const contents = Buffer.allocUnsafe(sourceStat.size);
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
        throw new Error(`Fixture source changed while it was read: ${relativePath}`);
      }
      offset += bytesRead;
    }
    const overflowProbe = Buffer.allocUnsafe(1);
    if (readSync(descriptor, overflowProbe, 0, 1, offset) !== 0) {
      throw new Error(`Fixture source grew while it was read: ${relativePath}`);
    }
    const finalStat = fstatSync(descriptor);
    if (
      finalStat.dev !== sourceStat.dev ||
      finalStat.ino !== sourceStat.ino ||
      finalStat.size !== sourceStat.size
    ) {
      throw new Error(`Fixture source changed while it was read: ${relativePath}`);
    }
    const digest = createHash("sha256").update(contents).digest("hex");
    if (digest !== expectedDigest) {
      throw new Error(`Fixture source changed while the snapshot was copied: ${relativePath}`);
    }
    return contents;
  } finally {
    closeSync(descriptor);
  }
}

function safeCleanupOwnedRoot(snapshot) {
  const parent = assertRealDirectory(snapshot.temporaryParent, "Snapshot temporary parent");
  const rootStat = lstatSync(snapshot.ownedRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("Refusing to clean a snapshot root that is not a real directory.");
  }
  if (rootStat.dev !== snapshot.ownedRootDevice || rootStat.ino !== snapshot.ownedRootInode) {
    throw new Error("Refusing to clean a replaced snapshot root.");
  }
  const root = realpathSync(snapshot.ownedRoot);
  if (root !== snapshot.ownedRoot || !isDirectChild(parent, root)) {
    throw new Error("Refusing to clean a snapshot outside its exact owned temporary root.");
  }
  const markerPath = path.join(root, OWNERSHIP_FILE);
  let markerStat;
  try {
    markerStat = lstatSync(markerPath);
  } catch {
    throw new Error("Refusing to clean a snapshot without a regular ownership marker.");
  }
  if (markerStat.isSymbolicLink() || !markerStat.isFile()) {
    throw new Error("Refusing to clean a snapshot without a regular ownership marker.");
  }
  let marker;
  try {
    marker = JSON.parse(readOwnershipMarker(markerPath, markerStat));
  } catch {
    throw new Error("Refusing to clean a snapshot with an invalid ownership marker.");
  }
  if (marker?.schemaVersion !== 1 || marker?.token !== snapshot.ownershipToken) {
    throw new Error("Refusing to clean a snapshot owned by another run.");
  }
  rmSync(root, { recursive: true, force: false });
}

export function cleanupPerfFixtureSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("A snapshot ownership record is required for cleanup.");
  }
  safeCleanupOwnedRoot(snapshot);
}

export function verifyPerfFixtureSnapshot(snapshot) {
  const after = computeFixtureManifest(snapshot.fixtureRoot, {
    limits: snapshot.limits,
  });
  const failure =
    snapshot.digestBefore === after.aggregateDigest
      ? null
      : "Performance fixtures changed while the measurement was running; the run is invalid.";
  return Object.freeze({
    failure,
    metadata: portableMetadata(after),
  });
}

export function createPerfFixtureSnapshot(
  sourceFixtureRoot,
  { temporaryParent = os.tmpdir(), limits = DEFAULT_FIXTURE_TREE_LIMITS } = {},
) {
  const canonicalTemporaryParent = assertRealDirectory(
    temporaryParent,
    "Snapshot temporary parent",
  );
  const canonicalSourceRoot = assertRealDirectory(sourceFixtureRoot, "Source fixture root");
  const sourceManifest = computeFixtureManifest(canonicalSourceRoot, {
    excludedDirectoryNames: PERF_FIXTURE_EXCLUDED_DIRECTORIES,
    limits,
  });
  const ownedRoot = realpathSync(mkdtempSync(path.join(canonicalTemporaryParent, SNAPSHOT_PREFIX)));
  const ownedRootStat = lstatSync(ownedRoot);
  const workRoot = path.join(ownedRoot, WORK_DIRECTORY);
  const fixtureRoot = path.join(workRoot, "perf", "fixtures");
  const ownershipToken = randomUUID();
  const snapshot = Object.freeze({
    fixtureRoot,
    digestBefore: sourceManifest.aggregateDigest,
    hashesBefore: sourceManifest.hashes,
    limits: Object.freeze({ ...DEFAULT_FIXTURE_TREE_LIMITS, ...limits }),
    metadata: portableMetadata(sourceManifest),
    ownedRoot,
    ownedRootDevice: ownedRootStat.dev,
    ownedRootInode: ownedRootStat.ino,
    ownershipToken,
    temporaryParent: canonicalTemporaryParent,
    workRoot,
  });

  try {
    writeFileSync(
      path.join(ownedRoot, OWNERSHIP_FILE),
      `${JSON.stringify({ schemaVersion: 1, token: ownershipToken })}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    mkdirSync(fixtureRoot, { recursive: true, mode: 0o700 });
    for (const relativePath of sourceManifest.directories) {
      mkdirSync(path.join(fixtureRoot, ...relativePath.split("/")), {
        recursive: true,
        mode: 0o700,
      });
    }
    for (const [relativePath, expectedDigest] of Object.entries(sourceManifest.hashes)) {
      const destinationPath = path.join(fixtureRoot, ...relativePath.split("/"));
      mkdirSync(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
      writeFileSync(
        destinationPath,
        readSourceFile(canonicalSourceRoot, relativePath, expectedDigest),
        { flag: "wx", mode: 0o600 },
      );
    }
    const verification = verifyPerfFixtureSnapshot(snapshot);
    if (verification.failure !== null) {
      throw new Error(verification.failure);
    }
    return snapshot;
  } catch (error) {
    try {
      safeCleanupOwnedRoot(snapshot);
    } catch {
      // Preserve the original creation failure. Cleanup remains fail-closed.
    }
    throw error;
  }
}
