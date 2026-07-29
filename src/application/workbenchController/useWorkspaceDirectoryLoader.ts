import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { FileEntry, WorkspaceFileGateway } from "../../domain/workspace";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import { workspacePathBelongsToRoot } from "./workspacePathPolicy";

export interface InFlightDirectoryLoad {
  readonly generation: number;
  readonly path: string;
  readonly promise: Promise<FileEntry[]>;
  readonly requestId: symbol;
  readonly rootPath: string | null;
}

interface WorkspaceDirectoryLoaderOptions {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly inFlightLoadsRef: MutableRefObject<Map<string, InFlightDirectoryLoad>>;
  readonly openWorkspaceRequestTokenRef: MutableRefObject<number>;
  readonly reportError: (source: string, error: unknown) => void;
  readonly setEntriesByDirectory: Dispatch<SetStateAction<Record<string, FileEntry[]>>>;
  readonly setLoadingDirectories: Dispatch<SetStateAction<Set<string>>>;
  readonly setMessage: Dispatch<SetStateAction<string | null>>;
  readonly workspaceFiles: WorkspaceFileGateway;
}

export interface LoadWorkspaceDirectoryOptions {
  readonly clearMessage?: boolean;
  readonly isMutationOwnerCurrent?: () => boolean;
  readonly requireActiveRoot?: boolean;
}

export function useWorkspaceDirectoryLoader({
  currentWorkspaceRootRef,
  inFlightLoadsRef,
  openWorkspaceRequestTokenRef,
  reportError,
  setEntriesByDirectory,
  setLoadingDirectories,
  setMessage,
  workspaceFiles,
}: WorkspaceDirectoryLoaderOptions) {
  return useCallback(
    async (
      path: string,
      options: LoadWorkspaceDirectoryOptions = {},
    ): Promise<FileEntry[] | undefined> => {
      const rootPath = currentWorkspaceRootRef.current;
      const generation = openWorkspaceRequestTokenRef.current;
      const normalizedPath = normalizedWorkspaceRootKey(path);
      const clearMessage = options.clearMessage !== false;
      const requestKey = JSON.stringify([
        normalizedWorkspaceRootKey(rootPath),
        generation,
        normalizedPath,
      ]);
      const activeRequest = inFlightLoadsRef.current.get(requestKey);

      const isActiveRoot = () =>
        openWorkspaceRequestTokenRef.current === generation &&
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
        (!options.isMutationOwnerCurrent || options.isMutationOwnerCurrent()) &&
        (options.requireActiveRoot
          ? workspaceRootKeysEqual(currentWorkspaceRootRef.current, normalizedPath)
          : workspacePathBelongsToRoot(normalizedPath, currentWorkspaceRootRef.current));

      let sharedRead = activeRequest?.promise;
      if (!sharedRead) {
        setLoadingDirectories((current) => new Set(current).add(normalizedPath));

        const requestId = Symbol(requestKey);
        const request = (async () => {
          await Promise.resolve();
          try {
            return await workspaceFiles.readDirectory(normalizedPath);
          } finally {
            const registeredRequest = inFlightLoadsRef.current.get(requestKey);
            if (registeredRequest?.requestId === requestId) {
              inFlightLoadsRef.current.delete(requestKey);
            }

            setLoadingDirectories((current) => {
              const hasActiveRequestForPath = [...inFlightLoadsRef.current.values()].some(
                (candidate) =>
                  candidate.generation === openWorkspaceRequestTokenRef.current &&
                  workspaceRootKeysEqual(candidate.rootPath, currentWorkspaceRootRef.current) &&
                  candidate.path === normalizedPath,
              );
              if (hasActiveRequestForPath || !current.has(normalizedPath)) {
                return current;
              }

              const next = new Set(current);
              next.delete(normalizedPath);
              return next;
            });
          }
        })();

        inFlightLoadsRef.current.set(requestKey, {
          generation,
          path: normalizedPath,
          promise: request,
          requestId,
          rootPath,
        });
        sharedRead = request;
      }

      try {
        const entries = await sharedRead;
        if (!isActiveRoot()) {
          return;
        }

        setEntriesByDirectory((current) => ({
          ...current,
          [normalizedPath]: entries,
        }));
        if (clearMessage) {
          setMessage(null);
        }
        return entries;
      } catch (error) {
        if (!isActiveRoot()) {
          return;
        }

        const message =
          error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        const isMissingDirectory =
          message.includes("enoent") ||
          message.includes("no such file") ||
          message.includes("not a directory");
        if (isMissingDirectory) {
          setEntriesByDirectory((current) => {
            if (!(normalizedPath in current)) {
              return current;
            }
            const next = { ...current };
            delete next[normalizedPath];
            return next;
          });
          return;
        }

        reportError("Workspace", error);
      }
    },
    [
      currentWorkspaceRootRef,
      inFlightLoadsRef,
      openWorkspaceRequestTokenRef,
      reportError,
      setEntriesByDirectory,
      setLoadingDirectories,
      setMessage,
      workspaceFiles,
    ],
  );
}
