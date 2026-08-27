import { useCallback } from "react";
import type { EditorGroupFocusRunner } from "../editorGroupFocusPort";
import { isSessionPathInWorkspace } from "../documentSessionState";
import {
  editorGroupsReducer,
  reorderEditorGroupTabs,
  transferEditorGroupTab,
  type EditorGroupId,
  type EditorGroupsState,
  type EditorSplitDirection,
} from "../../domain/editorGroups";
import { editorGroupIdsInLayout } from "../../domain/editorLayout";
import type { WorkspaceSessionViewState } from "../../domain/settings";
import type { TabDropPosition } from "../../domain/tabOrdering";

type WorkspaceEditorViewStates = Record<
  string,
  Record<EditorGroupId, Record<string, WorkspaceSessionViewState>>
>;

interface WorkbenchEditorGroupCoordinatorDependencies {
  readonly clearGitDiffPreviewState: () => void;
  readonly currentWorkspaceRootRef: { readonly current: string | null };
  readonly editorGroupFocusRunner?: EditorGroupFocusRunner | null;
  readonly editorGroupsRef: { readonly current: EditorGroupsState };
  readonly editorSessionOwnerKeyForRoot: (rootPath: string) => string;
  readonly isGitDiffDocumentPath: (path: string) => boolean;
  readonly loadGitDiffDocument: (path: string) => void;
  readonly nextEditorGroupIdRef: { current: number };
  readonly updateEditorGroups: (update: (current: EditorGroupsState) => EditorGroupsState) => void;
  readonly workspaceEditorViewStatesRef: { readonly current: WorkspaceEditorViewStates };
}

interface WorkbenchEditorGroupCoordinator {
  readonly activateEditorGroup: (groupId: EditorGroupId) => void;
  readonly activateEditorGroupTab: (groupId: EditorGroupId, path: string) => void;
  readonly splitActiveEditorGroup: (direction: EditorSplitDirection) => void;
  readonly focusAdjacentEditorGroup: (offset: -1 | 1) => void;
  readonly moveActiveTabToAdjacentGroup: (offset: -1 | 1) => void;
  readonly moveEditorGroupTab: (
    fromGroupId: EditorGroupId,
    toGroupId: EditorGroupId,
    path: string,
  ) => void;
  readonly reorderEditorGroupTab: (
    groupId: EditorGroupId,
    fromPath: string,
    toPath: string,
    position: TabDropPosition,
  ) => void;
  readonly pinEditorGroupTab: (groupId: EditorGroupId, path: string) => void;
  readonly resizeEditorSplit: (
    splitPath: readonly number[],
    sizes: readonly [number, number],
  ) => void;
  readonly reorderOpenTabs: (fromPath: string, toPath: string, position: TabDropPosition) => void;
  readonly updateEditorViewState: (path: string, viewState: WorkspaceSessionViewState) => void;
  readonly updateEditorGroupViewState: (
    groupId: EditorGroupId,
    path: string,
    viewState: WorkspaceSessionViewState,
  ) => void;
}

export function useWorkbenchEditorGroupCoordinator({
  clearGitDiffPreviewState,
  currentWorkspaceRootRef,
  editorGroupFocusRunner,
  editorGroupsRef,
  editorSessionOwnerKeyForRoot,
  isGitDiffDocumentPath,
  loadGitDiffDocument,
  nextEditorGroupIdRef,
  updateEditorGroups,
  workspaceEditorViewStatesRef,
}: WorkbenchEditorGroupCoordinatorDependencies): WorkbenchEditorGroupCoordinator {
  const activateEditorGroup = useCallback(
    (groupId: EditorGroupId) => {
      updateEditorGroups((current) =>
        editorGroupsReducer(current, { type: "activate-group", groupId }),
      );
    },
    [updateEditorGroups],
  );

  const activateEditorGroupTab = useCallback(
    (groupId: EditorGroupId, path: string) => {
      const group = editorGroupsRef.current.groups[groupId];

      if (!group || (!group.openPaths.includes(path) && group.previewPath !== path)) {
        return;
      }

      updateEditorGroups((current) => {
        const activated = editorGroupsReducer(current, {
          type: "activate-group",
          groupId,
        });
        return editorGroupsReducer(activated, {
          type: "activate-tab",
          groupId,
          path,
        });
      });

      if (isGitDiffDocumentPath(path)) {
        loadGitDiffDocument(path);
        return;
      }

      clearGitDiffPreviewState();
    },
    [
      clearGitDiffPreviewState,
      editorGroupsRef,
      isGitDiffDocumentPath,
      loadGitDiffDocument,
      updateEditorGroups,
    ],
  );

  const splitActiveEditorGroup = useCallback(
    (direction: EditorSplitDirection) => {
      updateEditorGroups((current) => {
        let newGroupId = `editor-${nextEditorGroupIdRef.current++}`;
        while (Object.prototype.hasOwnProperty.call(current.groups, newGroupId)) {
          newGroupId = `editor-${nextEditorGroupIdRef.current++}`;
        }
        return editorGroupsReducer(current, {
          type: "split-group",
          direction,
          newGroupId,
        });
      });
    },
    [nextEditorGroupIdRef, updateEditorGroups],
  );

  const focusAdjacentEditorGroup = useCallback(
    (offset: -1 | 1) => {
      const current = editorGroupsRef.current;
      const groupIds = editorGroupIdsInLayout(current.layout);
      if (groupIds.length < 2) {
        return;
      }

      const activeIndex = groupIds.indexOf(current.activeGroupId);
      const nextIndex = (activeIndex + offset + groupIds.length) % groupIds.length;
      const targetGroupId = groupIds[nextIndex];
      updateEditorGroups((state) =>
        editorGroupsReducer(state, {
          type: "activate-group",
          groupId: targetGroupId,
        }),
      );
      editorGroupFocusRunner?.(targetGroupId);
    },
    [editorGroupFocusRunner, editorGroupsRef, updateEditorGroups],
  );

  const moveActiveTabToAdjacentGroup = useCallback(
    (offset: -1 | 1) => {
      updateEditorGroups((current) => {
        const groupIds = editorGroupIdsInLayout(current.layout);
        if (groupIds.length < 2) {
          return current;
        }
        const sourceIndex = groupIds.indexOf(current.activeGroupId);
        const targetIndex = (sourceIndex + offset + groupIds.length) % groupIds.length;
        const path = current.groups[current.activeGroupId]?.activePath;
        if (!path) {
          return current;
        }
        return transferEditorGroupTab(
          current,
          current.activeGroupId,
          groupIds[targetIndex],
          path,
          "move",
        );
      });
    },
    [updateEditorGroups],
  );

  const moveEditorGroupTab = useCallback(
    (fromGroupId: EditorGroupId, toGroupId: EditorGroupId, path: string) => {
      updateEditorGroups((current) =>
        transferEditorGroupTab(current, fromGroupId, toGroupId, path, "move"),
      );
    },
    [updateEditorGroups],
  );

  const reorderEditorGroupTab = useCallback(
    (groupId: EditorGroupId, fromPath: string, toPath: string, position: TabDropPosition) => {
      updateEditorGroups((current) =>
        editorGroupsReducer(current, {
          type: "reorder-tab",
          fromPath,
          groupId,
          position,
          toPath,
        }),
      );
    },
    [updateEditorGroups],
  );

  const pinEditorGroupTab = useCallback(
    (groupId: EditorGroupId, path: string) => {
      updateEditorGroups((current) =>
        editorGroupsReducer(current, {
          type: "pin-tab",
          groupId,
          path,
        }),
      );
    },
    [updateEditorGroups],
  );

  const resizeEditorSplit = useCallback(
    (splitPath: readonly number[], sizes: readonly [number, number]) => {
      updateEditorGroups((current) =>
        editorGroupsReducer(current, {
          type: "resize-split",
          sizes,
          splitPath,
        }),
      );
    },
    [updateEditorGroups],
  );

  const reorderOpenTabs = useCallback(
    (fromPath: string, toPath: string, position: TabDropPosition) => {
      updateEditorGroups((current) => ({
        ...current,
        groups: {
          ...current.groups,
          [current.activeGroupId]: reorderEditorGroupTabs(current.groups[current.activeGroupId], {
            fromPath,
            toPath,
            position,
          }),
        },
      }));
    },
    [updateEditorGroups],
  );

  const updateEditorViewState = useCallback(
    (path: string, viewState: WorkspaceSessionViewState) => {
      const rootPath = currentWorkspaceRootRef.current;

      if (!rootPath || !isSessionPathInWorkspace(rootPath, path)) {
        return;
      }

      const ownerKey = editorSessionOwnerKeyForRoot(rootPath);
      const current = workspaceEditorViewStatesRef.current[ownerKey] ?? {};
      const groupId = editorGroupsRef.current.activeGroupId;
      current[groupId] = { ...(current[groupId] ?? {}), [path]: viewState };
      workspaceEditorViewStatesRef.current[ownerKey] = current;
    },
    [
      currentWorkspaceRootRef,
      editorGroupsRef,
      editorSessionOwnerKeyForRoot,
      workspaceEditorViewStatesRef,
    ],
  );

  const updateEditorGroupViewState = useCallback(
    (groupId: EditorGroupId, path: string, viewState: WorkspaceSessionViewState) => {
      const rootPath = currentWorkspaceRootRef.current;
      if (!rootPath || !isSessionPathInWorkspace(rootPath, path)) {
        return;
      }
      const ownerKey = editorSessionOwnerKeyForRoot(rootPath);
      const current = workspaceEditorViewStatesRef.current[ownerKey] ?? {};
      current[groupId] = { ...(current[groupId] ?? {}), [path]: viewState };
      workspaceEditorViewStatesRef.current[ownerKey] = current;
    },
    [currentWorkspaceRootRef, editorSessionOwnerKeyForRoot, workspaceEditorViewStatesRef],
  );

  return {
    activateEditorGroup,
    activateEditorGroupTab,
    splitActiveEditorGroup,
    focusAdjacentEditorGroup,
    moveActiveTabToAdjacentGroup,
    moveEditorGroupTab,
    reorderEditorGroupTab,
    pinEditorGroupTab,
    resizeEditorSplit,
    reorderOpenTabs,
    updateEditorViewState,
    updateEditorGroupViewState,
  };
}
