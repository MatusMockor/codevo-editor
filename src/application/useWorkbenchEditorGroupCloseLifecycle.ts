import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  clearEslintDiagnosticsForFile,
  type EslintDiagnosticsByRoot,
} from "../domain/eslintDiagnostics";
import type { MarkdownPreviewTab } from "../domain/markdownPreview";
import {
  clearPhpstanDiagnosticsForFile,
  type PhpstanDiagnosticsByRoot,
} from "../domain/phpstanDiagnostics";
import type { EditorDocument, ImageTab } from "../domain/workspace";
import { isDirty } from "../domain/workspace";
import {
  activateEditorGroupPath,
  closeEditorGroup,
  closeEditorGroupPath,
  closeEditorGroupTab,
  editorGroupVisiblePaths,
  type EditorGroupId,
  type EditorGroupsState,
} from "../domain/editorGroups";
import type { DocumentCloseOptions } from "./useDocumentLifecycle";
import type { WorkbenchPrompter } from "./workbenchPrompter";

export interface WorkbenchEditorGroupCloseLifecycleDependencies {
  workspaceRoot: string | null;

  currentWorkspaceRootRef: MutableRefObject<string | null>;
  editorGroupsRef: MutableRefObject<EditorGroupsState>;
  openPathsRef: MutableRefObject<string[]>;
  previewPathRef: MutableRefObject<string | null>;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  imageTabsRef: MutableRefObject<Record<string, ImageTab>>;
  markdownPreviewTabsRef: MutableRefObject<Record<string, MarkdownPreviewTab>>;

  setImageTabs: Dispatch<SetStateAction<Record<string, ImageTab>>>;
  setMarkdownPreviewTabs: Dispatch<
    SetStateAction<Record<string, MarkdownPreviewTab>>
  >;
  setEslintDiagnosticsByRoot: Dispatch<
    SetStateAction<EslintDiagnosticsByRoot>
  >;
  setPhpstanDiagnosticsByRoot: Dispatch<
    SetStateAction<PhpstanDiagnosticsByRoot>
  >;
  updateEditorGroups: (
    update: (current: EditorGroupsState) => EditorGroupsState,
  ) => void;

  closeTextDocument: (path: string, options?: DocumentCloseOptions) => void;
  closeTextSurface: (options?: DocumentCloseOptions) => void;
  hasExternalFileConflict: (rootPath: string | null, path: string) => boolean;
  prompter: WorkbenchPrompter;
}

export interface WorkbenchEditorGroupCloseLifecycle {
  closeDocument: (path: string, options?: DocumentCloseOptions) => void;
  closeDocumentInEditorGroup: (
    groupId: EditorGroupId,
    path: string,
    options?: DocumentCloseOptions,
  ) => void;
  closeActiveEditorGroup: () => void;
  closeActiveSurface: () => void;
  closeActiveEditorGroupSurface: () => void;
}

export function useWorkbenchEditorGroupCloseLifecycle(
  dependencies: WorkbenchEditorGroupCloseLifecycleDependencies,
): WorkbenchEditorGroupCloseLifecycle {
  const {
    workspaceRoot,
    currentWorkspaceRootRef,
    editorGroupsRef,
    openPathsRef,
    previewPathRef,
    activeDocumentRef,
    documentsRef,
    imageTabsRef,
    markdownPreviewTabsRef,
    setImageTabs,
    setMarkdownPreviewTabs,
    setEslintDiagnosticsByRoot,
    setPhpstanDiagnosticsByRoot,
    updateEditorGroups,
    closeTextDocument,
    closeTextSurface,
    hasExternalFileConflict,
    prompter,
  } = dependencies;

  const clearCodeQualityDiagnostics = useCallback(
    (path: string) => {
      const rootPath = currentWorkspaceRootRef.current;

      if (!rootPath) {
        return;
      }

      setEslintDiagnosticsByRoot((current) =>
        clearEslintDiagnosticsForFile(current, rootPath, path),
      );
      setPhpstanDiagnosticsByRoot((current) =>
        clearPhpstanDiagnosticsForFile(current, rootPath, path),
      );
    },
    [
      currentWorkspaceRootRef,
      setEslintDiagnosticsByRoot,
      setPhpstanDiagnosticsByRoot,
    ],
  );

  const closeDocument = useCallback(
    (path: string, options: DocumentCloseOptions = {}) => {
      clearCodeQualityDiagnostics(path);

      const markdownPreview = markdownPreviewTabsRef.current[path];

      if (!imageTabsRef.current[path] && !markdownPreview) {
        closeTextDocument(path, options);
        return;
      }
      const nextMarkdownPreviews = { ...markdownPreviewTabsRef.current };
      const nextImages = { ...imageTabsRef.current };
      delete nextMarkdownPreviews[path];
      delete nextImages[path];

      const current = editorGroupsRef.current;
      const activeGroupId = current.activeGroupId;
      const activeGroup = current.groups[activeGroupId];
      if (!activeGroup) {
        return;
      }
      const nextGroup = closeEditorGroupPath(activeGroup, path);
      imageTabsRef.current = nextImages;
      markdownPreviewTabsRef.current = nextMarkdownPreviews;
      openPathsRef.current = nextGroup.openPaths;
      previewPathRef.current = nextGroup.previewPath;
      activeDocumentRef.current = nextGroup.activePath
        ? documentsRef.current[nextGroup.activePath] ?? null
        : null;
      setImageTabs(nextImages);
      setMarkdownPreviewTabs(nextMarkdownPreviews);
      updateEditorGroups((latest) => ({
        ...latest,
        groups: {
          ...latest.groups,
          [latest.activeGroupId]: closeEditorGroupPath(
            latest.groups[latest.activeGroupId],
            path,
          ),
        },
      }));
    },
    [
      activeDocumentRef,
      clearCodeQualityDiagnostics,
      closeTextDocument,
      documentsRef,
      editorGroupsRef,
      imageTabsRef,
      markdownPreviewTabsRef,
      openPathsRef,
      previewPathRef,
      setImageTabs,
      setMarkdownPreviewTabs,
      updateEditorGroups,
    ],
  );

  const closeDocumentInEditorGroup = useCallback(
    (
      groupId: EditorGroupId,
      path: string,
      options: DocumentCloseOptions = {},
    ) => {
      const current = editorGroupsRef.current;
      const result = closeEditorGroupTab(current, groupId, path);
      if (!result.membershipRemoved) {
        return;
      }
      if (!result.finalMembershipRemoved) {
        updateEditorGroups(() => result.state);
        return;
      }

      const target = current.groups[groupId];
      if (!target) {
        return;
      }
      const activated = {
        ...current,
        activeGroupId: groupId,
        groups: {
          ...current.groups,
          [groupId]: activateEditorGroupPath(target, path),
        },
      };
      editorGroupsRef.current = activated;
      openPathsRef.current = target.openPaths;
      previewPathRef.current = target.previewPath;
      activeDocumentRef.current = documentsRef.current[path] ?? null;
      updateEditorGroups(() => activated);
      closeDocument(path, options);
    },
    [
      activeDocumentRef,
      closeDocument,
      documentsRef,
      editorGroupsRef,
      openPathsRef,
      previewPathRef,
      updateEditorGroups,
    ],
  );

  const closeActiveEditorGroup = useCallback(() => {
    const current = editorGroupsRef.current;
    const groupId = current.activeGroupId;
    const group = current.groups[groupId];
    if (!group) {
      return;
    }
    const visiblePaths = editorGroupVisiblePaths(group);
    const finalMembershipPaths = closeEditorGroup(
      current,
      groupId,
    ).finalMembershipPaths;
    const shouldAbort = finalMembershipPaths.some((path) => {
      const document = documentsRef.current[path];
      const hasConflict = hasExternalFileConflict(workspaceRoot, path);
      if (!document || (!isDirty(document) && !hasConflict)) {
        return false;
      }
      return !prompter.confirm(
        hasConflict
          ? "Close file with an unresolved external conflict?"
          : "Discard changes?",
      );
    });
    if (shouldAbort) {
      return;
    }
    visiblePaths.forEach((path) =>
      closeDocumentInEditorGroup(groupId, path, {
        skipConfirmation: true,
      }),
    );
    updateEditorGroups((state) => closeEditorGroup(state, groupId).state);
  }, [
    closeDocumentInEditorGroup,
    documentsRef,
    editorGroupsRef,
    hasExternalFileConflict,
    prompter,
    updateEditorGroups,
    workspaceRoot,
  ]);

  const closeActiveSurface = useCallback(() => {
    const current = editorGroupsRef.current;
    const activePath =
      current.groups[current.activeGroupId]?.activePath ?? null;
    if (
      activePath &&
      (imageTabsRef.current[activePath] ||
        markdownPreviewTabsRef.current[activePath])
    ) {
      closeDocument(activePath);
      return;
    }

    if (activePath) {
      clearCodeQualityDiagnostics(activePath);
    }

    closeTextSurface();
  }, [
    clearCodeQualityDiagnostics,
    closeDocument,
    closeTextSurface,
    editorGroupsRef,
    imageTabsRef,
    markdownPreviewTabsRef,
  ]);

  const closeActiveEditorGroupSurface = useCallback(() => {
    const current = editorGroupsRef.current;
    const group = current.groups[current.activeGroupId];
    if (group?.activePath) {
      closeDocumentInEditorGroup(current.activeGroupId, group.activePath);
      return;
    }
    if (Object.keys(current.groups).length > 1) {
      closeActiveEditorGroup();
      return;
    }
    closeActiveSurface();
  }, [
    closeActiveEditorGroup,
    closeActiveSurface,
    closeDocumentInEditorGroup,
    editorGroupsRef,
  ]);

  return {
    closeDocument,
    closeDocumentInEditorGroup,
    closeActiveEditorGroup,
    closeActiveSurface,
    closeActiveEditorGroupSurface,
  };
}
