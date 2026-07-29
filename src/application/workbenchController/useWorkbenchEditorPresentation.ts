import { useMemo } from "react";
import { isSessionPathInWorkspace } from "../documentSessionState";
import { isJavaScriptTypeScriptLanguageServerDocument } from "../../domain/languageServerDocumentSync";
import { isJsTestRelativePath } from "../../domain/jsTestFilePatterns";
import { isPhpTestRelativePath } from "../../domain/phpTestNavigation";
import type { MarkdownPreviewTab } from "../../domain/markdownPreview";
import { editorGroupsUniquePaths, type EditorGroupsState } from "../../domain/editorGroups";
import {
  workspaceRelativePath,
  type EditorDocument,
  type ImageTab,
  type WorkspaceDescriptor,
} from "../../domain/workspace";

interface WorkbenchEditorPresentationInput {
  readonly activeDocument: EditorDocument | null;
  readonly documents: Readonly<Record<string, EditorDocument>>;
  readonly editorGroups: EditorGroupsState;
  readonly imageTabs: Readonly<Record<string, ImageTab>>;
  readonly markdownPreviewTabs: Readonly<Record<string, MarkdownPreviewTab>>;
  readonly workspaceDescriptor: WorkspaceDescriptor | null;
  readonly workspaceRoot: string | null;
}

export function useWorkbenchEditorPresentation({
  activeDocument,
  documents,
  editorGroups,
  imageTabs,
  markdownPreviewTabs,
  workspaceDescriptor,
  workspaceRoot,
}: WorkbenchEditorPresentationInput) {
  const isActiveDocumentPhpTest = useMemo(() => {
    if (!activeDocument || activeDocument.language !== "php" || !workspaceRoot) {
      return false;
    }

    const psr4Roots = workspaceDescriptor?.php?.psr4Roots;
    if (!psr4Roots) {
      return false;
    }

    const relativePath = workspaceRelativePath(workspaceRoot, activeDocument.path);
    return relativePath ? isPhpTestRelativePath(relativePath, psr4Roots) : false;
  }, [activeDocument, workspaceDescriptor, workspaceRoot]);

  const isActiveDocumentJsTest = useMemo(() => {
    if (
      !activeDocument ||
      !workspaceRoot ||
      !isJavaScriptTypeScriptLanguageServerDocument(activeDocument) ||
      !workspaceDescriptor?.javaScriptTypeScript
    ) {
      return false;
    }

    const relativePath = workspaceRelativePath(workspaceRoot, activeDocument.path);
    return relativePath ? isJsTestRelativePath(relativePath) : false;
  }, [activeDocument, workspaceDescriptor, workspaceRoot]);

  const openDocumentPaths = useMemo(() => editorGroupsUniquePaths(editorGroups), [editorGroups]);
  const openDocuments = useMemo(
    () =>
      openDocumentPaths
        .map((path) => documents[path])
        .filter((document): document is EditorDocument => !!document),
    [documents, openDocumentPaths],
  );
  const openTabs = useMemo(
    () =>
      openDocumentPaths.flatMap((path) => {
        const tab = documents[path] ?? imageTabs[path] ?? markdownPreviewTabs[path];
        return tab ? [tab] : [];
      }),
    [documents, imageTabs, markdownPreviewTabs, openDocumentPaths],
  );
  const openMarkdownPreviews = useMemo(
    () =>
      openDocumentPaths
        .map((path) => markdownPreviewTabs[path])
        .filter((preview): preview is MarkdownPreviewTab => !!preview),
    [markdownPreviewTabs, openDocumentPaths],
  );
  const hasOpenJavaScriptTypeScriptDocument = openDocuments.some(
    (document) =>
      isJavaScriptTypeScriptLanguageServerDocument(document) &&
      Boolean(workspaceRoot && isSessionPathInWorkspace(workspaceRoot, document.path)),
  );

  return {
    isActiveDocumentJsTest,
    isActiveDocumentPhpTest,
    openDocumentPaths,
    openDocuments,
    openMarkdownPreviews,
    openTabs,
    shouldAutoStartJavaScriptTypeScriptLanguageServer:
      !!workspaceDescriptor?.javaScriptTypeScript || hasOpenJavaScriptTypeScriptDocument,
  } as const;
}
