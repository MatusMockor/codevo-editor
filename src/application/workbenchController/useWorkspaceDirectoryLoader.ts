import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { FileEntry, WorkspaceFileGateway } from "../../domain/workspace";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import { workspacePathBelongsToRoot } from "./workspacePathPolicy";
import {
  MAX_DIRECTORY_ENTRIES_PER_LOAD,
  type BoundedDirectoryLoadResult,
  type BoundedInFlightDirectoryLoads,
} from "./boundedInFlightDirectoryLoads";

interface WorkspaceDirectoryLoaderOptions {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly inFlightLoadsRef: MutableRefObject<BoundedInFlightDirectoryLoads>;
  readonly interactiveDeadlineMs?: number;
  readonly openWorkspaceRequestTokenRef: MutableRefObject<number>;
  readonly reportError: (source: string, error: unknown) => void;
  readonly setEntriesByDirectory: Dispatch<SetStateAction<Record<string, FileEntry[]>>>;
  readonly setFailedDirectories: Dispatch<SetStateAction<Set<string>>>;
  readonly setLoadingDirectories: Dispatch<SetStateAction<Set<string>>>;
  readonly setMessage: Dispatch<SetStateAction<string | null>>;
  readonly workspaceFiles: WorkspaceFileGateway;
}

export const DIRECTORY_LOAD_INTERACTIVE_DEADLINE_MS = 5_000;

export interface LoadWorkspaceDirectoryOptions {
  readonly clearMessage?: boolean;
  readonly isMutationOwnerCurrent?: () => boolean;
  readonly requireActiveRoot?: boolean;
}

export async function loadCompleteWorkspaceDirectoryEntries(
  load: () => Promise<BoundedDirectoryLoadResult | undefined>,
): Promise<FileEntry[] | null> {
  const result = await load();
  return result && !result.truncated ? [...result.entries] : null;
}

export function useWorkspaceDirectoryLoader({
  currentWorkspaceRootRef,
  inFlightLoadsRef,
  interactiveDeadlineMs = DIRECTORY_LOAD_INTERACTIVE_DEADLINE_MS,
  openWorkspaceRequestTokenRef,
  reportError,
  setEntriesByDirectory,
  setFailedDirectories,
  setLoadingDirectories,
  setMessage,
  workspaceFiles,
}: WorkspaceDirectoryLoaderOptions) {
  const ownedPresentationsRef = useRef(
    new Map<string, { readonly presentationId: symbol; readonly requestId: symbol }>(),
  );

  useEffect(
    () => () => {
      for (const [requestKey, ownership] of ownedPresentationsRef.current) {
        const cancelled = inFlightLoadsRef.current.cancelPresentation(
          requestKey,
          ownership.presentationId,
        );
        if (cancelled) {
          inFlightLoadsRef.current.retireIfCurrent(requestKey, ownership.requestId);
        }
      }
      ownedPresentationsRef.current.clear();
    },
    [inFlightLoadsRef],
  );

  return useCallback(
    async (
      path: string,
      options: LoadWorkspaceDirectoryOptions = {},
    ): Promise<BoundedDirectoryLoadResult | undefined> => {
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
        isCurrentWorkspaceGeneration() &&
        (!options.isMutationOwnerCurrent || options.isMutationOwnerCurrent()) &&
        (options.requireActiveRoot
          ? workspaceRootKeysEqual(currentWorkspaceRootRef.current, normalizedPath)
          : workspacePathBelongsToRoot(normalizedPath, currentWorkspaceRootRef.current));
      const isCurrentWorkspaceGeneration = () =>
        openWorkspaceRequestTokenRef.current === generation &&
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath);

      if (!isActiveRoot()) {
        return;
      }

      let physicalRequest = activeRequest;
      let sharedRead = physicalRequest?.promise;
      if (!sharedRead) {
        const readDirectoryBounded = workspaceFiles.readDirectoryBounded;
        if (!readDirectoryBounded) {
          updateDirectorySet(setFailedDirectories, normalizedPath, true);
          setMessage("Bounded directory reading is unavailable for this workspace.");
          return;
        }
        if (!inFlightLoadsRef.current.canAdmit(requestKey, generation, rootPath)) {
          updateDirectorySet(setFailedDirectories, normalizedPath, true);
          updateDirectorySet(setLoadingDirectories, normalizedPath, false);
          setMessage("Too many directory reads are still pending. Wait for one to finish.");
          return;
        }

        const requestId = Symbol(requestKey);
        const request = (async () => {
          await Promise.resolve();
          try {
            if (!isActiveRoot()) {
              throw new StaleDirectoryLoadError();
            }
            return await readDirectoryBounded.call(
              workspaceFiles,
              normalizedPath,
              MAX_DIRECTORY_ENTRIES_PER_LOAD,
            );
          } finally {
            inFlightLoadsRef.current.deleteIfCurrent(requestKey, requestId);
          }
        })();

        physicalRequest = {
          generation,
          path: normalizedPath,
          promise: request,
          requestId,
          rootPath,
        };
        const admitted = inFlightLoadsRef.current.admit(requestKey, physicalRequest);
        if (!admitted) {
          updateDirectorySet(setFailedDirectories, normalizedPath, true);
          updateDirectorySet(setLoadingDirectories, normalizedPath, false);
          setMessage("Too many directory reads are still pending. Wait for one to finish.");
          return;
        }
        sharedRead = request;
      }
      if (!physicalRequest) {
        return;
      }
      const physicalRequestId = physicalRequest.requestId;

      const presentation = inFlightLoadsRef.current.beginPresentation(
        requestKey,
        interactiveDeadlineMs,
      );
      const presentationId = presentation.id;
      ownedPresentationsRef.current.set(requestKey, {
        presentationId,
        requestId: physicalRequestId,
      });
      updateDirectorySet(setLoadingDirectories, normalizedPath, true);
      updateDirectorySet(setFailedDirectories, normalizedPath, false);

      const isCurrentPresentation = () =>
        inFlightLoadsRef.current.isCurrentPresentation(requestKey, presentationId);
      const clearCurrentLoading = () => {
        if (isCurrentWorkspaceGeneration() && isCurrentPresentation()) {
          updateDirectorySet(setLoadingDirectories, normalizedPath, false);
        }
      };

      try {
        const settlement = await settleAtInteractiveDeadline(sharedRead, presentation.settlement);
        if (settlement.status === "superseded") {
          return;
        }
        if (settlement.status === "deadline") {
          if (isCurrentPresentation()) {
            inFlightLoadsRef.current.retireIfCurrent(requestKey, physicalRequestId);
          }
          if (isActiveRoot() && isCurrentPresentation()) {
            updateDirectorySet(setFailedDirectories, normalizedPath, true);
            setMessage("This folder took too long to load. Retry to try again.");
          }
          clearCurrentLoading();
          return;
        }
        const result = settlement.result;
        if (!isActiveRoot() || !isCurrentPresentation()) {
          clearCurrentLoading();
          return;
        }

        setEntriesByDirectory((current) => ({
          ...current,
          [normalizedPath]: [...result.entries],
        }));
        updateDirectorySet(setFailedDirectories, normalizedPath, false);
        clearCurrentLoading();
        if (result.truncated) {
          setMessage(
            `Showing the first ${MAX_DIRECTORY_ENTRIES_PER_LOAD.toLocaleString()} entries. Refine this directory before continuing.`,
          );
        } else if (clearMessage) {
          setMessage(null);
        }
        return result;
      } catch (error) {
        if (!isActiveRoot() || !isCurrentPresentation()) {
          clearCurrentLoading();
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
          updateDirectorySet(setFailedDirectories, normalizedPath, false);
          clearCurrentLoading();
          return;
        }
        if (message.startsWith("workspace_directory_busy:")) {
          updateDirectorySet(setFailedDirectories, normalizedPath, true);
          clearCurrentLoading();
          setMessage("This folder is busy. Retry in a moment.");
          return;
        }

        updateDirectorySet(setFailedDirectories, normalizedPath, true);
        clearCurrentLoading();
        reportError("Workspace", error);
      } finally {
        if (ownedPresentationsRef.current.get(requestKey)?.presentationId === presentationId) {
          ownedPresentationsRef.current.delete(requestKey);
        }
        inFlightLoadsRef.current.finishPresentation(requestKey, presentationId);
      }
    },
    [
      currentWorkspaceRootRef,
      inFlightLoadsRef,
      interactiveDeadlineMs,
      openWorkspaceRequestTokenRef,
      ownedPresentationsRef,
      reportError,
      setEntriesByDirectory,
      setFailedDirectories,
      setLoadingDirectories,
      setMessage,
      workspaceFiles,
    ],
  );
}

type DirectoryReadSettlement =
  | { readonly status: "deadline" }
  | { readonly status: "superseded" }
  | { readonly status: "settled"; readonly result: BoundedDirectoryLoadResult };

class StaleDirectoryLoadError extends Error {}

async function settleAtInteractiveDeadline(
  request: Promise<BoundedDirectoryLoadResult>,
  presentationSettlement: Promise<"deadline" | "superseded">,
): Promise<DirectoryReadSettlement> {
  return await Promise.race([
    request.then((result): DirectoryReadSettlement => ({ status: "settled", result })),
    presentationSettlement.then((status): DirectoryReadSettlement => ({ status })),
  ]);
}

function updateDirectorySet(
  setter: Dispatch<SetStateAction<Set<string>>>,
  path: string,
  present: boolean,
): void {
  setter((current) => {
    if (current.has(path) === present) {
      return current;
    }
    const next = new Set(current);
    if (present) {
      next.add(path);
    } else {
      next.delete(path);
    }
    return next;
  });
}
