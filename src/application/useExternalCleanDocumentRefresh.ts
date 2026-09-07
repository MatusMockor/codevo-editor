import { editorDocumentExternalChangeProtection } from "./editorDocumentExternalChangeProtection";
import { useCallback, useLayoutEffect, useRef } from "react";
import type { WorkbenchFileOperationsDependencies } from "./useWorkbenchFileOperations";
import { documentSaveOwnershipKey } from "./documentSaveIdentity";
import { canRefreshDocumentFromExternalFileChange } from "../domain/workspaceFileChange";
import { readWorkspaceTextFileSnapshot } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

type Dependencies = Pick<
  WorkbenchFileOperationsDependencies,
  | "workspaceRoot"
  | "currentWorkspaceRootRef"
  | "documentsRef"
  | "activeDocumentRef"
  | "setDocuments"
  | "workspaceFiles"
  | "reportChangedDocuments"
  | "resolveDocumentSaveOwnership"
  | "resolveDocumentSessionDirtyProjection"
  | "refreshExternalCleanDocument"
  | "reportErrorForActiveWorkspaceRoot"
>;

export function useExternalCleanDocumentRefresh({
  workspaceRoot,
  currentWorkspaceRootRef,
  documentsRef,
  activeDocumentRef,
  setDocuments,
  workspaceFiles,
  reportChangedDocuments,
  resolveDocumentSaveOwnership,
  resolveDocumentSessionDirtyProjection,
  refreshExternalCleanDocument,
  reportErrorForActiveWorkspaceRoot,
}: Dependencies) {
  const epoch = useRef(0);
  const reads = useRef(new Map<string, object>());
  useLayoutEffect(() => {
    const ownedReads = reads.current;
    epoch.current += 1;
    ownedReads.clear();
    return () => {
      epoch.current += 1;
      ownedReads.clear();
    };
  }, [workspaceRoot, resolveDocumentSaveOwnership, workspaceFiles]);

  return useCallback(
    async (requestedRoot: string, path: string): Promise<void> => {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) return;
      const document = documentsRef.current[path];
      if (!document || !canRefreshDocumentFromExternalFileChange(document)) return;
      const resolveKey = () => {
        if (!resolveDocumentSaveOwnership) return requestedRoot;
        try {
          const ownership = resolveDocumentSaveOwnership(requestedRoot, path);
          return ownership ? documentSaveOwnershipKey(ownership) : null;
        } catch {
          return null;
        }
      };
      const projection = resolveDocumentSessionDirtyProjection?.(path) ?? null;
      const owner = resolveKey();
      if (!owner) return;
      const initialProtection = editorDocumentExternalChangeProtection(projection);
      if (initialProtection !== null) {
        reportErrorForActiveWorkspaceRoot(
          requestedRoot,
          "File refresh",
          new Error(initialProtection),
        );
        return;
      }
      const generation = epoch.current;
      const token = {};
      reads.current.set(path, token);
      const isOwnerCurrent = () =>
        generation === epoch.current &&
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot) &&
        resolveKey() === owner;
      const isCurrent = () =>
        isOwnerCurrent() &&
        reads.current.get(path) === token &&
        documentsRef.current[path] === document &&
        canRefreshDocumentFromExternalFileChange(document);
      try {
        const snapshot = await readWorkspaceTextFileSnapshot(workspaceFiles, path);
        if (!isCurrent()) return;
        const currentProjection = resolveDocumentSessionDirtyProjection?.(path) ?? null;
        const protection = editorDocumentExternalChangeProtection(currentProjection);
        if (currentProjection !== projection || protection !== null) {
          reportErrorForActiveWorkspaceRoot(
            requestedRoot,
            "File refresh",
            new Error(protection ?? "The editor owner changed before the file could be refreshed."),
          );
          return;
        }
        const refreshed = {
          ...document,
          content: snapshot.content,
          savedContent: snapshot.content,
          revision: snapshot.revision,
        };
        if (refreshExternalCleanDocument !== undefined) {
          if (!refreshExternalCleanDocument(document, refreshed)) {
            reportErrorForActiveWorkspaceRoot(
              requestedRoot,
              "File refresh",
              new Error(
                "The editor changed before the file could be refreshed. Its open buffer was kept.",
              ),
            );
            return;
          }
          reportChangedDocuments([path]);
          return;
        }
        documentsRef.current = { ...documentsRef.current, [path]: refreshed };
        if (activeDocumentRef.current === document) activeDocumentRef.current = refreshed;
        setDocuments((current) =>
          isOwnerCurrent() && current[path] === document
            ? { ...current, [path]: refreshed }
            : current,
        );
        reportChangedDocuments([path]);
      } catch (error) {
        if (isCurrent()) reportErrorForActiveWorkspaceRoot(requestedRoot, "File refresh", error);
      } finally {
        if (reads.current.get(path) === token) reads.current.delete(path);
      }
    },
    [
      activeDocumentRef,
      currentWorkspaceRootRef,
      documentsRef,
      reportChangedDocuments,
      reportErrorForActiveWorkspaceRoot,
      resolveDocumentSaveOwnership,
      resolveDocumentSessionDirtyProjection,
      refreshExternalCleanDocument,
      setDocuments,
      workspaceFiles,
    ],
  );
}
