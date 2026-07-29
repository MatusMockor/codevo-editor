import { memo, useCallback } from "react";
import type { DebugHoverEvaluationPort } from "../application/useDebugHoverEvaluation";
import type { LiveDocumentRuntime } from "../application/liveDocumentRuntime";
import type { EditorGroupFocusRunner } from "../application/editorGroupFocusPort";
import type { EditorGroupDocumentSessionAuthority } from "../application/useEditorSessionState";
import type { EditorActiveLiveDocumentBinding } from "../application/editorActiveLiveDocumentBinding";
import type { EditorActiveLiveDocumentSaveBinding } from "../application/editorActiveLiveDocumentSaveCoordinator";
import type { AttachEditorGroupLiveDocument } from "../application/editorSessionDocumentAuthority";
import type { EditorJavaScriptTypeScriptIncrementalSyncFacade } from "../application/editorJavaScriptTypeScriptIncrementalSyncFacade";
import type { EditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import type { EditorGroupId, EditorGroupsState } from "../domain/editorGroups";
import type { TabDropPosition } from "../domain/tabOrdering";
import type { EditorGroupDocument, EditorGroupSurface } from "./EditorGroupView";
import type { EditorAreaProps } from "./EditorArea";
import { EditorArea } from "./EditorArea";
import { EditorRuntimeHost } from "./EditorRuntimeHost";

interface WorkbenchEditorHostProps {
  activeGroupId: EditorGroupId;
  attachEditorGroupLiveDocument: AttachEditorGroupLiveDocument;
  contentRevisionForGroup?(groupId: EditorGroupId): unknown;
  debugHover?: DebugHoverEvaluationPort | null;
  documentSessionAuthorityRevision: unknown;
  documents: readonly EditorGroupDocument[];
  editorSessionOwnerKey: EditorSessionOwnerKey | null;
  fileStatusesByPath?: EditorAreaProps["fileStatusesByPath"];
  isEditorGroupDocumentSessionAuthorityCurrent(
    authority: EditorGroupDocumentSessionAuthority,
  ): boolean;
  javaScriptTypeScriptIncrementalSync?: EditorJavaScriptTypeScriptIncrementalSyncFacade | null;
  liveDocumentRuntime: LiveDocumentRuntime;
  projectId: string;
  state: EditorGroupsState;
  onActivateGroup(groupId: EditorGroupId): void;
  onActivateTab?(groupId: EditorGroupId, path: string): void;
  onActiveLiveDocumentBindingChange?(binding: EditorActiveLiveDocumentBinding | null): void;
  onActiveLiveDocumentSaveBindingChange?(binding: EditorActiveLiveDocumentSaveBinding | null): void;
  onCloseDocument(path: string): Promise<unknown>;
  onCloseTab?(groupId: EditorGroupId, path: string): Promise<unknown>;
  onGroupFocusRunnerChange?(runner: EditorGroupFocusRunner | null): void;
  onMoveTab(fromGroupId: EditorGroupId, toGroupId: EditorGroupId, path: string): void;
  onPinTab(groupId: EditorGroupId, path: string): void;
  onReorderTab?(
    groupId: EditorGroupId,
    fromPath: string,
    toPath: string,
    position: TabDropPosition,
  ): void;
  onResizeSplit?(splitPath: readonly number[], sizes: readonly [number, number]): void;
  onSetActivePath(path: string): void;
  renderContent(surface: EditorGroupSurface, groupId: EditorGroupId): React.ReactNode;
  resolveEditorGroupDocumentSessionAuthority(
    groupId: string,
  ): EditorGroupDocumentSessionAuthority | null;
}

export const WorkbenchEditorHost = memo(function WorkbenchEditorHost({
  activeGroupId,
  attachEditorGroupLiveDocument,
  debugHover,
  contentRevisionForGroup,
  documents,
  documentSessionAuthorityRevision,
  editorSessionOwnerKey,
  fileStatusesByPath,
  isEditorGroupDocumentSessionAuthorityCurrent,
  javaScriptTypeScriptIncrementalSync,
  liveDocumentRuntime,
  projectId,
  state,
  onActivateGroup,
  onActivateTab,
  onActiveLiveDocumentBindingChange,
  onActiveLiveDocumentSaveBindingChange,
  onCloseDocument,
  onCloseTab,
  onGroupFocusRunnerChange,
  onMoveTab,
  onPinTab,
  onReorderTab,
  onResizeSplit,
  onSetActivePath,
  renderContent,
  resolveEditorGroupDocumentSessionAuthority,
}: WorkbenchEditorHostProps) {
  const activateTab = useCallback(
    (groupId: EditorGroupId, path: string) => {
      if (onActivateTab) {
        onActivateTab(groupId, path);
        return;
      }
      onSetActivePath(path);
    },
    [onActivateTab, onSetActivePath],
  );
  const closeTab = useCallback(
    async (groupId: EditorGroupId, path: string) => {
      if (onCloseTab) {
        await onCloseTab(groupId, path);
        return;
      }
      await onCloseDocument(path);
    },
    [onCloseDocument, onCloseTab],
  );
  const reorderTab = useCallback(
    (groupId: EditorGroupId, fromPath: string, toPath: string, position: TabDropPosition) => {
      onReorderTab?.(groupId, fromPath, toPath, position);
    },
    [onReorderTab],
  );
  const resizeSplit = useCallback(
    (splitPath: readonly number[], sizes: readonly [number, number]) => {
      onResizeSplit?.(splitPath, sizes);
    },
    [onResizeSplit],
  );

  return (
    <EditorRuntimeHost
      activeGroupId={activeGroupId}
      attachEditorGroupLiveDocument={attachEditorGroupLiveDocument}
      debugHover={debugHover}
      documentSessionAuthorityRevision={documentSessionAuthorityRevision}
      isEditorGroupDocumentSessionAuthorityCurrent={isEditorGroupDocumentSessionAuthorityCurrent}
      javaScriptTypeScriptIncrementalSync={javaScriptTypeScriptIncrementalSync}
      liveDocumentRuntime={liveDocumentRuntime}
      onActiveLiveDocumentBindingChange={onActiveLiveDocumentBindingChange}
      onActiveLiveDocumentSaveBindingChange={onActiveLiveDocumentSaveBindingChange}
      onGroupFocusRunnerChange={onGroupFocusRunnerChange}
      resolveEditorGroupDocumentSessionAuthority={resolveEditorGroupDocumentSessionAuthority}
    >
      <EditorArea
        contentRevisionForGroup={contentRevisionForGroup}
        documents={documents}
        editorSessionOwnerKey={editorSessionOwnerKey}
        fileStatusesByPath={fileStatusesByPath}
        onActivateGroup={onActivateGroup}
        onActivateTab={activateTab}
        onCloseTab={closeTab}
        onMoveTab={onMoveTab}
        onPinTab={onPinTab}
        onReorderTab={reorderTab}
        onResizeSplit={resizeSplit}
        projectId={projectId}
        renderContent={renderContent}
        state={state}
      />
    </EditorRuntimeHost>
  );
});
