import type { EditorGroupsState } from "../domain/editorGroups";
import type { WorkspaceSessionState } from "../domain/settings";

export function isActivationOnlyWorkspaceSessionChange(
  previous: WorkspaceSessionState,
  next: WorkspaceSessionState,
): boolean {
  if (previous.bottomPanelView !== next.bottomPanelView) {
    return false;
  }

  if (previous.sidebarView !== next.sidebarView) {
    return false;
  }

  return workspaceSessionEditorStructuresEqual(previous.editor, next.editor);
}

export function mergeActivationOnlyWorkspaceSession(
  base: WorkspaceSessionState,
  activation: WorkspaceSessionState,
): WorkspaceSessionState {
  return {
    ...base,
    editor: activation.editor,
    navigation: activation.navigation,
    viewStates: activation.viewStates,
  };
}

function workspaceSessionEditorStructuresEqual(
  left: EditorGroupsState,
  right: EditorGroupsState,
): boolean {
  const leftGroupIds = Object.keys(left.groups);
  const rightGroupIds = Object.keys(right.groups);

  if (leftGroupIds.length !== rightGroupIds.length) {
    return false;
  }

  if (JSON.stringify(left.layout) !== JSON.stringify(right.layout)) {
    return false;
  }

  return leftGroupIds.every((groupId) => {
    const leftGroup = left.groups[groupId];
    const rightGroup = right.groups[groupId];

    if (!rightGroup) {
      return false;
    }

    if (leftGroup.previewPath !== rightGroup.previewPath) {
      return false;
    }

    if (leftGroup.openPaths.length !== rightGroup.openPaths.length) {
      return false;
    }

    return leftGroup.openPaths.every((path, index) => path === rightGroup.openPaths[index]);
  });
}
