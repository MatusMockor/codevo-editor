import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import {
  languageServerDiagnosticNoticeGroup,
  languageServerDiagnosticNoticeMessage,
  languageServerDiagnosticNoticeSeverity,
} from "../domain/languageServerDiagnostics";
import { fileUriFromPath } from "../domain/languageServerDocumentSync";
import { DIAGNOSTICS_RETENTION_RECEIPT_GROUP_KEY } from "../domain/problemsView";
import {
  buildDiagnosticOverflowNotice,
  diagnosticNoticeNavigationTarget,
  DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT,
  GLOBAL_NOTICE_LIMIT,
  javaScriptTypeScriptDiagnosticNoticeGroup,
} from "./diagnosticNotices";
import { createWorkbenchNotice, type WorkbenchNotice } from "./workbenchNotice";

const DIAGNOSTICS_RETENTION_RECEIPT_PREFIX = `${DIAGNOSTICS_RETENTION_RECEIPT_GROUP_KEY}:`;

export function diagnosticsRetentionReceiptOwnerPrefix(
  kind: "php" | "typescript",
  ownerKey: string,
): string {
  return `${DIAGNOSTICS_RETENTION_RECEIPT_PREFIX}${kind}:${ownerKey}:`;
}

export function replaceDiagnosticsRetentionReceipt(
  current: WorkbenchNotice[],
  receipt: {
    readonly kind: "php" | "typescript";
    readonly ownerKey: string;
    readonly ownerRevision: number;
    readonly publishedCount: number;
    readonly publishedCountKind: "exact" | "upperBound";
    readonly retainedCount: number;
    readonly sessionId: number;
  },
): WorkbenchNotice[] {
  const groupKey =
    `${diagnosticsRetentionReceiptOwnerPrefix(receipt.kind, receipt.ownerKey)}` +
    `${receipt.sessionId}:${receipt.ownerRevision}`;
  const withoutReceipt = current.filter((notice) => notice.groupKey !== groupKey);
  if (receipt.publishedCount <= receipt.retainedCount) {
    return withoutReceipt;
  }

  return [
    createWorkbenchNotice(
      "info",
      "Diagnostics",
      receipt.publishedCountKind === "exact"
        ? `Retained ${receipt.retainedCount} of ${receipt.publishedCount} published diagnostics.`
        : `Retained ${receipt.retainedCount} diagnostics; at most ${receipt.publishedCount} were published in the bounded tracking window.`,
      groupKey,
      undefined,
      "overflow",
    ),
    ...withoutReceipt,
  ];
}

export function boundedDiagnosticsNoticesForCache(
  byPath: Readonly<Record<string, readonly LanguageServerDiagnostic[]>>,
  kind: "php" | "typescript",
): WorkbenchNotice[] {
  const notices: WorkbenchNotice[] = [];
  for (const [path, diagnostics] of Object.entries(byPath)) {
    if (notices.length >= GLOBAL_NOTICE_LIMIT) {
      break;
    }

    const uri = fileUriFromPath(path);
    const groupKey =
      kind === "php"
        ? languageServerDiagnosticNoticeGroup(uri)
        : javaScriptTypeScriptDiagnosticNoticeGroup(uri);
    const source = kind === "php" ? "Language Server" : "TypeScript";
    const remaining = GLOBAL_NOTICE_LIMIT - notices.length;
    const perDocument = diagnosticNoticesForRetainedPrefix(
      diagnostics,
      diagnostics.length,
      source,
      groupKey,
      uri,
    );
    notices.push(...perDocument.slice(0, remaining));
  }

  return notices;
}

export function diagnosticNoticesForRetainedPrefix(
  diagnostics: readonly LanguageServerDiagnostic[],
  publishedCount: number,
  source: string,
  groupKey: string,
  uri: string,
): WorkbenchNotice[] {
  const shown = diagnostics.slice(0, DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT);
  const notices = shown.map((diagnostic) =>
    createWorkbenchNotice(
      languageServerDiagnosticNoticeSeverity(diagnostic.severity),
      diagnostic.source || source,
      languageServerDiagnosticNoticeMessage(diagnostic, uri),
      groupKey,
      diagnosticNoticeNavigationTarget(uri, diagnostic),
    ),
  );
  const hiddenCount = Math.max(0, publishedCount - shown.length);
  if (hiddenCount > 0) {
    notices.push(buildDiagnosticOverflowNotice(source, groupKey, hiddenCount));
  }
  return notices;
}
