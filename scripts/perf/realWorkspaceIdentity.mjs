import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
} from "node:fs";
import { createHmac } from "node:crypto";
import path from "node:path";

export const REAL_WORKSPACE_IDENTITY_VERSION = "real-workspace-hmac-v1";
export const REAL_WORKSPACE_IDENTITY_SCOPE =
  "included-tree-excluding-generated-and-cache-directories";
export const REAL_WORKSPACE_TRAVERSAL_AUTHORITY =
  "best-effort-revalidation-on-non-adversarial-local-host";

export const REAL_WORKSPACE_EXCLUDED_DIRECTORIES = Object.freeze([
  ".git",
  ".hg",
  ".idea",
  ".svn",
  ".turbo",
  ".yarn",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

export const DEFAULT_REAL_WORKSPACE_IDENTITY_LIMITS = Object.freeze({
  maxBytes: 512 * 1024 * 1024,
  maxDepth: 64,
  maxDirectories: 20_000,
  maxFiles: 50_000,
  maxPathBytes: 4_096,
});

const MINIMUM_HMAC_KEY_BYTES = 32;
const READ_CHUNK_BYTES = 64 * 1024;
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const FORBIDDEN_PERSISTED_KEYS = new Set([
  "branch",
  "commit",
  "fileHashes",
  "gitRemote",
  "path",
  "perFileHashes",
  "query",
  "remote",
  "root",
  "source",
  "symbol",
]);

export function captureRealWorkspaceIdentity({
  root,
  hmacKey,
  dirty,
  limits = DEFAULT_REAL_WORKSPACE_IDENTITY_LIMITS,
  readChunk = readSync,
}) {
  const normalizedRoot = normalizedAbsoluteRoot(root);
  const key = normalizedHmacKey(hmacKey);
  const normalizedLimits = normalizedIdentityLimits(limits);
  const rootStat = lstatSync(normalizedRoot, { bigint: true });

  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("Real-workspace identity root must be a non-symlink directory.");
  }

  if (typeof dirty !== "boolean") {
    throw new Error("Real-workspace dirty status must be a boolean.");
  }

  const hmac = createHmac("sha256", key);
  const state = { directoryCount: 1, fileCount: 0, totalBytes: 0 };
  writeFrame(hmac, "identity-version", REAL_WORKSPACE_IDENTITY_VERSION);
  writeFrame(hmac, "identity-scope", REAL_WORKSPACE_IDENTITY_SCOPE);
  writeStatAuthority(hmac, "root-authority", rootStat);
  walkDirectory(
    normalizedRoot,
    "",
    0,
    rootStat,
    hmac,
    state,
    normalizedLimits,
    normalizedReadChunk(readChunk),
  );
  assertSameDirectory(rootStat, lstatSync(normalizedRoot, { bigint: true }), "workspace root");

  return Object.freeze({
    identityVersion: REAL_WORKSPACE_IDENTITY_VERSION,
    identityScope: REAL_WORKSPACE_IDENTITY_SCOPE,
    traversalAuthority: REAL_WORKSPACE_TRAVERSAL_AUTHORITY,
    workspaceIdentity: hmac.digest("hex"),
    directoryCount: state.directoryCount,
    fileCount: state.fileCount,
    totalBytes: state.totalBytes,
    dirty,
  });
}

export function persistedRealWorkspaceIdentity(snapshot) {
  assertIdentitySnapshot(snapshot);

  const persisted = Object.freeze({
    identityVersion: snapshot.identityVersion,
    identityScope: snapshot.identityScope,
    traversalAuthority: snapshot.traversalAuthority,
    workspaceIdentity: snapshot.workspaceIdentity,
    directoryCount: snapshot.directoryCount,
    fileCount: snapshot.fileCount,
    totalBytes: snapshot.totalBytes,
    dirty: snapshot.dirty,
  });

  assertNoForbiddenPersistedKeys(persisted);
  return persisted;
}

export function realWorkspaceIdentityFenceFailure(before, after) {
  try {
    assertIdentitySnapshot(before);
    assertIdentitySnapshot(after);
  } catch {
    return "Real workspace identity fence is missing or malformed; the run is invalid.";
  }

  const fields = [
    "identityVersion",
    "identityScope",
    "traversalAuthority",
    "workspaceIdentity",
    "directoryCount",
    "fileCount",
    "totalBytes",
    "dirty",
  ];

  return fields.every((field) => before[field] === after[field])
    ? null
    : "Real workspace included-tree content, root identity, or dirty status changed while measuring; the run is invalid.";
}

export function createOpaqueTargetDescriptors({ hmacKey, workspaceIdentity, targets }) {
  const key = normalizedHmacKey(hmacKey);
  assertWorkspaceIdentity(workspaceIdentity);

  if (!Array.isArray(targets) || targets.length === 0 || targets.length > 100) {
    throw new Error("Opaque targets must be a non-empty array with at most 100 entries.");
  }

  const normalized = targets.map(normalizedPrivateTarget).sort(comparePrivateTargets);
  const duplicate = normalized.find(
    (target, index) => index > 0 && comparePrivateTargets(target, normalized[index - 1]) === 0,
  );

  if (duplicate) {
    throw new Error("Opaque target locators must be unique.");
  }

  return Object.freeze(
    normalized.map((target, index) => {
      const hmac = createHmac("sha256", key);
      writeFrame(hmac, "workspace", workspaceIdentity);
      writeFrame(hmac, "kind", target.kind);
      writeFrame(hmac, "relative-path", target.relativePath);
      writeFrame(hmac, "line", String(target.line));
      writeFrame(hmac, "column", String(target.column));

      return opaqueDescriptor(key, workspaceIdentity, "target", index, hmac.digest("hex"));
    }),
  );
}

export function createOpaquePrivateValueDescriptors({ hmacKey, workspaceIdentity, kind, values }) {
  const key = normalizedHmacKey(hmacKey);
  assertWorkspaceIdentity(workspaceIdentity);

  if (!new Set(["query", "symbol"]).has(kind)) {
    throw new Error('Opaque private value kind must be "query" or "symbol".');
  }

  if (!Array.isArray(values) || values.length === 0 || values.length > 100) {
    throw new Error("Opaque private values must be a non-empty array with at most 100 entries.");
  }

  const normalized = values.map((value) => {
    if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > 4_096) {
      throw new Error("Opaque private values must be non-empty strings of at most 4096 bytes.");
    }
    return value;
  });

  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Opaque private values must be unique.");
  }

  return Object.freeze(
    [...normalized].sort(bytewiseCompare).map((value, index) => {
      const hmac = createHmac("sha256", key);
      writeFrame(hmac, "workspace", workspaceIdentity);
      writeFrame(hmac, "kind", kind);
      writeFrame(hmac, "private-value", value);

      return opaqueDescriptor(key, workspaceIdentity, kind, index, hmac.digest("hex"));
    }),
  );
}

export function assertOpaqueDescriptorBindings({ hmacKey, workspaceIdentity, kind, descriptors }) {
  const key = normalizedHmacKey(hmacKey);
  assertWorkspaceIdentity(workspaceIdentity);

  if (!new Set(["query", "symbol", "target"]).has(kind)) {
    throw new Error("Opaque descriptor binding kind is invalid.");
  }
  if (!Array.isArray(descriptors) || descriptors.length === 0 || descriptors.length > 100) {
    throw new Error("Opaque descriptor binding set must contain between 1 and 100 entries.");
  }

  for (const descriptor of descriptors) {
    if (
      !descriptor ||
      typeof descriptor !== "object" ||
      Array.isArray(descriptor) ||
      JSON.stringify(Object.keys(descriptor).sort()) !==
        JSON.stringify(["fingerprint", "id", "workspaceBinding"])
    ) {
      throw new Error("Opaque descriptor must contain only id, fingerprint, and workspaceBinding.");
    }
    const prefix = kind === "target" ? "target" : kind;
    if (
      typeof descriptor.id !== "string" ||
      !new RegExp(`^${prefix}-[0-9]{3}$`).test(descriptor.id)
    ) {
      throw new Error("Opaque descriptor id is invalid.");
    }
    assertWorkspaceIdentity(descriptor.fingerprint);
    assertWorkspaceIdentity(descriptor.workspaceBinding);
    const expected = opaqueDescriptorBinding(
      key,
      workspaceIdentity,
      kind,
      descriptor.id,
      descriptor.fingerprint,
    );
    if (descriptor.workspaceBinding !== expected) {
      throw new Error("Opaque descriptor is not bound to this workspace identity.");
    }
  }

  return true;
}

function walkDirectory(
  root,
  relativeDirectory,
  depth,
  expectedDirectoryStat,
  hmac,
  state,
  limits,
  readChunk,
) {
  if (depth > limits.maxDepth) {
    throw new Error(`Real-workspace identity exceeded maxDepth (${limits.maxDepth}).`);
  }

  const absoluteDirectory =
    relativeDirectory.length === 0 ? root : path.join(root, relativeDirectory);
  assertSameDirectory(
    expectedDirectoryStat,
    lstatSync(absoluteDirectory, { bigint: true }),
    relativeDirectory || "workspace root",
  );
  const entries = readdirSync(absoluteDirectory).sort(bytewiseCompare);

  for (const name of entries) {
    const relativePath = relativeDirectory.length === 0 ? name : `${relativeDirectory}/${name}`;
    assertRelativePathBound(relativePath, limits.maxPathBytes);
    const absolutePath = path.join(root, ...relativePath.split("/"));
    const stat = lstatSync(absolutePath, { bigint: true });

    if (stat.isSymbolicLink()) {
      throw new Error(`Real-workspace identity refuses symbolic links: ${relativePath}`);
    }

    if (stat.isDirectory()) {
      if (REAL_WORKSPACE_EXCLUDED_DIRECTORIES.includes(name)) {
        continue;
      }

      state.directoryCount += 1;
      if (state.directoryCount > limits.maxDirectories) {
        throw new Error(
          `Real-workspace identity exceeded maxDirectories (${limits.maxDirectories}).`,
        );
      }
      writeFrame(hmac, "directory", relativePath);
      writeStatAuthority(hmac, "directory-authority", stat);
      walkDirectory(root, relativePath, depth + 1, stat, hmac, state, limits, readChunk);
      continue;
    }

    if (!stat.isFile()) {
      throw new Error(`Real-workspace identity refuses special files: ${relativePath}`);
    }

    state.fileCount += 1;
    if (state.fileCount > limits.maxFiles) {
      throw new Error(`Real-workspace identity exceeded maxFiles (${limits.maxFiles}).`);
    }

    const byteLength = safeBigIntToNumber(stat.size, `file size for ${relativePath}`);
    if (state.totalBytes + byteLength > limits.maxBytes) {
      throw new Error(`Real-workspace identity exceeded maxBytes (${limits.maxBytes}).`);
    }

    writeFrame(hmac, "file-path", relativePath);
    writeStatAuthority(hmac, "file-authority", stat);
    writeFrame(hmac, "file-size", String(byteLength));
    state.totalBytes += readStableRegularFileIntoHmac({
      absolutePath,
      initialStat: stat,
      relativePath,
      hmac,
      remainingBytes: limits.maxBytes - state.totalBytes,
      readChunk,
    });
  }

  assertSameDirectory(
    expectedDirectoryStat,
    lstatSync(absoluteDirectory, { bigint: true }),
    relativeDirectory || "workspace root",
  );
}

function readStableRegularFileIntoHmac({
  absolutePath,
  initialStat,
  relativePath,
  hmac,
  remainingBytes,
  readChunk,
}) {
  const descriptor = openSync(absolutePath, constants.O_RDONLY | O_NOFOLLOW);

  try {
    const openedStat = fstatSync(descriptor, { bigint: true });
    assertSameRegularFile(initialStat, openedStat, relativePath);
    const expectedBytes = safeBigIntToNumber(openedStat.size, `file size for ${relativePath}`);
    const length = Buffer.allocUnsafe(8);
    length.writeBigUInt64BE(BigInt(expectedBytes));
    hmac.update(Buffer.from("file-content", "utf8"));
    hmac.update(Buffer.from([0]));
    hmac.update(length);

    const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remainingBytes + 1));
    let totalRead = 0;
    while (true) {
      const allowed = Math.min(buffer.byteLength, remainingBytes - totalRead + 1);
      if (allowed <= 0) {
        throw new Error(`Real-workspace identity exceeded maxBytes while reading ${relativePath}.`);
      }
      const bytesRead = readChunk(descriptor, buffer, 0, allowed, null);
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > allowed) {
        throw new Error("Real-workspace identity reader returned an invalid byte count.");
      }
      if (bytesRead === 0) break;
      totalRead += bytesRead;
      if (totalRead > remainingBytes) {
        throw new Error(`Real-workspace identity exceeded maxBytes while reading ${relativePath}.`);
      }
      hmac.update(buffer.subarray(0, bytesRead));
    }

    const finalStat = fstatSync(descriptor, { bigint: true });
    assertSameRegularFile(openedStat, finalStat, relativePath);

    if (BigInt(totalRead) !== finalStat.size || totalRead !== expectedBytes) {
      throw new Error(`Real-workspace file changed while hashing: ${relativePath}`);
    }

    return totalRead;
  } finally {
    closeSync(descriptor);
  }
}

function assertSameRegularFile(expected, actual, relativePath) {
  if (
    !actual.isFile() ||
    actual.dev !== expected.dev ||
    actual.ino !== expected.ino ||
    actual.size !== expected.size ||
    actual.mtimeNs !== expected.mtimeNs ||
    actual.ctimeNs !== expected.ctimeNs
  ) {
    throw new Error(`Real-workspace file changed while hashing: ${relativePath}`);
  }
}

function assertSameDirectory(expected, actual, relativePath) {
  if (
    !actual.isDirectory() ||
    actual.dev !== expected.dev ||
    actual.ino !== expected.ino ||
    actual.mtimeNs !== expected.mtimeNs ||
    actual.ctimeNs !== expected.ctimeNs
  ) {
    throw new Error(`Real-workspace directory authority changed while hashing: ${relativePath}`);
  }
}

function normalizedAbsoluteRoot(root) {
  if (typeof root !== "string" || root.length === 0 || root.includes("\0")) {
    throw new Error("Real-workspace identity root must be a non-empty absolute path.");
  }

  if (!path.isAbsolute(root)) {
    throw new Error("Real-workspace identity root must be an absolute path.");
  }

  return path.resolve(root);
}

function normalizedHmacKey(hmacKey) {
  const key =
    typeof hmacKey === "string"
      ? Buffer.from(hmacKey, "utf8")
      : hmacKey instanceof Uint8Array
        ? Buffer.from(hmacKey)
        : null;

  if (!key || key.byteLength < MINIMUM_HMAC_KEY_BYTES) {
    throw new Error(
      `Real-workspace HMAC key must contain at least ${MINIMUM_HMAC_KEY_BYTES} bytes.`,
    );
  }

  return key;
}

function normalizedReadChunk(readChunk) {
  if (typeof readChunk !== "function") {
    throw new Error("Real-workspace identity readChunk must be a function.");
  }
  return readChunk;
}

function normalizedIdentityLimits(limits) {
  if (!limits || typeof limits !== "object" || Array.isArray(limits)) {
    throw new Error("Real-workspace identity limits must be an object.");
  }

  const allowedKeys = new Set(Object.keys(DEFAULT_REAL_WORKSPACE_IDENTITY_LIMITS));
  for (const key of Object.keys(limits)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unknown real-workspace identity limit: ${key}`);
    }
  }

  const result = {};
  for (const [key, fallback] of Object.entries(DEFAULT_REAL_WORKSPACE_IDENTITY_LIMITS)) {
    const value = limits[key] ?? fallback;
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Real-workspace identity limit ${key} must be a positive safe integer.`);
    }
    result[key] = value;
  }
  return result;
}

function normalizedPrivateTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new Error("Opaque target locator must be an object.");
  }

  const allowedKeys = new Set(["kind", "relativePath", "line", "column"]);
  for (const key of Object.keys(target)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Opaque target locator contains forbidden field: ${key}`);
    }
  }

  if (!new Set(["completion", "document", "navigation"]).has(target.kind)) {
    throw new Error("Opaque target kind must be completion, document, or navigation.");
  }

  const relativePath = normalizedRelativePath(target.relativePath);
  if (!Number.isSafeInteger(target.line) || target.line < 1) {
    throw new Error("Opaque target line must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(target.column) || target.column < 1) {
    throw new Error("Opaque target column must be a positive safe integer.");
  }

  return { kind: target.kind, relativePath, line: target.line, column: target.column };
}

function normalizedRelativePath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    path.posix.isAbsolute(value)
  ) {
    throw new Error("Opaque target path must be a normalized relative POSIX path.");
  }

  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Opaque target path must stay within the workspace.");
  }
  if (Buffer.byteLength(normalized) > 4_096) {
    throw new Error("Opaque target path exceeded 4096 bytes.");
  }
  return normalized;
}

function comparePrivateTargets(left, right) {
  return (
    bytewiseCompare(left.relativePath, right.relativePath) ||
    bytewiseCompare(left.kind, right.kind) ||
    left.line - right.line ||
    left.column - right.column
  );
}

function bytewiseCompare(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function opaqueDescriptor(key, workspaceIdentity, kind, index, fingerprint) {
  const id = `${kind}-${String(index + 1).padStart(3, "0")}`;
  return Object.freeze({
    id,
    fingerprint,
    workspaceBinding: opaqueDescriptorBinding(key, workspaceIdentity, kind, id, fingerprint),
  });
}

function opaqueDescriptorBinding(key, workspaceIdentity, kind, id, fingerprint) {
  const hmac = createHmac("sha256", key);
  writeFrame(hmac, "workspace", workspaceIdentity);
  writeFrame(hmac, "descriptor-kind", kind);
  writeFrame(hmac, "descriptor-id", id);
  writeFrame(hmac, "descriptor-fingerprint", fingerprint);
  return hmac.digest("hex");
}

function assertRelativePathBound(relativePath, maxPathBytes) {
  if (Buffer.byteLength(relativePath) > maxPathBytes) {
    throw new Error(`Real-workspace identity exceeded maxPathBytes (${maxPathBytes}).`);
  }
}

function safeBigIntToNumber(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`Real-workspace ${label} is outside the supported integer range.`);
  }
  return number;
}

function writeFrame(hmac, label, value) {
  writeBufferFrame(hmac, label, Buffer.from(value, "utf8"));
}

function writeStatAuthority(hmac, label, stat) {
  writeFrame(hmac, `${label}-device`, String(stat.dev));
  writeFrame(hmac, `${label}-inode`, String(stat.ino));
  writeFrame(hmac, `${label}-modified`, String(stat.mtimeNs));
  writeFrame(hmac, `${label}-changed`, String(stat.ctimeNs));
}

function writeBufferFrame(hmac, label, value) {
  const labelBuffer = Buffer.from(label, "utf8");
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(value.byteLength));
  hmac.update(labelBuffer);
  hmac.update(Buffer.from([0]));
  hmac.update(length);
  hmac.update(value);
}

function assertIdentitySnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("Real-workspace identity snapshot must be an object.");
  }

  const exactKeys = [
    "identityVersion",
    "identityScope",
    "traversalAuthority",
    "workspaceIdentity",
    "directoryCount",
    "fileCount",
    "totalBytes",
    "dirty",
  ];
  const keys = Object.keys(snapshot).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...exactKeys].sort())) {
    throw new Error("Real-workspace identity snapshot has an invalid shape.");
  }

  if (snapshot.identityVersion !== REAL_WORKSPACE_IDENTITY_VERSION) {
    throw new Error("Real-workspace identity snapshot has an unsupported version.");
  }
  if (snapshot.identityScope !== REAL_WORKSPACE_IDENTITY_SCOPE) {
    throw new Error("Real-workspace identity snapshot has an unsupported scope.");
  }
  if (snapshot.traversalAuthority !== REAL_WORKSPACE_TRAVERSAL_AUTHORITY) {
    throw new Error("Real-workspace identity snapshot has an unsupported traversal authority.");
  }
  assertWorkspaceIdentity(snapshot.workspaceIdentity);
  for (const key of ["directoryCount", "fileCount", "totalBytes"]) {
    if (!Number.isSafeInteger(snapshot[key]) || snapshot[key] < 0) {
      throw new Error(`Real-workspace identity snapshot ${key} is invalid.`);
    }
  }
  if (typeof snapshot.dirty !== "boolean") {
    throw new Error("Real-workspace identity snapshot dirty status is invalid.");
  }
}

function assertWorkspaceIdentity(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("Real-workspace identity must be a lowercase SHA-256 HMAC digest.");
  }
}

function assertNoForbiddenPersistedKeys(value) {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_PERSISTED_KEYS.has(key)) {
      throw new Error(`Real-workspace persisted identity contains forbidden field: ${key}`);
    }
  }
}
