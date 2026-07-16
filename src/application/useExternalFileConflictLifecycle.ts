import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  createExternalFileConflictState,
  externalFileSnapshotHasBaselineContent,
  externalFileConflictRef,
  transitionExternalFileConflict,
  type ExternalFileConflictAction,
  type ExternalFileConflictInput,
  type ExternalFileConflictState,
} from "../domain/externalFileConflict";
import type {
  EditorDocument,
  WorkspaceFileGateway,
  WorkspaceTextFileSnapshot,
} from "../domain/workspace";
import { isDirty, readWorkspaceTextFileSnapshot } from "../domain/workspace";
import type { WorkspaceFileChangeEvent } from "../domain/workspaceFileChange";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type {
  DocumentSaveIdentity,
  DocumentSaveOwnership,
  ResolveDocumentSaveOwnership,
} from "./documentSaveIdentity";
import { legacyDocumentSaveIdentity } from "./documentSaveIdentity";
import { DocumentSelfWriteCoordinator } from "./documentSelfWriteCoordinator";

type ConflictCache = Record<string, ExternalFileConflictState>;
type FileChangeHandlingResult = false | "resolved" | "unreadable";

interface ExternalFileConflictLifecycleDependencies {
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  activePath: string | null;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  openPathsRef: MutableRefObject<string[]>;
  resolveDocumentSaveOwnership?: ResolveDocumentSaveOwnership;
  documentSelfWrites: DocumentSelfWriteCoordinator;
  setActivePath: Dispatch<SetStateAction<string | null>>;
  setDocuments: Dispatch<SetStateAction<Record<string, EditorDocument>>>;
  setOpenPaths: Dispatch<SetStateAction<string[]>>;
  workspaceFiles: WorkspaceFileGateway;
  workspaceRoot: string | null;
}

export function useExternalFileConflictLifecycle({
  activeDocumentRef,
  activePath,
  currentWorkspaceRootRef,
  documentsRef,
  openPathsRef,
  resolveDocumentSaveOwnership,
  documentSelfWrites,
  setActivePath,
  setDocuments,
  setOpenPaths,
  workspaceFiles,
  workspaceRoot,
}: ExternalFileConflictLifecycleDependencies) {
  const cacheRef = useRef<ConflictCache>({});
  const ownershipRef = useRef<Record<string, DocumentSaveIdentity>>({});
  const eventSequenceRef = useRef<Record<string, number>>({});
  const retryEventRef = useRef<Record<string, WorkspaceFileChangeEvent>>({});
  const pendingReadBaseStateRef = useRef<Record<string, ExternalFileConflictState>>({});
  const selfWriteWaitsRef = useRef<Record<string, AbortController>>({});
  const selfWriteWaitOwnershipRef = useRef<Record<string, DocumentSaveIdentity>>({});
  const disposedRef = useRef(false);
  const [, forceRender] = useReducer((value: number) => value + 1, 0);

  const resolveOwnership = useCallback(
    (root: string, path: string): DocumentSaveIdentity | null => {
      const ownership: DocumentSaveOwnership | null =
        resolveDocumentSaveOwnership
          ? resolveDocumentSaveOwnership(root, path)
          : legacyDocumentSaveIdentity(root, path);
      if (!ownership) {
        return null;
      }
      if ("rootPath" in ownership) {
        return legacyDocumentSaveIdentity(ownership.rootPath, ownership.path);
      }
      return ownership;
    },
    [resolveDocumentSaveOwnership],
  );

  const ownershipKey = useCallback(
    (ownership: DocumentSaveIdentity) =>
      JSON.stringify([
        ownership.canonicalRoot,
        ownership.workspaceRelativePath,
      ]),
    [],
  );

  const stateForOwnership = useCallback(
    (ownership: DocumentSaveIdentity) =>
      cacheRef.current[ownershipKey(ownership)] ??
      createExternalFileConflictState(),
    [ownershipKey],
  );

  const stateFor = useCallback(
    (root: string, path: string) => {
      const ownership = resolveOwnership(root, path);
      if (!ownership) {
        return createExternalFileConflictState();
      }
      return stateForOwnership(ownership);
    },
    [resolveOwnership, stateForOwnership],
  );

  const publish = useCallback(
    (ownership: DocumentSaveIdentity, state: ExternalFileConflictState) => {
      const key = ownershipKey(ownership);
      ownershipRef.current[key] = ownership;
      cacheRef.current[key] = state;
      forceRender();
    },
    [ownershipKey],
  );

  const cancelSelfWriteWait = useCallback((key: string) => {
    selfWriteWaitsRef.current[key]?.abort();
    delete selfWriteWaitsRef.current[key];
    delete selfWriteWaitOwnershipRef.current[key];
  }, []);

  const reconcileDocumentBaselineRevision = useCallback(
    (
      key: string,
      disk: WorkspaceTextFileSnapshot,
    ): boolean => {
      const currentRoot = currentWorkspaceRootRef.current;
      if (!currentRoot) {
        return false;
      }

      const selectedEntry = Object.entries(documentsRef.current).find(
        ([, candidate]) => {
          const candidateOwnership = resolveOwnership(currentRoot, candidate.path);
          return Boolean(
            candidateOwnership && ownershipKey(candidateOwnership) === key,
          );
        },
      );
      if (!selectedEntry) {
        return false;
      }

      const [selectedPath, document] = selectedEntry;
      if (document.savedContent !== disk.content) {
        return false;
      }

      const reconciled = { ...document, revision: disk.revision };
      documentsRef.current = {
        ...documentsRef.current,
        [selectedPath]: reconciled,
      };
      if (activeDocumentRef.current?.path === selectedPath) {
        activeDocumentRef.current = {
          ...activeDocumentRef.current,
          revision: disk.revision,
        };
      }
      setDocuments((current) => {
        const live = current[selectedPath];
        if (!live || live.savedContent !== disk.content) {
          return current;
        }

        return {
          ...current,
          [selectedPath]: { ...live, revision: disk.revision },
        };
      });
      return true;
    },
    [
      activeDocumentRef,
      currentWorkspaceRootRef,
      documentsRef,
      ownershipKey,
      resolveOwnership,
      setDocuments,
    ],
  );

  const clearOwnershipConflictState = useCallback(
    (key: string) => {
      delete pendingReadBaseStateRef.current[key];
      delete retryEventRef.current[key];
      delete cacheRef.current[key];
      delete ownershipRef.current[key];
      forceRender();
    },
    [],
  );

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      for (const wait of Object.values(selfWriteWaitsRef.current)) {
        wait.abort();
      }
      selfWriteWaitsRef.current = {};
      selfWriteWaitOwnershipRef.current = {};
    };
  }, []);

  const handleFileChange = useCallback(
    async (event: WorkspaceFileChangeEvent): Promise<FileChangeHandlingResult> => {
      const root = currentWorkspaceRootRef.current;
      if (!root) {
        return false;
      }

      const path = event.kind === "renamed" ? event.previousPath : event.path;
      if (!path || event.fileKind === "directory") {
        return false;
      }

      const eventOwnership = resolveOwnership(event.rootPath, path);
      if (!eventOwnership) {
        return false;
      }

      const key = ownershipKey(eventOwnership);
      const document =
        documentsRef.current[path] ??
        Object.values(documentsRef.current).find((candidate) => {
          const candidateOwnership = resolveOwnership(root, candidate.path);
          return candidateOwnership
            ? ownershipKey(candidateOwnership) === key
            : false;
        });
      if (!document || !isDirty(document)) {
        return false;
      }

      const currentOwnership = resolveOwnership(root, document.path);
      if (!currentOwnership || ownershipKey(currentOwnership) !== key) {
        return false;
      }

      if (
        event.kind !== "modified" &&
        event.kind !== "deleted" &&
        event.kind !== "renamed"
      ) {
        return false;
      }

      const sequence = (eventSequenceRef.current[key] ?? 0) + 1;
      eventSequenceRef.current[key] = sequence;
      cancelSelfWriteWait(key);
      const selfWriteWait = new AbortController();
      selfWriteWaitsRef.current[key] = selfWriteWait;
      selfWriteWaitOwnershipRef.current[key] = eventOwnership;
      const selfWriteSettlement = event.kind === "modified"
        ? documentSelfWrites.expectationsForEvent(eventOwnership, {
            signal: selfWriteWait.signal,
          })
        : null;
      const selfWriteExpectations = selfWriteSettlement
        ? await selfWriteSettlement
        : [];
      if (selfWriteWaitsRef.current[key] === selfWriteWait) {
        delete selfWriteWaitsRef.current[key];
        delete selfWriteWaitOwnershipRef.current[key];
      }
      if (disposedRef.current || eventSequenceRef.current[key] !== sequence) {
        return false;
      }

      const documentAfterSelfWrite = Object.values(
        documentsRef.current,
      ).find((candidate) => {
        const candidateOwnership = resolveOwnership(
          currentWorkspaceRootRef.current ?? "",
          candidate.path,
        );
        return candidateOwnership
          ? ownershipKey(candidateOwnership) === key
          : false;
      });
      if (!documentAfterSelfWrite || !isDirty(documentAfterSelfWrite)) {
        return false;
      }

      ownershipRef.current[key] = eventOwnership;
      const baseline = {
        content: documentAfterSelfWrite.savedContent,
        path: documentAfterSelfWrite.path,
        revision: documentAfterSelfWrite.revision,
      };
      const stateBeforeRead =
        pendingReadBaseStateRef.current[key] ??
        stateForOwnership(eventOwnership);
      pendingReadBaseStateRef.current[key] = stateBeforeRead;
      let pendingReadState: ExternalFileConflictState | null = null;
      if (event.kind !== "deleted") {
        retryEventRef.current[key] = event;
        pendingReadState = transitionExternalFileConflict(stateBeforeRead, {
          type: "detected",
          conflict: {
            kind: "unreadable",
            attemptedKind: event.kind,
            attemptedPath: event.path,
            baseline,
            disk: null,
          },
        });
        publish(
          eventOwnership,
          pendingReadState,
        );
      }
      let disk: {
        content: string;
        path: string;
        revision: import("../domain/workspace").WorkspaceFileRevision | null;
      } | null = null;

      if (event.kind !== "deleted") {
        try {
          const snapshot = await readWorkspaceTextFileSnapshot(
            workspaceFiles,
            event.path,
          );
          disk = {
            content: snapshot.content,
            path: event.path,
            revision: snapshot.revision,
          };
        } catch {
          if (eventSequenceRef.current[key] === sequence) {
            delete pendingReadBaseStateRef.current[key];
          }
          return "unreadable";
        }
      }

      const liveDocument = Object.values(documentsRef.current).find((candidate) => {
        const candidateOwnership = resolveOwnership(
          currentWorkspaceRootRef.current ?? "",
          candidate.path,
        );
        return candidateOwnership
          ? ownershipKey(candidateOwnership) === key
          : false;
      });
      if (
        disposedRef.current ||
        eventSequenceRef.current[key] !== sequence ||
        !liveDocument ||
        !isDirty(liveDocument)
      ) {
        return false;
      }

      if (
        event.kind === "modified" &&
        disk &&
        selfWriteExpectations.some((expectation) =>
          documentSelfWrites.consumeMatchingSnapshot(
            eventOwnership,
            expectation,
            disk,
          )
        )
      ) {
        delete pendingReadBaseStateRef.current[key];
        delete retryEventRef.current[key];
        if (
          pendingReadState &&
          stateForOwnership(eventOwnership) === pendingReadState
        ) {
          publish(eventOwnership, stateBeforeRead);
        }
        return false;
      }

      if (
        event.kind === "modified" &&
        disk &&
        externalFileSnapshotHasBaselineContent(
          {
            content: liveDocument.savedContent,
            path: liveDocument.path,
            revision: liveDocument.revision,
          },
          disk,
        ) &&
        reconcileDocumentBaselineRevision(key, disk)
      ) {
        clearOwnershipConflictState(key);
        if (
          stateBeforeRead.status === "resolving" &&
          stateBeforeRead.action === "retryRead"
        ) {
          return "resolved";
        }
        return false;
      }

      const conflict: ExternalFileConflictInput =
        event.kind === "deleted"
          ? { kind: "deleted", baseline, disk: null }
          : event.kind === "renamed"
            ? { kind: "renamed", baseline, disk: disk! }
            : { kind: "modified", baseline, disk: disk! };

      delete pendingReadBaseStateRef.current[key];
      delete retryEventRef.current[key];

      publish(
        eventOwnership,
        transitionExternalFileConflict(stateForOwnership(eventOwnership), {
          type: "detected",
          conflict,
        }),
      );
      return "resolved";
    },
    [
      currentWorkspaceRootRef,
      cancelSelfWriteWait,
      clearOwnershipConflictState,
      documentsRef,
      ownershipKey,
      publish,
      reconcileDocumentBaselineRevision,
      resolveOwnership,
      stateForOwnership,
      workspaceFiles,
      documentSelfWrites,
    ],
  );

  const hasConflict = useCallback(
    (root: string | null, path: string) =>
      Boolean(root && stateFor(root, path).conflict),
    [stateFor],
  );

  const detectSaveConflict = useCallback(
    (
      root: string,
      document: EditorDocument,
      disk: WorkspaceTextFileSnapshot | null,
    ) => {
      const ownership = resolveOwnership(root, document.path);
      if (!ownership) {
        return;
      }
      const sequenceKey = ownershipKey(ownership);
      cancelSelfWriteWait(sequenceKey);
      delete pendingReadBaseStateRef.current[sequenceKey];
      ownershipRef.current[sequenceKey] = ownership;
      if (
        disk &&
        externalFileSnapshotHasBaselineContent(
          {
            content: document.savedContent,
            path: document.path,
            revision: document.revision,
          },
          {
            content: disk.content,
            path: document.path,
            revision: disk.revision,
          },
        ) &&
        reconcileDocumentBaselineRevision(sequenceKey, disk)
      ) {
        clearOwnershipConflictState(sequenceKey);
        return;
      }
      if (!disk) {
        retryEventRef.current[sequenceKey] = {
          rootPath: root,
          kind: "modified",
          path: document.path,
          relativePath: document.path,
        };
      }
      publish(
        ownership,
        transitionExternalFileConflict(stateForOwnership(ownership), {
          type: "detected",
          conflict: disk ? {
            kind: "modified",
            baseline: {
              content: document.savedContent,
              path: document.path,
              revision: document.revision,
            },
            disk: {
              content: disk.content,
              path: document.path,
              revision: disk.revision,
            },
          } : {
            kind: "unreadable",
            attemptedKind: "modified",
            attemptedPath: document.path,
            baseline: {
              content: document.savedContent,
              path: document.path,
              revision: document.revision,
            },
            disk: null,
          },
        }),
      );
    },
    [
      cancelSelfWriteWait,
      clearOwnershipConflictState,
      ownershipKey,
      publish,
      reconcileDocumentBaselineRevision,
      resolveOwnership,
      stateForOwnership,
    ],
  );

  const clearConflict = useCallback(
    (root: string | null, path: string) => {
      if (!root) {
        return;
      }

      const ownership = resolveOwnership(root, path);
      if (!ownership) {
        return;
      }
      const sequenceKey = ownershipKey(ownership);
      cancelSelfWriteWait(sequenceKey);
      delete pendingReadBaseStateRef.current[sequenceKey];
      eventSequenceRef.current[sequenceKey] =
        (eventSequenceRef.current[sequenceKey] ?? 0) + 1;
      delete retryEventRef.current[sequenceKey];
      if (!cacheRef.current[sequenceKey]) {
        return;
      }

      delete cacheRef.current[sequenceKey];
      delete ownershipRef.current[sequenceKey];
      forceRender();
    },
    [cancelSelfWriteWait, ownershipKey, resolveOwnership],
  );

  const ownershipBelongsToRoot = useCallback(
    (root: string, ownership: DocumentSaveIdentity) => {
      const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
      const path = `${root.replace(/[\\/]+$/, "")}${separator}${ownership.workspaceRelativePath.replace(/[\\/]+/g, separator)}`;
      const resolved = resolveOwnership(root, path);
      return Boolean(
        resolved &&
          workspaceRootKeysEqual(resolved.canonicalRoot, ownership.canonicalRoot),
      );
    },
    [resolveOwnership],
  );

  const clearRoot = useCallback((root: string) => {
    for (const [key, ownership] of Object.entries(
      selfWriteWaitOwnershipRef.current,
    )) {
      if (!ownershipBelongsToRoot(root, ownership)) {
        continue;
      }
      eventSequenceRef.current[key] =
        (eventSequenceRef.current[key] ?? 0) + 1;
      cancelSelfWriteWait(key);
    }
    for (const [key, ownership] of Object.entries(ownershipRef.current)) {
      if (!ownershipBelongsToRoot(root, ownership)) {
        continue;
      }
      documentSelfWrites.clearRoot(ownership.canonicalRoot);
      eventSequenceRef.current[key] =
        (eventSequenceRef.current[key] ?? 0) + 1;
      cancelSelfWriteWait(key);
      delete pendingReadBaseStateRef.current[key];
      delete retryEventRef.current[key];
      delete cacheRef.current[key];
      delete ownershipRef.current[key];
    }
    documentSelfWrites.clearRoot(root);
    forceRender();
  }, [cancelSelfWriteWait, documentSelfWrites, ownershipBelongsToRoot]);

  const hasConflictsForRoot = useCallback(
    (root: string) =>
      Object.entries(cacheRef.current).some(([key, state]) => {
        const ownership = ownershipRef.current[key];
        return Boolean(
          ownership &&
            ownershipBelongsToRoot(root, ownership) &&
            state.conflict !== null,
        );
      }),
    [ownershipBelongsToRoot],
  );

  const action = useCallback(
    async (requested: ExternalFileConflictAction) => {
      if (!workspaceRoot || !activePath) {
        return;
      }

      const actionOwnership = resolveOwnership(workspaceRoot, activePath);
      if (!actionOwnership) {
        return;
      }

      const actionKey = ownershipKey(actionOwnership);
      const state = stateForOwnership(actionOwnership);
      const conflict = state.conflict;
      if (!conflict) {
        return;
      }

      const target = externalFileConflictRef(conflict);
      if (requested === "compare") {
        publish(
          actionOwnership,
          transitionExternalFileConflict(state, { type: "compareOpened", target }),
        );
        return;
      }

      const resolving = transitionExternalFileConflict(state, {
        type: "actionStarted",
        target,
        action: requested,
      });
      publish(actionOwnership, resolving);

      const failAction = (message: string) => {
        publish(
          actionOwnership,
          transitionExternalFileConflict(stateForOwnership(actionOwnership), {
            type: "actionFailed",
            target,
            message,
          }),
        );
      };

      const resolveStaleAction = () => {
        publish(
          actionOwnership,
          transitionExternalFileConflict(stateForOwnership(actionOwnership), {
            type: "resolved",
            target,
          }),
        );
      };

      const actionStillOwnsActiveDocument = () => {
        const currentRoot = currentWorkspaceRootRef.current;
        const currentDocument = activeDocumentRef.current;
        if (!currentRoot || !currentDocument) {
          return false;
        }
        const currentOwnership = resolveOwnership(
          currentRoot,
          currentDocument.path,
        );
        return Boolean(
          currentOwnership && ownershipKey(currentOwnership) === actionKey,
        );
      };

      const finishWrite = (
        writtenContent: string,
        revision: import("../domain/workspace").WorkspaceFileRevision | null,
      ) => {
        if (!actionStillOwnsActiveDocument()) {
          resolveStaleAction();
          return;
        }
        const capturedDocument = documentsRef.current[activePath];
        const selectedEntry: [string, EditorDocument] | undefined =
          capturedDocument
            ? [activePath, capturedDocument]
            : Object.entries(documentsRef.current).find(([, candidate]) => {
                const currentRoot = currentWorkspaceRootRef.current;
                if (!currentRoot) {
                  return false;
                }
                const ownership = resolveOwnership(
                  currentRoot,
                  candidate.path,
                );
                return Boolean(
                  ownership && ownershipKey(ownership) === actionKey,
                );
              });
        if (!selectedEntry) {
          return;
        }
        const [selectedPath, current] = selectedEntry;
        const saved = {
          ...current,
          savedContent: writtenContent,
          revision,
        };
        documentsRef.current = {
          ...documentsRef.current,
          [selectedPath]: saved,
        };
        if (activeDocumentRef.current?.path === selectedPath) {
          activeDocumentRef.current = saved;
        }
        setDocuments(documentsRef.current);
        publish(
          actionOwnership,
          transitionExternalFileConflict(stateForOwnership(actionOwnership), {
            type: "resolved",
            target,
          }),
        );
      };

      if (requested === "overwrite") {
        const live = documentsRef.current[activePath];
        const expectedRevision = conflict.disk?.revision;
        if (conflict.kind !== "modified" || !live || !expectedRevision) {
          failAction("Overwrite is available only for a modified file with a trusted disk revision.");
          return;
        }
        try {
          const result = await workspaceFiles.writeTextFile(
            activePath,
            live.content,
            expectedRevision,
          );
          if (!actionStillOwnsActiveDocument()) {
            resolveStaleAction();
            return;
          }
          if (!result || result.status === "error" || result.status === "conflict") {
            failAction(result?.message ?? "The overwrite did not return a trusted result.");
            return;
          }
          if (result.status === "partial") {
            failAction(result.message);
            return;
          }
          finishWrite(live.content, result.revision);
        } catch (error) {
          if (!actionStillOwnsActiveDocument()) {
            resolveStaleAction();
            return;
          }
          failAction(error instanceof Error ? error.message : String(error));
        }
        return;
      }

      if (requested === "recreate") {
        const live = documentsRef.current[activePath];
        if (conflict.kind !== "deleted" || !live) {
          failAction("Recreate is available only for a deleted file.");
          return;
        }
        try {
          await workspaceFiles.createTextFile(activePath);
          if (!actionStillOwnsActiveDocument()) {
            resolveStaleAction();
            return;
          }
          const created = await readWorkspaceTextFileSnapshot(workspaceFiles, activePath);
          if (!actionStillOwnsActiveDocument()) {
            resolveStaleAction();
            return;
          }
          if (!created.revision) {
            failAction("The recreated file has no trusted revision.");
            return;
          }
          const result = await workspaceFiles.writeTextFile(
            activePath,
            live.content,
            created.revision,
          );
          if (!actionStillOwnsActiveDocument()) {
            resolveStaleAction();
            return;
          }
          if (!result || result.status === "error" || result.status === "conflict") {
            failAction(result?.message ?? "The recreated file could not be saved safely.");
            return;
          }
          if (result.status === "partial") {
            failAction(result.message);
            return;
          }
          finishWrite(live.content, result.revision);
        } catch (error) {
          if (!actionStillOwnsActiveDocument()) {
            resolveStaleAction();
            return;
          }
          failAction(error instanceof Error ? error.message : String(error));
        }
        return;
      }

      if (requested === "retryRead") {
        const retryEvent = retryEventRef.current[actionKey];
        if (!retryEvent) {
          publish(
            actionOwnership,
            transitionExternalFileConflict(resolving, {
              type: "actionFailed",
              target,
              message: "The external file event is no longer available to retry.",
            }),
          );
          return;
        }

        const result = await handleFileChange(retryEvent);
        if (result !== "resolved") {
          const currentConflict = stateForOwnership(actionOwnership).conflict;
          publish(
            actionOwnership,
            transitionExternalFileConflict(stateForOwnership(actionOwnership), {
              type: "actionFailed",
              target: externalFileConflictRef(currentConflict ?? conflict),
              message:
                result === "unreadable"
                  ? "The external file is still unreadable."
                  : "The retry was cancelled because the workspace changed.",
            }),
          );
          return;
        }
        publish(
          actionOwnership,
          transitionExternalFileConflict(stateForOwnership(actionOwnership), {
            type: "resolved",
            target,
          }),
        );
        return;
      }

      const live = documentsRef.current[activePath];
      if (!live || !conflict.disk) {
        return;
      }

      if (requested === "reload") {
        const refreshed = {
          ...live,
          content: conflict.disk.content,
          savedContent: conflict.disk.content,
          revision: conflict.disk.revision ?? null,
        };
        documentsRef.current = { ...documentsRef.current, [activePath]: refreshed };
        activeDocumentRef.current = refreshed;
        setDocuments(documentsRef.current);
      }

      if (requested === "followRename") {
        const nextPath = conflict.disk.path;
        const targetDocument = documentsRef.current[nextPath];
        if (
          targetDocument &&
          (isDirty(targetDocument) || hasConflict(workspaceRoot, nextPath))
        ) {
          publish(
            actionOwnership,
            transitionExternalFileConflict(resolving, {
              type: "actionFailed",
              target,
              message: "The rename target has unsaved changes or a conflict.",
            }),
          );
          return;
        }

        const followed = {
          ...live,
          name: nextPath.split(/[\\/]/).pop() ?? live.name,
          path: nextPath,
          savedContent: conflict.disk.content,
          revision: conflict.disk.revision ?? null,
        };
        const nextDocuments = { ...documentsRef.current };
        delete nextDocuments[activePath];
        delete nextDocuments[nextPath];
        nextDocuments[nextPath] = followed;
        documentsRef.current = nextDocuments;
        openPathsRef.current = Array.from(
          new Set(
            openPathsRef.current.map((path) =>
              path === activePath ? nextPath : path,
            ),
          ),
        );
        activeDocumentRef.current = followed;
        setDocuments(nextDocuments);
        setOpenPaths(openPathsRef.current);
        setActivePath(nextPath);
      }

      publish(
        actionOwnership,
        transitionExternalFileConflict(resolving, { type: "resolved", target }),
      );
    },
    [
      activeDocumentRef,
      activePath,
      documentsRef,
      hasConflict,
      handleFileChange,
      openPathsRef,
      ownershipKey,
      publish,
      resolveOwnership,
      setActivePath,
      setDocuments,
      setOpenPaths,
      stateForOwnership,
      workspaceFiles,
      workspaceRoot,
    ],
  );

  const closeCompare = useCallback(() => {
    if (!workspaceRoot || !activePath) {
      return;
    }
    const ownership = resolveOwnership(workspaceRoot, activePath);
    if (!ownership) {
      return;
    }
    const state = stateForOwnership(ownership);
    if (!state.conflict) {
      return;
    }
    publish(
      ownership,
      transitionExternalFileConflict(state, {
        type: "compareClosed",
        target: externalFileConflictRef(state.conflict),
      }),
    );
  }, [activePath, publish, resolveOwnership, stateForOwnership, workspaceRoot]);

  const activeState =
    workspaceRoot && activePath
      ? stateFor(workspaceRoot, activePath)
      : createExternalFileConflictState();
  const conflictCount = workspaceRoot
    ? Object.entries(cacheRef.current).filter(([key, state]) => {
        const ownership = ownershipRef.current[key];
        return Boolean(
          ownership &&
            ownershipBelongsToRoot(workspaceRoot, ownership) &&
            state.conflict,
        );
      }).length
    : 0;

  return {
    action,
    activeState,
    closeCompare,
    clearConflict,
    clearRoot,
    conflictCount,
    detectSaveConflict,
    handleFileChange,
    hasConflict,
    hasConflictsForRoot,
  };
}
