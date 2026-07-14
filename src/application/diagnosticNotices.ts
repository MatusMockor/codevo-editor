import {
  createWorkbenchNotice,
  capDiagnosticNotices,
  capWorkbenchNotices,
  type WorkbenchNotice,
  type WorkbenchNoticeNavigationTarget,
} from "./workbenchNotice";
import { phpInspectionDiagnostics } from "../domain/phpInspections";
import {
  structuralPhpSyntaxDiagnostics,
  suspiciousPhpBareIdentifierDiagnostics,
} from "../domain/phpSyntaxDiagnostics";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import {
  languageServerDiagnosticNoticeMessage,
  languageServerDiagnosticNoticeSeverity,
} from "../domain/languageServerDiagnostics";
import { fileUriFromPath } from "../domain/languageServerDocumentSync";
import { pathFromLanguageServerUri } from "../domain/languageServerFeatures";

/**
 * Shared diagnostic-notice helpers consumed by both `useWorkbenchController`
 * (Laravel PHP diagnostic reclassification, the effectiveNotices/summary
 * memos) and `useDiagnostics` (the diagnostics hook). Previously these were
 * duplicated verbatim across both files with "KEEP IN SYNC" comments; this
 * module is the single source of truth so the caps and notice shapes can
 * never drift between the two call sites.
 */

// A single Laravel file can publish hundreds of diagnostics. Mapping every one
// to a notice and re-rendering the notices panel freezes the main thread, so we
// cap how many diagnostic notices a document contributes. Editor markers
// (Monaco `setModelMarkers`) come from a separate, uncapped source, so this cap
// never hides a squiggle — it only bounds the textual notices list. When the
// cap trims notices, an `info` indicator carrying the truthful hidden count is
// appended so diagnostics are never dropped silently.
export const DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT = 100;

// Global ceiling on the total diagnostic notices retained in state. The
// per-document cap above bounds a single file's contribution, but a large
// project with diagnostics across thousands of files would still grow the list
// without bound — and each publishDiagnostics runs an O(total) group replace.
// This caps the head (newest groups are prepended) and appends one truthful
// overflow indicator. Editor markers come from a separate, uncapped source.
export const GLOBAL_NOTICE_LIMIT = 2000;

export const PHP_LOCAL_DIAGNOSTIC_NOTICE_GROUP_PREFIX = "php-local-diagnostics:";

// Only diagnostic notices are subject to the global cap; errors, setup prompts
// and other non-diagnostic notices are always retained so important messages are
// never silently dropped when a large project floods the list with diagnostics.
export function isCappableDiagnosticNotice(notice: WorkbenchNotice): boolean {
  const groupKey = notice.groupKey;

  if (!groupKey) {
    return false;
  }

  return (
    groupKey.startsWith("language-server-diagnostics:") ||
    groupKey.startsWith("javascript-typescript-diagnostics:") ||
    groupKey.startsWith(PHP_LOCAL_DIAGNOSTIC_NOTICE_GROUP_PREFIX)
  );
}

export function buildDiagnosticOverflowNotice(
  source: string,
  groupKey: string,
  hiddenCount: number,
): WorkbenchNotice {
  const shownCount = DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT;
  const totalCount = shownCount + hiddenCount;
  return createWorkbenchNotice(
    "info",
    source,
    `Showing ${shownCount} of ${totalCount} diagnostics — ${hiddenCount} more hidden. Open the file to see all markers.`,
    groupKey,
    undefined,
    "overflow",
  );
}

export function javaScriptTypeScriptDiagnosticNoticeGroup(uri: string): string {
  return `javascript-typescript-diagnostics:${uri}`;
}

export function phpLocalDiagnosticNoticeGroup(path: string): string {
  return `${PHP_LOCAL_DIAGNOSTIC_NOTICE_GROUP_PREFIX}${fileUriFromPath(path)}`;
}

export function localPhpDiagnosticsFromSource(
  source: string,
  syntaxDiagnostics: Array<{
    character: number;
    endCharacter: number;
    endLine: number;
    line: number;
    message: string;
  }>,
): LanguageServerDiagnostic[] {
  const localSyntaxDiagnostics = [
    ...(syntaxDiagnostics.length === 0
      ? structuralPhpSyntaxDiagnostics(source)
      : []),
    ...suspiciousPhpBareIdentifierDiagnostics(source),
  ];
  const inspectionDiagnostics = phpInspectionDiagnostics(source);
  const diagnostics: LanguageServerDiagnostic[] = [
    ...syntaxDiagnostics,
    ...localSyntaxDiagnostics,
  ].map((diagnostic) => ({
    character: diagnostic.character,
    endCharacter: diagnostic.endCharacter,
    endLine: diagnostic.endLine,
    line: diagnostic.line,
    message: diagnostic.message,
    severity: "error" as const,
    source: "PHP Syntax",
  }));

  diagnostics.push(
    ...inspectionDiagnostics.map((diagnostic) => ({
      character: diagnostic.character,
      endCharacter: diagnostic.endCharacter,
      endLine: diagnostic.endLine,
      line: diagnostic.line,
      message: diagnostic.message,
      severity: "warning" as const,
      source: "PHP Inspection",
      tags: diagnostic.unnecessary ? [1] : undefined,
    })),
  );

  return diagnostics;
}

export function diagnosticNoticeNavigationTarget(
  uri: string,
  diagnostic: LanguageServerDiagnostic,
): WorkbenchNoticeNavigationTarget | undefined {
  const path = pathFromLanguageServerUri(uri);

  if (!path) {
    return undefined;
  }

  return {
    path,
    range: {
      end: {
        column: (diagnostic.endCharacter ?? diagnostic.character) + 1,
        lineNumber: (diagnostic.endLine ?? diagnostic.line) + 1,
      },
      start: {
        column: diagnostic.character + 1,
        lineNumber: diagnostic.line + 1,
      },
    },
  };
}

export interface ActiveDiagnosticNoticeDocument {
  language: string;
  path: string;
}

export function activePhpLocalDiagnosticNotices(
  document: ActiveDiagnosticNoticeDocument | null,
  diagnosticsByPath: Record<string, LanguageServerDiagnostic[]>,
): WorkbenchNotice[] {
  if (!document || document.language !== "php") {
    return [];
  }

  return activeLocalDiagnosticNotices(
    document.path,
    diagnosticsByPath[document.path] ?? [],
    "PHP",
  );
}

export function activeDotenvLocalDiagnosticNotices(
  document: ActiveDiagnosticNoticeDocument | null,
  diagnosticsByPath: Record<string, LanguageServerDiagnostic[]>,
): WorkbenchNotice[] {
  if (!document || document.language !== "dotenv") {
    return [];
  }

  return activeLocalDiagnosticNotices(
    document.path,
    diagnosticsByPath[document.path] ?? [],
    "dotenv",
  );
}

export function composeEffectiveDiagnosticNotices({
  activeDocument,
  activeDotenvDiagnosticNotices,
  activePhpLocalDiagnosticNotices,
  notices,
}: {
  activeDocument: ActiveDiagnosticNoticeDocument | null;
  activeDotenvDiagnosticNotices: WorkbenchNotice[];
  activePhpLocalDiagnosticNotices: WorkbenchNotice[];
  notices: WorkbenchNotice[];
}): WorkbenchNotice[] {
  if (!activeDocument) {
    return notices;
  }

  const groupKey = phpLocalDiagnosticNoticeGroup(activeDocument.path);
  const withoutActiveLocalDiagnostics = notices.filter(
    (notice) => notice.groupKey !== groupKey,
  );

  if (activeDocument.language === "dotenv") {
    if (activeDotenvDiagnosticNotices.length === 0) {
      return withoutActiveLocalDiagnostics;
    }

    return capWorkbenchNotices(
      [...withoutActiveLocalDiagnostics, ...activeDotenvDiagnosticNotices],
      GLOBAL_NOTICE_LIMIT,
      isCappableDiagnosticNotice,
    );
  }

  if (activeDocument.language !== "php") {
    return notices;
  }

  if (activePhpLocalDiagnosticNotices.length === 0) {
    return withoutActiveLocalDiagnostics;
  }

  return capWorkbenchNotices(
    [...withoutActiveLocalDiagnostics, ...activePhpLocalDiagnosticNotices],
    GLOBAL_NOTICE_LIMIT,
    isCappableDiagnosticNotice,
  );
}

function activeLocalDiagnosticNotices(
  path: string,
  diagnostics: LanguageServerDiagnostic[],
  fallbackSource: string,
): WorkbenchNotice[] {
  if (diagnostics.length === 0) {
    return [];
  }

  const uri = fileUriFromPath(path);
  const groupKey = phpLocalDiagnosticNoticeGroup(path);

  return capDiagnosticNotices(
    diagnostics.map((diagnostic) =>
      createWorkbenchNotice(
        languageServerDiagnosticNoticeSeverity(diagnostic.severity),
        diagnostic.source || fallbackSource,
        languageServerDiagnosticNoticeMessage(diagnostic, uri),
        groupKey,
        diagnosticNoticeNavigationTarget(uri, diagnostic),
      ),
    ),
    DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT,
    (hiddenCount) =>
      buildDiagnosticOverflowNotice(fallbackSource, groupKey, hiddenCount),
  );
}
