import {
  useCallback,
  useReducer,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  createExternalFileConflictState,
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

type ConflictCache = Record<string, Record<string, ExternalFileConflictState>>;
type FileChangeHandlingResult = false | "resolved" | "unreadable";

interface ExternalFileConflictLifecycleDependencies {
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  activePath: string | null;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  openPathsRef: MutableRefObject<string[]>;
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
  setActivePath,
  setDocuments,
  setOpenPaths,
  workspaceFiles,
  workspaceRoot,
}: ExternalFileConflictLifecycleDependencies) {
  const cacheRef = useRef<ConflictCache>({});
  const eventSequenceRef = useRef<Record<string, number>>({});
  const retryEventRef = useRef<Record<string, WorkspaceFileChangeEvent>>({});
  const [, forceRender] = useReducer((value: number) => value + 1, 0);

  const stateFor = useCallback((root: string, path: string) => {
    return cacheRef.current[root]?.[path] ?? createExternalFileConflictState();
  }, []);

  const publish = useCallback(
    (root: string, path: string, state: ExternalFileConflictState) => {
      cacheRef.current[root] = { ...cacheRef.current[root], [path]: state };
      forceRender();
    },
    [],
  );

  const handleFileChange = useCallback(
    async (event: WorkspaceFileChangeEvent): Promise<FileChangeHandlingResult> => {
      const root = currentWorkspaceRootRef.current;
      if (!root || !workspaceRootKeysEqual(root, event.rootPath)) {
        return false;
      }

      const path = event.kind === "renamed" ? event.previousPath : event.path;
      if (!path || event.fileKind === "directory") {
        return false;
      }

      const document = documentsRef.current[path];
      if (!document || !isDirty(document)) {
        return false;
      }

      if (
        event.kind !== "modified" &&
        event.kind !== "deleted" &&
        event.kind !== "renamed"
      ) {
        return false;
      }

      const sequenceKey = `${root}\0${path}`;
      const sequence = (eventSequenceRef.current[sequenceKey] ?? 0) + 1;
      eventSequenceRef.current[sequenceKey] = sequence;
      const baseline = { content: document.savedContent, path };
      if (event.kind !== "deleted") {
        retryEventRef.current[sequenceKey] = event;
        publish(
          root,
          path,
          transitionExternalFileConflict(stateFor(root, path), {
            type: "detected",
            conflict: {
              kind: "unreadable",
              attemptedKind: event.kind,
              attemptedPath: event.path,
              baseline,
              disk: null,
            },
          }),
        );
      }
      let disk: {
        content: string;
        path: string;
        revision?: import("../domain/workspace").WorkspaceFileRevision | null;
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
          return "unreadable";
        }
      }

      const liveDocument = documentsRef.current[path];
      if (
        eventSequenceRef.current[sequenceKey] !== sequence ||
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, root) ||
        !liveDocument ||
        !isDirty(liveDocument)
      ) {
        return false;
      }

      const conflict: ExternalFileConflictInput =
        event.kind === "deleted"
          ? { kind: "deleted", baseline, disk: null }
          : event.kind === "renamed"
            ? { kind: "renamed", baseline, disk: disk! }
            : { kind: "modified", baseline, disk: disk! };

      delete retryEventRef.current[sequenceKey];

      publish(
        root,
        path,
        transitionExternalFileConflict(stateFor(root, path), {
          type: "detected",
          conflict,
        }),
      );
      return "resolved";
    },
    [currentWorkspaceRootRef, documentsRef, publish, stateFor, workspaceFiles],
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
      const sequenceKey = `${root}\0${document.path}`;
      if (!disk) {
        retryEventRef.current[sequenceKey] = {
          rootPath: root,
          kind: "modified",
          path: document.path,
          relativePath: document.path,
        };
      }
      publish(
        root,
        document.path,
        transitionExternalFileConflict(stateFor(root, document.path), {
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
    [publish, stateFor],
  );

  const clearConflict = useCallback(
    (root: string | null, path: string) => {
      if (!root) {
        return;
      }

      const sequenceKey = `${root}\0${path}`;
      eventSequenceRef.current[sequenceKey] =
        (eventSequenceRef.current[sequenceKey] ?? 0) + 1;
      delete retryEventRef.current[sequenceKey];
      const rootCache = cacheRef.current[root];
      if (!rootCache?.[path]) {
        return;
      }

      const nextRootCache = { ...rootCache };
      delete nextRootCache[path];
      cacheRef.current[root] = nextRootCache;
      forceRender();
    },
    [],
  );

  const clearRoot = useCallback((root: string) => {
    const prefix = `${root}\0`;
    for (const key of Object.keys(eventSequenceRef.current)) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      eventSequenceRef.current[key] += 1;
      delete retryEventRef.current[key];
    }
    delete cacheRef.current[root];
    forceRender();
  }, []);

  const hasConflictsForRoot = useCallback(
    (root: string) =>
      Object.values(cacheRef.current[root] ?? {}).some(
        (state) => state.conflict !== null,
      ),
    [],
  );

  const action = useCallback(
    async (requested: ExternalFileConflictAction) => {
      if (!workspaceRoot || !activePath) {
        return;
      }

      const state = stateFor(workspaceRoot, activePath);
      const conflict = state.conflict;
      if (!conflict) {
        return;
      }

      const target = externalFileConflictRef(conflict);
      if (requested === "compare") {
        publish(
          workspaceRoot,
          activePath,
          transitionExternalFileConflict(state, { type: "compareOpened", target }),
        );
        return;
      }

      const resolving = transitionExternalFileConflict(state, {
        type: "actionStarted",
        target,
        action: requested,
      });
      publish(workspaceRoot, activePath, resolving);

      const failAction = (message: string) => {
        publish(
          workspaceRoot,
          activePath,
          transitionExternalFileConflict(stateFor(workspaceRoot, activePath), {
            type: "actionFailed",
            target,
            message,
          }),
        );
      };

      const finishWrite = (
        writtenContent: string,
        revision: import("../domain/workspace").WorkspaceFileRevision | null,
      ) => {
        const current = documentsRef.current[activePath];
        if (!current) {
          return;
        }
        const saved = {
          ...current,
          savedContent: writtenContent,
          revision,
        };
        documentsRef.current = { ...documentsRef.current, [activePath]: saved };
        if (activeDocumentRef.current?.path === activePath) {
          activeDocumentRef.current = saved;
        }
        setDocuments(documentsRef.current);
        publish(
          workspaceRoot,
          activePath,
          transitionExternalFileConflict(stateFor(workspaceRoot, activePath), {
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
          const created = await readWorkspaceTextFileSnapshot(workspaceFiles, activePath);
          if (!created.revision) {
            failAction("The recreated file has no trusted revision.");
            return;
          }
          const result = await workspaceFiles.writeTextFile(
            activePath,
            live.content,
            created.revision,
          );
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
          failAction(error instanceof Error ? error.message : String(error));
        }
        return;
      }

      if (requested === "retryRead") {
        const retryEvent = retryEventRef.current[`${workspaceRoot}\0${activePath}`];
        if (!retryEvent) {
          publish(
            workspaceRoot,
            activePath,
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
          const currentConflict = stateFor(workspaceRoot, activePath).conflict;
          publish(
            workspaceRoot,
            activePath,
            transitionExternalFileConflict(stateFor(workspaceRoot, activePath), {
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
          workspaceRoot,
          activePath,
          transitionExternalFileConflict(stateFor(workspaceRoot, activePath), {
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
            workspaceRoot,
            activePath,
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
        workspaceRoot,
        activePath,
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
      publish,
      setActivePath,
      setDocuments,
      setOpenPaths,
      stateFor,
      workspaceFiles,
      workspaceRoot,
    ],
  );

  const closeCompare = useCallback(() => {
    if (!workspaceRoot || !activePath) {
      return;
    }
    const state = stateFor(workspaceRoot, activePath);
    if (!state.conflict) {
      return;
    }
    publish(
      workspaceRoot,
      activePath,
      transitionExternalFileConflict(state, {
        type: "compareClosed",
        target: externalFileConflictRef(state.conflict),
      }),
    );
  }, [activePath, publish, stateFor, workspaceRoot]);

  const activeState =
    workspaceRoot && activePath
      ? stateFor(workspaceRoot, activePath)
      : createExternalFileConflictState();
  const conflictCount = workspaceRoot
    ? Object.values(cacheRef.current[workspaceRoot] ?? {}).filter(
        (state) => state.conflict,
      ).length
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
