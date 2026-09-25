import { useMemo } from "react";
import type { useWorkbenchController } from "../../application/useWorkbenchController";
import { createInitialEditorGroupsState } from "../../domain/editorGroups";
import type { EditorPanelFileStatuses } from "./editorPanelDocuments";
import {
  useWorkbenchEditorPanelDocuments,
  type EditorPanelDocumentsHost,
} from "./useWorkbenchEditorPanelDocuments";

type Workbench = ReturnType<typeof useWorkbenchController>;

export type WorkbenchEditorGroupsSource = Pick<
  Workbench,
  | "activeDocument"
  | "activePath"
  | "agentWorkbench"
  | "editorGroups"
  | "openDocuments"
  | "openTabs"
  | "previewPath"
>;

export function useWorkbenchEditorGroupsView(
  workbench: WorkbenchEditorGroupsSource,
  editorHost: EditorPanelDocumentsHost,
  ownerKey: string | null,
  fileStatusesByPath: EditorPanelFileStatuses,
) {
  const editorAreaDocuments = useMemo(() => {
    const tabs = Array.isArray(workbench.openTabs) ? workbench.openTabs : workbench.openDocuments;
    if (!workbench.activePath || tabs.some((tab) => tab.path === workbench.activePath)) {
      return tabs;
    }
    const active = workbench.activeDocument;
    if (active) {
      return [...tabs, active];
    }
    return [
      ...tabs,
      {
        content: "",
        language: "plaintext" as const,
        name: workbench.activePath.split("/").pop() ?? workbench.activePath,
        path: workbench.activePath,
        readOnly: true,
        savedContent: "",
      },
    ];
  }, [workbench.activeDocument, workbench.activePath, workbench.openDocuments, workbench.openTabs]);
  const editorGroups = workbench.editorGroups;
  const editorActivePath = workbench.activePath;
  const editorPreviewPath = workbench.previewPath;
  const editorGroupsState = useMemo(() => {
    const candidate: unknown = editorGroups;
    if (
      candidate &&
      typeof candidate === "object" &&
      "groups" in candidate &&
      "layout" in candidate &&
      "activeGroupId" in candidate
    ) {
      return candidate as typeof editorGroups;
    }
    return createInitialEditorGroupsState("editor-main", {
      activePath: editorActivePath,
      openPaths: editorAreaDocuments.map((document) => document.path),
      previewPath: editorPreviewPath,
    });
  }, [editorActivePath, editorAreaDocuments, editorGroups, editorPreviewPath]);
  const editorContentReadyPaths = useMemo(() => {
    const tabs = Array.isArray(workbench.openTabs) ? workbench.openTabs : workbench.openDocuments;
    const paths = new Set(tabs.map((document) => document.path));

    if (workbench.activeDocument) {
      paths.add(workbench.activeDocument.path);
    }

    return paths;
  }, [workbench.activeDocument, workbench.openDocuments, workbench.openTabs]);
  const editorPanelDocuments = useWorkbenchEditorPanelDocuments(
    editorHost,
    workbench,
    ownerKey,
    editorGroupsState,
    editorAreaDocuments,
    fileStatusesByPath,
  );
  return { editorAreaDocuments, editorContentReadyPaths, editorGroupsState, editorPanelDocuments };
}
