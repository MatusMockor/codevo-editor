import { useMemo } from "react";
import {
  activeDotenvLocalDiagnosticNotices as buildActiveDotenvLocalDiagnosticNotices,
  activePhpLocalDiagnosticNotices as buildActivePhpLocalDiagnosticNotices,
  composeEffectiveDiagnosticNotices,
  localPhpDiagnosticsFromSource,
  phpLocalDiagnosticFileIdentity,
} from "../diagnosticNotices";
import { mergeDiagnosticsByPath, mergePhpFileOutlines } from "./diagnosticProjection";
import { summarizeDiagnosticsByPath } from "../../domain/diagnosticsSummary";
import { dotenvDiagnosticsFromSource } from "../../domain/dotenvDiagnostics";
import { isLanguageServerDocument } from "../../domain/languageServerDocumentSync";
import { isJavaScriptTypeScriptLanguageServerDocument } from "../../domain/languageServerDocumentSync";
import type { LanguageServerDiagnostic } from "../../domain/languageServerDiagnostics";
import type { PhpFileOutline, PhpFileStructureScope } from "../../domain/phpFileOutline";
import type { EditorDocument } from "../../domain/workspace";
import type { WorkbenchNotice } from "../workbenchNotice";

type DiagnosticsByPath = Readonly<Record<string, LanguageServerDiagnostic[]>>;

interface WorkbenchDiagnosticPresentationInput {
  readonly activeDocument: EditorDocument | null;
  readonly fileStructureScope: PhpFileStructureScope;
  readonly frameworkDiagnosticsByPath: DiagnosticsByPath;
  readonly isExternallyRemovedDocumentPath: (path: string) => boolean;
  readonly javaScriptTypeScriptDiagnosticsByPath: DiagnosticsByPath;
  readonly javaScriptTypeScriptFileStructureLoadingForDocument: (
    document: EditorDocument | null,
  ) => boolean;
  readonly javaScriptTypeScriptFileStructureOutlineForDocument: (
    document: EditorDocument | null,
  ) => PhpFileOutline | null;
  readonly languageServerDiagnosticsByPath: DiagnosticsByPath;
  readonly loadingInheritedPhpFileOutlinePaths: ReadonlySet<string>;
  readonly loadingPhpFileOutlinePaths: ReadonlySet<string>;
  readonly notices: WorkbenchNotice[];
  readonly phpFileOutlinesByPath: Readonly<Record<string, PhpFileOutline>>;
  readonly phpInheritedFileOutlinesByPath: Readonly<Record<string, PhpFileOutline>>;
  readonly phpLocalDiagnosticsByPath: DiagnosticsByPath;
}

export function useWorkbenchDiagnosticPresentation({
  activeDocument,
  fileStructureScope,
  frameworkDiagnosticsByPath,
  isExternallyRemovedDocumentPath,
  javaScriptTypeScriptDiagnosticsByPath,
  javaScriptTypeScriptFileStructureLoadingForDocument,
  javaScriptTypeScriptFileStructureOutlineForDocument,
  languageServerDiagnosticsByPath,
  loadingInheritedPhpFileOutlinePaths,
  loadingPhpFileOutlinePaths,
  notices,
  phpFileOutlinesByPath,
  phpInheritedFileOutlinesByPath,
  phpLocalDiagnosticsByPath,
}: WorkbenchDiagnosticPresentationInput) {
  const fileStructureOutline = useMemo(() => {
    if (!activeDocument) {
      return null;
    }

    if (isJavaScriptTypeScriptLanguageServerDocument(activeDocument)) {
      return javaScriptTypeScriptFileStructureOutlineForDocument(activeDocument);
    }

    const currentOutline = phpFileOutlinesByPath[activeDocument.path] ?? null;
    if (fileStructureScope === "current") {
      return currentOutline;
    }

    return mergePhpFileOutlines(
      currentOutline,
      phpInheritedFileOutlinesByPath[activeDocument.path] ?? null,
    );
  }, [
    activeDocument,
    fileStructureScope,
    javaScriptTypeScriptFileStructureOutlineForDocument,
    phpFileOutlinesByPath,
    phpInheritedFileOutlinesByPath,
  ]);
  const fileStructureLoading = Boolean(
    activeDocument &&
    (javaScriptTypeScriptFileStructureLoadingForDocument(activeDocument) ||
      loadingPhpFileOutlinePaths.has(activeDocument.path) ||
      (fileStructureScope === "inherited" &&
        loadingInheritedPhpFileOutlinePaths.has(activeDocument.path))),
  );
  const fileStructureCanIncludeInheritedMembers =
    !!activeDocument && isLanguageServerDocument(activeDocument);

  const activeDotenvDiagnosticsByPath = useMemo(() => {
    if (
      !activeDocument ||
      activeDocument.language !== "dotenv" ||
      isExternallyRemovedDocumentPath(activeDocument.path)
    ) {
      return {};
    }

    const diagnostics = dotenvDiagnosticsFromSource(activeDocument.content);
    return diagnostics.length === 0 ? {} : { [activeDocument.path]: diagnostics };
  }, [activeDocument, isExternallyRemovedDocumentPath]);
  const mergedLanguageServerDiagnosticsByPath = useMemo(
    () =>
      mergeDiagnosticsByPath(
        languageServerDiagnosticsByPath,
        javaScriptTypeScriptDiagnosticsByPath,
        frameworkDiagnosticsByPath,
        activeDotenvDiagnosticsByPath,
      ),
    [
      activeDotenvDiagnosticsByPath,
      frameworkDiagnosticsByPath,
      javaScriptTypeScriptDiagnosticsByPath,
      languageServerDiagnosticsByPath,
    ],
  );
  const activePhpLocalDiagnosticsByPath = useMemo(() => {
    if (
      !activeDocument ||
      activeDocument.language !== "php" ||
      !phpLocalDiagnosticFileIdentity(activeDocument.path) ||
      isExternallyRemovedDocumentPath(activeDocument.path)
    ) {
      return {};
    }

    const diagnostics = localPhpDiagnosticsFromSource(activeDocument.content, []);
    return diagnostics.length === 0 ? {} : { [activeDocument.path]: diagnostics };
  }, [activeDocument, isExternallyRemovedDocumentPath]);
  const effectivePhpLocalDiagnosticsByPath = useMemo(() => {
    if (!activeDocument || activeDocument.language !== "php") {
      return phpLocalDiagnosticsByPath;
    }

    if (activeDocument.path in activePhpLocalDiagnosticsByPath) {
      return { ...phpLocalDiagnosticsByPath, ...activePhpLocalDiagnosticsByPath };
    }

    if (!(activeDocument.path in phpLocalDiagnosticsByPath)) {
      return phpLocalDiagnosticsByPath;
    }

    const next = { ...phpLocalDiagnosticsByPath };
    delete next[activeDocument.path];
    return next;
  }, [activeDocument, activePhpLocalDiagnosticsByPath, phpLocalDiagnosticsByPath]);
  const activePhpLocalDiagnosticNotices = useMemo(
    () => buildActivePhpLocalDiagnosticNotices(activeDocument, activePhpLocalDiagnosticsByPath),
    [activeDocument, activePhpLocalDiagnosticsByPath],
  );
  const activeDotenvDiagnosticNotices = useMemo(
    () => buildActiveDotenvLocalDiagnosticNotices(activeDocument, activeDotenvDiagnosticsByPath),
    [activeDocument, activeDotenvDiagnosticsByPath],
  );
  const effectiveNotices = useMemo(
    () =>
      composeEffectiveDiagnosticNotices({
        activeDocument,
        activeDotenvDiagnosticNotices,
        activePhpLocalDiagnosticNotices,
        notices,
      }),
    [activeDocument, activeDotenvDiagnosticNotices, activePhpLocalDiagnosticNotices, notices],
  );
  const diagnosticsSummary = useMemo(
    () =>
      summarizeDiagnosticsByPath(
        mergeDiagnosticsByPath(
          mergedLanguageServerDiagnosticsByPath,
          effectivePhpLocalDiagnosticsByPath,
        ),
      ),
    [effectivePhpLocalDiagnosticsByPath, mergedLanguageServerDiagnosticsByPath],
  );

  return {
    diagnosticsSummary,
    effectiveNotices,
    fileStructureCanIncludeInheritedMembers,
    fileStructureLoading,
    fileStructureOutline,
    mergedLanguageServerDiagnosticsByPath,
  } as const;
}
