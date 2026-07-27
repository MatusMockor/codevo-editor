import type { LanguageServerDiagnostic } from "./languageServerDiagnostics";

export const DIAGNOSTICS_CACHE_MAX_DIAGNOSTICS = 20_000;
export const DIAGNOSTICS_CACHE_MAX_NONEMPTY_FILES = 2_000;
export const DIAGNOSTICS_CACHE_MAX_UTF8_BYTES = 8 * 1024 * 1024;
export const DIAGNOSTICS_CACHE_MAX_LEDGER_PATHS = 20_000;
const DIAGNOSTICS_CACHE_MAX_LEDGER_CANDIDATES_BEFORE_REBUILD =
  DIAGNOSTICS_CACHE_MAX_LEDGER_PATHS * 2;
const DIAGNOSTICS_CACHE_MAX_CACHED_NON_SERIALIZABLE_IDENTITIES =
  DIAGNOSTICS_CACHE_MAX_NONEMPTY_FILES;

export interface DiagnosticsCacheUpdate {
  readonly diagnostics: readonly LanguageServerDiagnostic[];
  readonly path: string;
  readonly publishedCount: number;
}

export interface DiagnosticsCacheReceipt {
  readonly omittedCount: number;
  readonly publishedCount: number;
  readonly retainedCount: number;
  readonly retainedUtf8Bytes: number;
  readonly publishedCountKind: "exact" | "upperBound";
  readonly truncated: boolean;
}

export interface BoundedDiagnosticsCacheResult {
  readonly byPath: Readonly<Record<string, LanguageServerDiagnostic[]>>;
  readonly publishedCountByPath: Readonly<Record<string, number>>;
  readonly retainedUtf8BytesByPath: Readonly<Record<string, number>>;
  readonly untrackedPublishedCount: number;
  readonly receipt: DiagnosticsCacheReceipt;
}

export interface DiagnosticsCacheLedger {
  readonly publishedCount: number;
  readonly publishedCountByPath: Readonly<Record<string, number>>;
  readonly retainedUtf8Bytes?: number;
  readonly untrackedPublishedCount: number;
  readonly retainedUtf8BytesByPath?: Readonly<Record<string, number>>;
}

interface RetainedFile {
  readonly diagnostics: LanguageServerDiagnostic[];
  readonly utf8Bytes: number;
}

interface PublishedLedgerCandidate {
  readonly order: number;
  readonly path: string;
}

interface PublishedLedgerTrimmer {
  candidates: PublishedLedgerCandidate[];
  readonly orderByPath: Map<string, number>;
  nextOrder: number;
}

interface NonSerializableValueCache {
  additions: number;
  values: WeakSet<object>;
}

/**
 * Applies a whole diagnostics frame with one bounded cache rebuild.
 *
 * Entries are ordered from least to most recently published. Replacing a path
 * moves it to the newest position; when a limit is reached, whole oldest files
 * are evicted deterministically. A single oversized publication retains only
 * its ordered prefix, so downstream notices and markers can never refer to
 * diagnostics that were not retained.
 */
export function applyBoundedDiagnosticsCacheBatch(
  current: Readonly<Record<string, readonly LanguageServerDiagnostic[]>>,
  updates: readonly DiagnosticsCacheUpdate[],
  currentLedger?: DiagnosticsCacheLedger,
): BoundedDiagnosticsCacheResult {
  const files = new Map<string, RetainedFile>();
  const nonSerializableValues: NonSerializableValueCache = {
    additions: 0,
    values: new WeakSet(),
  };
  let retainedCount = 0;
  // Two object braces plus a conservative leading comma per retained property.
  // The final receipt below measures the exact serialized record.
  let retainedUtf8Bytes = 2;

  for (const [path, diagnostics] of Object.entries(current)) {
    if (diagnostics.length === 0) {
      continue;
    }

    const availableCount = DIAGNOSTICS_CACHE_MAX_DIAGNOSTICS - retainedCount;
    const availableUtf8Bytes =
      DIAGNOSTICS_CACHE_MAX_UTF8_BYTES - retainedUtf8Bytes - (files.size > 0 ? 1 : 0);
    const knownUtf8Bytes = currentLedger?.retainedUtf8BytesByPath?.[path];
    const retained =
      knownUtf8Bytes !== undefined &&
      diagnostics.length <= availableCount &&
      knownUtf8Bytes <= availableUtf8Bytes
        ? { diagnostics: [...diagnostics], utf8Bytes: knownUtf8Bytes }
        : retainDiagnosticPrefix(
            path,
            diagnostics,
            availableCount,
            availableUtf8Bytes,
            nonSerializableValues,
          );
    if (retained.diagnostics.length === 0) {
      continue;
    }

    files.set(path, retained);
    retainedCount += retained.diagnostics.length;
    retainedUtf8Bytes += retained.utf8Bytes + (files.size > 1 ? 1 : 0);
    if (files.size >= DIAGNOSTICS_CACHE_MAX_NONEMPTY_FILES) {
      break;
    }
  }

  const publishedCountByPath = new Map<string, number>(
    Object.entries(currentLedger?.publishedCountByPath ?? {}).slice(
      -DIAGNOSTICS_CACHE_MAX_LEDGER_PATHS,
    ),
  );
  for (const path of files.keys()) {
    publishedCountByPath.set(
      path,
      Math.max(
        files.get(path)?.diagnostics.length ?? 0,
        currentLedger?.publishedCountByPath[path] ?? files.get(path)?.diagnostics.length ?? 0,
      ),
    );
  }
  let untrackedPublishedCount = Math.max(
    0,
    currentLedger?.untrackedPublishedCount ??
      (currentLedger
        ? currentLedger.publishedCount -
          Array.from(publishedCountByPath.values()).reduce((total, count) => total + count, 0)
        : 0),
  );
  let publishedCount =
    untrackedPublishedCount +
    Array.from(publishedCountByPath.values()).reduce((total, count) => total + count, 0);
  const publishedLedgerTrimmer = createPublishedLedgerTrimmer(publishedCountByPath);
  untrackedPublishedCount += trimPublishedLedger(
    publishedCountByPath,
    files,
    publishedLedgerTrimmer,
  );

  for (const update of updates) {
    const replaced = files.get(update.path);
    const replacedPublishedCount = publishedCountByPath.get(update.path);
    if (replacedPublishedCount !== undefined) {
      publishedCount -= replacedPublishedCount;
      publishedCountByPath.delete(update.path);
      publishedLedgerTrimmer.orderByPath.delete(update.path);
    }
    if (replaced) {
      retainedUtf8Bytes -= replaced.utf8Bytes + (files.size > 1 ? 1 : 0);
      files.delete(update.path);
      retainedCount -= replaced.diagnostics.length;
    }
    const updatePublishedCount = Math.max(update.publishedCount, update.diagnostics.length);
    if (updatePublishedCount > 0) {
      publishedCountByPath.set(update.path, updatePublishedCount);
      trackPublishedLedgerPath(publishedLedgerTrimmer, update.path);
      publishedCount += updatePublishedCount;
    }

    if (update.diagnostics.length === 0) {
      untrackedPublishedCount += trimPublishedLedger(
        publishedCountByPath,
        files,
        publishedLedgerTrimmer,
      );
      continue;
    }

    while (
      files.size >= DIAGNOSTICS_CACHE_MAX_NONEMPTY_FILES ||
      retainedCount >= DIAGNOSTICS_CACHE_MAX_DIAGNOSTICS ||
      retainedUtf8Bytes >= DIAGNOSTICS_CACHE_MAX_UTF8_BYTES
    ) {
      const oldest = files.entries().next().value as [string, RetainedFile] | undefined;
      if (!oldest) {
        break;
      }

      retainedUtf8Bytes -= oldest[1].utf8Bytes + (files.size > 1 ? 1 : 0);
      files.delete(oldest[0]);
      retainedCount -= oldest[1].diagnostics.length;
      markPublishedLedgerPathEvictable(publishedLedgerTrimmer, oldest[0]);
    }

    const retained = retainDiagnosticPrefix(
      update.path,
      update.diagnostics,
      DIAGNOSTICS_CACHE_MAX_DIAGNOSTICS - retainedCount,
      DIAGNOSTICS_CACHE_MAX_UTF8_BYTES - retainedUtf8Bytes - (files.size > 0 ? 1 : 0),
      nonSerializableValues,
    );
    if (retained.diagnostics.length === 0) {
      untrackedPublishedCount += trimPublishedLedger(
        publishedCountByPath,
        files,
        publishedLedgerTrimmer,
      );
      continue;
    }

    files.set(update.path, retained);
    retainedCount += retained.diagnostics.length;
    retainedUtf8Bytes += retained.utf8Bytes + (files.size > 1 ? 1 : 0);
    untrackedPublishedCount += trimPublishedLedger(
      publishedCountByPath,
      files,
      publishedLedgerTrimmer,
    );
  }

  const byPath: Record<string, LanguageServerDiagnostic[]> = {};
  const retainedUtf8BytesByPath: Record<string, number> = {};
  for (const [path, retained] of files) {
    byPath[path] = retained.diagnostics;
    retainedUtf8BytesByPath[path] = retained.utf8Bytes;
  }

  const omittedCount = Math.max(0, publishedCount - retainedCount);
  return {
    byPath,
    publishedCountByPath: Object.fromEntries(publishedCountByPath),
    retainedUtf8BytesByPath,
    untrackedPublishedCount,
    receipt: {
      omittedCount,
      publishedCount,
      publishedCountKind: untrackedPublishedCount > 0 ? "upperBound" : "exact",
      retainedCount,
      retainedUtf8Bytes,
      truncated: omittedCount > 0,
    },
  };
}

function retainDiagnosticPrefix(
  path: string,
  diagnostics: readonly LanguageServerDiagnostic[],
  availableCount: number,
  availableUtf8Bytes: number,
  nonSerializableValues: NonSerializableValueCache,
): RetainedFile {
  if (availableCount <= 0 || availableUtf8Bytes <= 0) {
    return { diagnostics: [], utf8Bytes: 0 };
  }

  const retained: LanguageServerDiagnostic[] = [];
  let utf8Bytes = jsonUtf8Length(path, nonSerializableValues) + 1 + 2;

  for (const diagnostic of diagnostics) {
    if (retained.length >= availableCount) {
      break;
    }

    const diagnosticBytes =
      jsonUtf8Length(diagnostic, nonSerializableValues) + (retained.length > 0 ? 1 : 0);
    if (utf8Bytes + diagnosticBytes > availableUtf8Bytes) {
      break;
    }

    retained.push(diagnostic);
    utf8Bytes += diagnosticBytes;
  }

  return { diagnostics: retained, utf8Bytes: retained.length > 0 ? utf8Bytes : 0 };
}

function trimPublishedLedger(
  publishedCountByPath: Map<string, number>,
  files: ReadonlyMap<string, RetainedFile>,
  trimmer: PublishedLedgerTrimmer,
): number {
  let trimmedCount = 0;
  while (publishedCountByPath.size > DIAGNOSTICS_CACHE_MAX_LEDGER_PATHS) {
    const candidate = popPublishedLedgerCandidate(trimmer.candidates);
    if (!candidate) {
      break;
    }
    if (trimmer.orderByPath.get(candidate.path) !== candidate.order || files.has(candidate.path)) {
      continue;
    }
    const publishedCount = publishedCountByPath.get(candidate.path);
    if (publishedCount === undefined) {
      continue;
    }
    publishedCountByPath.delete(candidate.path);
    trimmer.orderByPath.delete(candidate.path);
    trimmedCount += publishedCount;
  }
  if (trimmer.candidates.length > DIAGNOSTICS_CACHE_MAX_LEDGER_CANDIDATES_BEFORE_REBUILD) {
    trimmer.candidates = [];
    for (const [path, order] of trimmer.orderByPath) {
      if (!files.has(path)) {
        pushPublishedLedgerCandidate(trimmer.candidates, { order, path });
      }
    }
  }
  return trimmedCount;
}

function createPublishedLedgerTrimmer(
  publishedCountByPath: ReadonlyMap<string, number>,
): PublishedLedgerTrimmer {
  const trimmer: PublishedLedgerTrimmer = {
    candidates: [],
    nextOrder: 0,
    orderByPath: new Map(),
  };
  for (const path of publishedCountByPath.keys()) {
    trackPublishedLedgerPath(trimmer, path);
  }
  return trimmer;
}

function trackPublishedLedgerPath(trimmer: PublishedLedgerTrimmer, path: string): void {
  const order = trimmer.nextOrder;
  trimmer.nextOrder += 1;
  trimmer.orderByPath.set(path, order);
  pushPublishedLedgerCandidate(trimmer.candidates, { order, path });
}

function markPublishedLedgerPathEvictable(trimmer: PublishedLedgerTrimmer, path: string): void {
  const order = trimmer.orderByPath.get(path);
  if (order === undefined) {
    return;
  }
  pushPublishedLedgerCandidate(trimmer.candidates, { order, path });
}

function pushPublishedLedgerCandidate(
  candidates: PublishedLedgerCandidate[],
  candidate: PublishedLedgerCandidate,
): void {
  let index = candidates.length;
  candidates.push(candidate);
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    const parent = candidates[parentIndex];
    if (!parent || parent.order <= candidate.order) {
      break;
    }
    candidates[index] = parent;
    index = parentIndex;
  }
  candidates[index] = candidate;
}

function popPublishedLedgerCandidate(
  candidates: PublishedLedgerCandidate[],
): PublishedLedgerCandidate | undefined {
  const oldest = candidates[0];
  const newest = candidates.pop();
  if (!oldest || !newest || candidates.length === 0) {
    return oldest;
  }

  let index = 0;
  while (true) {
    const leftIndex = index * 2 + 1;
    if (leftIndex >= candidates.length) {
      break;
    }
    const rightIndex = leftIndex + 1;
    const left = candidates[leftIndex];
    const right = candidates[rightIndex];
    const childIndex = right && left && right.order < left.order ? rightIndex : leftIndex;
    const child = candidates[childIndex];
    if (!child || child.order >= newest.order) {
      break;
    }
    candidates[index] = child;
    index = childIndex;
  }
  candidates[index] = newest;
  return oldest;
}

function jsonUtf8Length(value: unknown, nonSerializableValues: NonSerializableValueCache): number {
  if (typeof value === "object" && value !== null && nonSerializableValues.values.has(value)) {
    return DIAGNOSTICS_CACHE_MAX_UTF8_BYTES + 1;
  }
  try {
    return utf8Length(JSON.stringify(value));
  } catch {
    if (typeof value === "object" && value !== null) {
      if (
        nonSerializableValues.additions >= DIAGNOSTICS_CACHE_MAX_CACHED_NON_SERIALIZABLE_IDENTITIES
      ) {
        nonSerializableValues.additions = 0;
        nonSerializableValues.values = new WeakSet();
      }
      nonSerializableValues.values.add(value);
      nonSerializableValues.additions += 1;
    }
    return DIAGNOSTICS_CACHE_MAX_UTF8_BYTES + 1;
  }
}

function utf8Length(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  return new TextEncoder().encode(value).byteLength;
}
