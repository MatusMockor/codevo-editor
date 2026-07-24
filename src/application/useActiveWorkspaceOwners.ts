import { useCallback, useMemo, useRef } from "react";
import {
  createEditorSessionOwnerKey,
  createLegacyEditorSessionOwnerKey,
  type EditorSessionOwnerKey,
} from "../domain/editorSessionOwnerKey";
import {
  createLegacyWorkspaceRuntimeOwner,
  createWorkspaceRuntimeOwner,
} from "../domain/workspaceRuntimeOwner";

interface WorkspaceOwnerIdentity {
  readonly canonicalRoot: string;
  readonly workspaceId: string;
}

export function useActiveWorkspaceOwners(
  rootPath: string | null,
  identity: WorkspaceOwnerIdentity | null,
) {
  const editorSessionOwnerKey = useMemo(
    () =>
      rootPath
        ? identity
          ? createEditorSessionOwnerKey(identity.workspaceId, identity.canonicalRoot)
          : createLegacyEditorSessionOwnerKey(rootPath)
        : null,
    [identity, rootPath],
  );
  const currentEditorSessionOwnerKeyRef = useRef<EditorSessionOwnerKey | null>(
    editorSessionOwnerKey,
  );
  currentEditorSessionOwnerKeyRef.current = editorSessionOwnerKey;
  const workspaceRuntimeOwner = useMemo(
    () =>
      rootPath && identity ? createWorkspaceRuntimeOwner(identity.workspaceId, rootPath) : null,
    [identity, rootPath],
  );
  const workspaceRuntimeOwnerRef = useRef(workspaceRuntimeOwner);
  workspaceRuntimeOwnerRef.current =
    workspaceRuntimeOwner ?? (rootPath ? createLegacyWorkspaceRuntimeOwner(rootPath) : null);
  const resolveCurrentWorkspaceRuntimeOwner = useCallback(
    () => workspaceRuntimeOwnerRef.current,
    [],
  );
  return {
    currentEditorSessionOwnerKeyRef,
    editorSessionOwnerKey,
    resolveCurrentWorkspaceRuntimeOwner,
    workspaceRuntimeOwner,
    workspaceRuntimeOwnerRef,
  };
}
