import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
} from "node:fs";
import path from "node:path";

export const MAX_APPLICATION_BUNDLE_ENTRIES = 65_536;
export const MAX_APPLICATION_BUNDLE_FILE_BYTES = 512 * 1024 * 1024;
export const MAX_APPLICATION_BUNDLE_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_APPLICATION_BUNDLE_DEPTH = 64;
export const MAX_APPLICATION_BUNDLE_RELATIVE_PATH_BYTES = 4 * 1024;

const MANIFEST_DOMAIN = "codevo-application-bundle-v1\0";
const READ_BUFFER = Buffer.allocUnsafe(64 * 1024);

export function captureApplicationBundleIdentity(
  bundlePath,
  { entryLimit = MAX_APPLICATION_BUNDLE_ENTRIES } = {},
) {
  if (!path.isAbsolute(bundlePath)) {
    throw new Error("Production application bundle identity requires an absolute path.");
  }
  if (
    !Number.isInteger(entryLimit) ||
    entryLimit <= 0 ||
    entryLimit > MAX_APPLICATION_BUNDLE_ENTRIES
  ) {
    throw new Error("Production application bundle entry limit was rejected.");
  }
  const entries = [];
  const entryBudget = { limit: entryLimit, committed: 0, pending: 0 };
  collectEntry(bundlePath, ".", 0, entries, entryBudget);
  entries.sort((left, right) =>
    Buffer.compare(Buffer.from(left.relative), Buffer.from(right.relative)),
  );

  let fileCount = 0;
  let totalBytes = 0;
  const records = [];
  for (const entry of entries) {
    let contentSha256 = "";
    if (entry.kind === "file") {
      fileCount += 1;
      totalBytes = checkedBundleBytes(totalBytes, entry.size);
      contentSha256 = hashExactRegularFile(entry);
    }
    records.push({
      kind: entry.kind,
      relative: entry.relative,
      dev: entry.dev.toString(),
      ino: entry.ino.toString(),
      uid: entry.uid.toString(),
      gid: entry.gid.toString(),
      mode: entry.mode.toString(),
      ctimeNs: entry.ctimeNs.toString(),
      size: entry.size.toString(),
      contentSha256,
    });
  }
  return Object.freeze({
    schemaVersion: 1,
    digest: digestApplicationBundleManifestRecords(records),
    entryCount: entries.length,
    fileCount,
    totalBytes,
  });
}

export function digestApplicationBundleManifestRecords(records) {
  const aggregate = createHash("sha256").update(MANIFEST_DOMAIN);
  for (const record of records) {
    aggregate
      .update(record.kind)
      .update("\0")
      .update(record.relative)
      .update("\0")
      .update(record.dev)
      .update("\0")
      .update(record.ino)
      .update("\0")
      .update(record.uid)
      .update("\0")
      .update(record.gid)
      .update("\0")
      .update(record.mode)
      .update("\0")
      .update(record.ctimeNs)
      .update("\0")
      .update(record.size)
      .update("\0")
      .update(record.contentSha256)
      .update("\0");
  }
  return aggregate.digest("hex");
}

function collectEntry(absolutePath, relative, depth, entries, entryBudget) {
  if (depth > MAX_APPLICATION_BUNDLE_DEPTH) {
    throw new Error("Production application bundle exceeded its directory depth bound.");
  }
  if (Buffer.byteLength(relative) > MAX_APPLICATION_BUNDLE_RELATIVE_PATH_BYTES) {
    throw new Error("Production application bundle contained an oversized relative path.");
  }
  const metadata = lstatSync(absolutePath, { bigint: true });
  if (metadata.isSymbolicLink()) {
    throw new Error("Production application bundle contained a symbolic link.");
  }
  const kind = metadata.isDirectory() ? "directory" : metadata.isFile() ? "file" : null;
  if (kind === null) {
    throw new Error("Production application bundle contained an unsupported filesystem entry.");
  }
  if (entryBudget.committed + entryBudget.pending >= entryBudget.limit) {
    throw new Error("Production application bundle exceeded its entry-count bound.");
  }
  const size = kind === "file" ? metadata.size : 0n;
  if (size > BigInt(MAX_APPLICATION_BUNDLE_FILE_BYTES)) {
    throw new Error("Production application bundle contained an oversized file.");
  }
  const entry = {
    absolutePath,
    relative,
    kind,
    dev: metadata.dev,
    ino: metadata.ino,
    uid: metadata.uid,
    gid: metadata.gid,
    mode: metadata.mode & 0o7777n,
    ctimeNs: metadata.ctimeNs,
    size,
  };
  entries.push(entry);
  entryBudget.committed += 1;
  if (kind !== "directory") return;
  const names = boundedDirectoryNames(absolutePath, entryBudget);
  for (const nameBytes of names) {
    const name = nameBytes.toString("utf8");
    if (
      !Buffer.from(name, "utf8").equals(nameBytes) ||
      name.length === 0 ||
      name === "." ||
      name === ".." ||
      name.includes("/") ||
      name.includes("\0")
    ) {
      throw new Error("Production application bundle contained an invalid entry name.");
    }
    entryBudget.pending -= 1;
    collectEntry(
      path.join(absolutePath, name),
      relative === "." ? name : `${relative}/${name}`,
      depth + 1,
      entries,
      entryBudget,
    );
  }
  const after = lstatSync(absolutePath, { bigint: true });
  assertSameEntry(entry, after, "changed while enumerating");
}

function boundedDirectoryNames(absolutePath, entryBudget) {
  const directory = opendirSync(absolutePath, { encoding: "buffer", bufferSize: 32 });
  const names = [];
  try {
    for (;;) {
      const child = directory.readSync();
      if (child === null) break;
      if (entryBudget.committed + entryBudget.pending >= entryBudget.limit) {
        throw new Error("Production application bundle exceeded its entry-count bound.");
      }
      entryBudget.pending += 1;
      names.push(child.name);
    }
  } finally {
    directory.closeSync();
  }
  return names.sort(Buffer.compare);
}

function hashExactRegularFile(entry) {
  const descriptor = openSync(entry.absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    assertSameEntry(entry, opened, "changed before opening");
    const hash = createHash("sha256");
    let bytesRead = 0;
    for (;;) {
      const count = readSync(descriptor, READ_BUFFER, 0, READ_BUFFER.length, null);
      if (count === 0) break;
      bytesRead += count;
      if (bytesRead > MAX_APPLICATION_BUNDLE_FILE_BYTES) {
        throw new Error("Production application bundle file exceeded its read bound.");
      }
      hash.update(READ_BUFFER.subarray(0, count));
    }
    const after = fstatSync(descriptor, { bigint: true });
    assertSameEntry(entry, after, "changed while reading");
    const pathAfter = lstatSync(entry.absolutePath, { bigint: true });
    assertSameEntry(entry, pathAfter, "changed at its bundle path while reading");
    if (BigInt(bytesRead) !== entry.size) {
      throw new Error("Production application bundle file changed while reading.");
    }
    return hash.digest("hex");
  } finally {
    closeSync(descriptor);
  }
}

function assertSameEntry(entry, metadata, phase) {
  const typeMatches = entry.kind === "file" ? metadata.isFile() : metadata.isDirectory();
  const size = entry.kind === "file" ? metadata.size : 0n;
  if (
    !typeMatches ||
    metadata.dev !== entry.dev ||
    metadata.ino !== entry.ino ||
    metadata.uid !== entry.uid ||
    metadata.gid !== entry.gid ||
    size !== entry.size ||
    (metadata.mode & 0o7777n) !== entry.mode ||
    metadata.ctimeNs !== entry.ctimeNs
  ) {
    throw new Error(`Production application bundle entry ${phase}.`);
  }
}

function checkedBundleBytes(current, addition) {
  const next = BigInt(current) + addition;
  if (next > BigInt(MAX_APPLICATION_BUNDLE_TOTAL_BYTES)) {
    throw new Error("Production application bundle exceeded its total-byte bound.");
  }
  return Number(next);
}
