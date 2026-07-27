import {
  applyBoundedDiagnosticsCacheBatch,
  type BoundedDiagnosticsCacheResult,
  type DiagnosticsCacheUpdate,
} from "../domain/boundedDiagnosticsCache";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import type { DiagnosticsOwnerLifecycleStore } from "./diagnosticsOwnerLifecycleStore";

export type DiagnosticsCacheByOwner = Record<string, Record<string, LanguageServerDiagnostic[]>>;

export interface DiagnosticsOwnerBatchFrame {
  ownerRevision: number;
  rootPath: string;
  sessionId: number;
  updates: {
    diagnosticPath: string;
    diagnostics: readonly LanguageServerDiagnostic[];
    publishedCount: number;
  }[];
}

export type DiagnosticsOwnerBatchMap = Map<string, DiagnosticsOwnerBatchFrame>;

interface CommitDiagnosticsOwnerCacheBatchOptions {
  readonly cacheByOwner: DiagnosticsCacheByOwner;
  readonly lifecycleKey: string;
  readonly lifecycleStore: DiagnosticsOwnerLifecycleStore;
  readonly ownerKey: string;
  readonly updates: readonly DiagnosticsCacheUpdate[];
}

/**
 * Commits one exact owner's bounded diagnostics frame and its retention ledger
 * as a single fail-closed application operation.
 */
export function commitDiagnosticsOwnerCacheBatch({
  cacheByOwner,
  lifecycleKey,
  lifecycleStore,
  ownerKey,
  updates,
}: CommitDiagnosticsOwnerCacheBatchOptions): BoundedDiagnosticsCacheResult | null {
  if (lifecycleStore.capture(lifecycleKey) === null) {
    return null;
  }

  const result = applyBoundedDiagnosticsCacheBatch(
    cacheByOwner[ownerKey] ?? {},
    updates,
    lifecycleStore.ledger(lifecycleKey),
  );
  if (
    !lifecycleStore.setLedger(lifecycleKey, {
      publishedCount: result.receipt.publishedCount,
      publishedCountByPath: result.publishedCountByPath,
      retainedUtf8Bytes: result.receipt.retainedUtf8Bytes,
      retainedUtf8BytesByPath: result.retainedUtf8BytesByPath,
      untrackedPublishedCount: result.untrackedPublishedCount,
    })
  ) {
    return null;
  }

  const nextByPath = { ...result.byPath };
  if (Object.keys(nextByPath).length > 0) {
    cacheByOwner[ownerKey] = nextByPath;
  } else {
    delete cacheByOwner[ownerKey];
  }
  return { ...result, byPath: nextByPath };
}

export function removeDiagnosticsOwnerLedgerPath(
  lifecycleStore: DiagnosticsOwnerLifecycleStore,
  lifecycleKey: string,
  path: string,
): void {
  const ledger = lifecycleStore.ledger(lifecycleKey);
  const removedPublishedCount = ledger?.publishedCountByPath[path];
  if (!ledger || removedPublishedCount === undefined) {
    return;
  }
  const publishedCountByPath = { ...ledger.publishedCountByPath };
  const retainedUtf8BytesByPath = { ...ledger.retainedUtf8BytesByPath };
  delete publishedCountByPath[path];
  delete retainedUtf8BytesByPath[path];
  lifecycleStore.setLedger(lifecycleKey, {
    publishedCount: Math.max(0, ledger.publishedCount - removedPublishedCount),
    publishedCountByPath,
    retainedUtf8Bytes:
      2 +
      Object.values(retainedUtf8BytesByPath).reduce((total, bytes) => total + bytes, 0) +
      Math.max(0, Object.keys(retainedUtf8BytesByPath).length - 1),
    retainedUtf8BytesByPath,
    untrackedPublishedCount: ledger.untrackedPublishedCount,
  });
}
