import type { LanguageServerDiagnostic } from "./languageServerDiagnostics";

export const DIAGNOSTICS_CACHE_MAX_DIAGNOSTICS = 20_000;
export const DIAGNOSTICS_CACHE_MAX_NONEMPTY_FILES = 2_000;
export const DIAGNOSTICS_CACHE_MAX_UTF8_BYTES = 8 * 1024 * 1024;
export const DIAGNOSTICS_CACHE_MAX_LEDGER_PATHS = 20_000;

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
        : retainDiagnosticPrefix(path, diagnostics, availableCount, availableUtf8Bytes);
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

  for (const update of updates) {
    const replaced = files.get(update.path);
    const replacedPublishedCount = publishedCountByPath.get(update.path);
    if (replacedPublishedCount !== undefined) {
      publishedCount -= replacedPublishedCount;
      publishedCountByPath.delete(update.path);
    }
    if (replaced) {
      retainedUtf8Bytes -= replaced.utf8Bytes + (files.size > 1 ? 1 : 0);
      files.delete(update.path);
      retainedCount -= replaced.diagnostics.length;
    }
    const updatePublishedCount = Math.max(update.publishedCount, update.diagnostics.length);
    if (updatePublishedCount > 0) {
      publishedCountByPath.set(update.path, updatePublishedCount);
      publishedCount += updatePublishedCount;
    }

    if (update.diagnostics.length === 0) {
      trimPublishedLedger(publishedCountByPath, files, (trimmedCount) => {
        untrackedPublishedCount += trimmedCount;
      });
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
    }

    const retained = retainDiagnosticPrefix(
      update.path,
      update.diagnostics,
      DIAGNOSTICS_CACHE_MAX_DIAGNOSTICS - retainedCount,
      DIAGNOSTICS_CACHE_MAX_UTF8_BYTES - retainedUtf8Bytes - (files.size > 0 ? 1 : 0),
    );
    if (retained.diagnostics.length === 0) {
      trimPublishedLedger(publishedCountByPath, files, (trimmedCount) => {
        untrackedPublishedCount += trimmedCount;
      });
      continue;
    }

    files.set(update.path, retained);
    retainedCount += retained.diagnostics.length;
    retainedUtf8Bytes += retained.utf8Bytes + (files.size > 1 ? 1 : 0);
    trimPublishedLedger(publishedCountByPath, files, (trimmedCount) => {
      untrackedPublishedCount += trimmedCount;
    });
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
): RetainedFile {
  if (availableCount <= 0 || availableUtf8Bytes <= 0) {
    return { diagnostics: [], utf8Bytes: 0 };
  }

  const retained: LanguageServerDiagnostic[] = [];
  let utf8Bytes = jsonUtf8Length(path) + 1 + 2;

  for (const diagnostic of diagnostics) {
    if (retained.length >= availableCount) {
      break;
    }

    const diagnosticBytes = jsonUtf8Length(diagnostic) + (retained.length > 0 ? 1 : 0);
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
  onTrim: (publishedCount: number) => void,
): void {
  while (publishedCountByPath.size > DIAGNOSTICS_CACHE_MAX_LEDGER_PATHS) {
    let oldestEvicted: [string, number] | undefined;
    for (const entry of publishedCountByPath) {
      if (!files.has(entry[0])) {
        oldestEvicted = entry;
        break;
      }
    }
    if (!oldestEvicted) {
      return;
    }
    publishedCountByPath.delete(oldestEvicted[0]);
    onTrim(oldestEvicted[1]);
  }
}

function jsonUtf8Length(value: unknown): number {
  try {
    return utf8Length(JSON.stringify(value));
  } catch {
    return DIAGNOSTICS_CACHE_MAX_UTF8_BYTES + 1;
  }
}

function utf8Length(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  return new TextEncoder().encode(value).byteLength;
}
