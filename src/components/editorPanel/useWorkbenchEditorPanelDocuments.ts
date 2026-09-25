import type { AgentWorkbenchLayoutAction } from "../../domain/agentWorkbenchLayout";
import type { EditorGroupId, EditorGroupsState } from "../../domain/editorGroups";
import type { EditorGroupDocument } from "../EditorGroupView";
import type { EditorPanelFileStatuses } from "./editorPanelDocuments";
import {
  useEditorPanelDocumentsValue,
  type EditorPanelDocumentsValue,
} from "./EditorPanelDocumentsContext";

export interface EditorPanelDocumentsHost {
  activateEditorGroupTab(groupId: EditorGroupId, path: string): void;
  closeDocumentInEditorGroup(groupId: EditorGroupId, path: string): Promise<unknown>;
  setQuickOpenOpen(open: boolean): void;
  pinEditorGroupTab(groupId: EditorGroupId, path: string): void;
}

export interface EditorPanelDocumentsWorkbench {
  readonly agentWorkbench: {
    dispatch(action: AgentWorkbenchLayoutAction): void;
  };
}

export function useWorkbenchEditorPanelDocuments(
  host: EditorPanelDocumentsHost,
  workbench: EditorPanelDocumentsWorkbench,
  ownerKey: string | null,
  groups: EditorGroupsState,
  documents: ReadonlyArray<EditorGroupDocument>,
  fileStatusesByPath: EditorPanelFileStatuses,
): EditorPanelDocumentsValue | null {
  const groupId = groups.activeGroupId;
  const layout = workbench.agentWorkbench;
  return useEditorPanelDocumentsValue({
    ownerKey,
    group: groups.groups[groupId] ?? null,
    documents,
    fileStatusesByPath,
    onActivate: (path) => {
      host.activateEditorGroupTab(groupId, path);
      layout.dispatch({ kind: "activateSurface", surface: "editor" });
    },
    onClose: (path) => void host.closeDocumentInEditorGroup(groupId, path),
    onOpenFile: () => host.setQuickOpenOpen(true),
    onPin: (path) => host.pinEditorGroupTab(groupId, path),
    onEmpty: () => layout.dispatch({ kind: "closeSurfaceTab", surface: "editor" }),
  });
}
