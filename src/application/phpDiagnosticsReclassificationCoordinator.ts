export type PhpDiagnosticsReclassifier = (rootPath: string, expectedOwnerKey: string) => boolean;

/**
 * Bridges framework-source warmup and diagnostics cache commit without timers.
 * Exact owner keys isolate aliases and A → B → A workspace transitions.
 */
export class PhpDiagnosticsReclassificationCoordinator {
  private readonly pendingRootByOwner = new Map<string, string>();

  constructor(private readonly maximumOwners = 64) {}

  sourcesLoaded(rootPath: string, ownerKey: string, reclassify: PhpDiagnosticsReclassifier): void {
    this.pendingRootByOwner.delete(ownerKey);
    this.pendingRootByOwner.set(ownerKey, rootPath);
    this.trim();
    if (reclassify(rootPath, ownerKey)) {
      this.pendingRootByOwner.delete(ownerKey);
    }
  }

  diagnosticsCommitted(ownerKey: string, reclassify: PhpDiagnosticsReclassifier): void {
    const sourceRoot = this.pendingRootByOwner.get(ownerKey);
    if (!sourceRoot) {
      return;
    }
    if (reclassify(sourceRoot, ownerKey)) {
      this.pendingRootByOwner.delete(ownerKey);
    }
  }

  private trim(): void {
    while (this.pendingRootByOwner.size > this.maximumOwners) {
      const oldestOwnerKey = this.pendingRootByOwner.keys().next().value as string | undefined;
      if (!oldestOwnerKey) {
        break;
      }
      this.pendingRootByOwner.delete(oldestOwnerKey);
    }
  }
}

interface ReclassifyPhpDiagnosticsOptions {
  activePhpFrameworkProviders: readonly PhpFrameworkProvider[];
  currentWorkspaceRoot: string | null;
  diagnosticsByOwnerRef: MutableRefObject<
    Record<string, Record<string, LanguageServerDiagnostic[]>>
  >;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  expectedOwnerKey: string;
  resolveOwnerKey(rootPath: string): string;
  rootPath: string;
  setDiagnosticsByPath: Dispatch<SetStateAction<Record<string, LanguageServerDiagnostic[]>>>;
  setNotices: Dispatch<SetStateAction<WorkbenchNotice[]>>;
  workspaceSources: readonly string[];
}

export function reclassifyPhpDiagnosticsForOwner({
  activePhpFrameworkProviders,
  currentWorkspaceRoot,
  diagnosticsByOwnerRef,
  documentsRef,
  expectedOwnerKey,
  resolveOwnerKey,
  rootPath,
  setDiagnosticsByPath,
  setNotices,
  workspaceSources,
}: ReclassifyPhpDiagnosticsOptions): boolean {
  const ownerKey = resolveOwnerKey(rootPath);
  if (ownerKey !== expectedOwnerKey) return true;
  const diagnosticsByPath = diagnosticsByOwnerRef.current[ownerKey];
  if (!diagnosticsByPath || workspaceSources.length === 0) return false;

  const isActiveRoot = workspaceRootKeysEqual(currentWorkspaceRoot, rootPath);
  let nextDiagnosticsByPath = diagnosticsByPath;
  const noticeUpdates: { groupKey: string; notices: WorkbenchNotice[] }[] = [];

  for (const [diagnosticPath, diagnostics] of Object.entries(diagnosticsByPath)) {
    const document = documentsRef.current[diagnosticPath];
    if (document?.language !== "php" || diagnostics.length === 0) continue;
    const nextDiagnostics = filterPhpLanguageServerDiagnostics(document.content, diagnostics, {
      frameworkProviders: activePhpFrameworkProviders,
      frameworkSourceContext: { workspaceSources },
      path: diagnosticPath,
    });
    if (languageServerDiagnosticsEqual(diagnostics, nextDiagnostics)) continue;
    if (nextDiagnosticsByPath === diagnosticsByPath) {
      nextDiagnosticsByPath = { ...diagnosticsByPath };
    }
    nextDiagnosticsByPath[diagnosticPath] = nextDiagnostics;
    if (!isActiveRoot) continue;

    const uri = fileUriFromPath(diagnosticPath);
    const groupKey = languageServerDiagnosticNoticeGroup(uri);
    noticeUpdates.push({
      groupKey,
      notices: capDiagnosticNotices(
        nextDiagnostics.map((diagnostic) =>
          createWorkbenchNotice(
            languageServerDiagnosticNoticeSeverity(diagnostic.severity),
            diagnostic.source || "Language Server",
            languageServerDiagnosticNoticeMessage(diagnostic, uri),
            groupKey,
            diagnosticNoticeNavigationTarget(uri, diagnostic),
          ),
        ),
        DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT,
        (hiddenCount) => buildDiagnosticOverflowNotice("Language Server", groupKey, hiddenCount),
      ),
    });
  }

  if (nextDiagnosticsByPath === diagnosticsByPath) return true;
  diagnosticsByOwnerRef.current[ownerKey] = nextDiagnosticsByPath;
  if (isActiveRoot) setDiagnosticsByPath(nextDiagnosticsByPath);
  if (noticeUpdates.length === 0) return true;
  setNotices((current) =>
    capWorkbenchNotices(
      noticeUpdates.reduce(
        (next, update) => replaceWorkbenchNoticeGroup(next, update.groupKey, update.notices),
        current,
      ),
      GLOBAL_NOTICE_LIMIT,
      isCappableDiagnosticNotice,
    ),
  );
  return true;
}

function languageServerDiagnosticsEqual(
  left: readonly LanguageServerDiagnostic[],
  right: readonly LanguageServerDiagnostic[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((diagnostic, index) => {
    const comparison = right[index];
    return (
      diagnostic.message === comparison.message &&
      diagnostic.source === comparison.source &&
      diagnostic.severity === comparison.severity &&
      diagnostic.line === comparison.line &&
      diagnostic.character === comparison.character &&
      diagnostic.endLine === comparison.endLine &&
      diagnostic.endCharacter === comparison.endCharacter &&
      diagnostic.code === comparison.code
    );
  });
}
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { fileUriFromPath } from "../domain/languageServerDocumentSync";
import {
  languageServerDiagnosticNoticeGroup,
  languageServerDiagnosticNoticeMessage,
  languageServerDiagnosticNoticeSeverity,
  type LanguageServerDiagnostic,
} from "../domain/languageServerDiagnostics";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import { filterPhpLanguageServerDiagnostics } from "../domain/phpLanguageServerDiagnosticFilters";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  buildDiagnosticOverflowNotice,
  DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT,
  diagnosticNoticeNavigationTarget,
  GLOBAL_NOTICE_LIMIT,
  isCappableDiagnosticNotice,
} from "./diagnosticNotices";
import {
  capDiagnosticNotices,
  capWorkbenchNotices,
  createWorkbenchNotice,
  replaceWorkbenchNoticeGroup,
  type WorkbenchNotice,
} from "./workbenchNotice";
