import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  createWorkspaceTextFileWithContent,
  getFileName,
  getParentPath,
  type FileEntry,
  type WorkspaceFileGateway,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PhpCodeActionNewFile } from "./usePhpCodeActions";
import {
  shouldApplyClassEditAfterWrite,
  writeExtractedInterfaceFile,
} from "./phpExtractInterfaceWrite";

interface OpenFileOptions {
  pin?: boolean;
  readOnly?: boolean;
  recordNavigation?: boolean;
}

interface WatchedFileChange {
  changeType: "created" | "changed" | "deleted";
  path: string;
}

export interface PhpCodeActionNewFileApplicationDependencies {
  workspaceRoot: string | null;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  workspaceFiles: WorkspaceFileGateway;
  setExpandedDirectories: Dispatch<SetStateAction<Set<string>>>;
  notifyJavaScriptTypeScriptWatchedFilesChanged: (
    changes: WatchedFileChange[],
  ) => Promise<void>;
  openFile: (entry: FileEntry, options?: OpenFileOptions) => Promise<boolean>;
  readTestFileIfExists: (path: string) => Promise<string | null>;
  refreshDirectory: (path: string) => Promise<void>;
  reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void;
}

export function usePhpCodeActionNewFileApplication({
  workspaceRoot,
  currentWorkspaceRootRef,
  workspaceFiles,
  setExpandedDirectories,
  notifyJavaScriptTypeScriptWatchedFilesChanged,
  openFile,
  readTestFileIfExists,
  refreshDirectory,
  reportErrorForActiveWorkspaceRoot,
}: PhpCodeActionNewFileApplicationDependencies) {
  return useCallback(
    async (newFile: PhpCodeActionNewFile): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return false;
      }

      const targetPath = newFile.path;
      const operationTitle = newFile.title ?? "Extract Interface";
      const result = await writeExtractedInterfaceFile(
        targetPath,
        newFile.content,
        {
          fileExists: async (path) =>
            (await readTestFileIfExists(path)) !== null,
          writeFile: async (path, content) => {
            await createWorkspaceTextFileWithContent(
              workspaceFiles,
              path,
              content,
            );
          },
        },
      );

      if (result.status === "target-exists") {
        reportErrorForActiveWorkspaceRoot(
          requestedRoot,
          operationTitle,
          new Error(
            newFile.title
              ? `${getFileName(targetPath)} already exists - no changes were applied.`
              : `${getFileName(targetPath)} already exists - the class was left unchanged.`,
          ),
        );

        if (isRequestedRootActive()) {
          await openFile({
            kind: "file",
            name: getFileName(targetPath),
            path: targetPath,
          });
        }

        return false;
      }

      if (result.status === "write-failed") {
        reportErrorForActiveWorkspaceRoot(
          requestedRoot,
          operationTitle,
          result.error,
        );

        return false;
      }

      const parentPath = getParentPath(targetPath);

      if (isRequestedRootActive()) {
        await notifyJavaScriptTypeScriptWatchedFilesChanged([
          {
            changeType: "created",
            path: targetPath,
          },
        ]);
      }

      if (isRequestedRootActive()) {
        setExpandedDirectories((current) => new Set(current).add(parentPath));
        await refreshDirectory(parentPath);
      }

      if (isRequestedRootActive()) {
        await openFile({
          kind: "file",
          name: getFileName(targetPath),
          path: targetPath,
        });
      }

      return shouldApplyClassEditAfterWrite(result);
    },
    [
      currentWorkspaceRootRef,
      notifyJavaScriptTypeScriptWatchedFilesChanged,
      openFile,
      readTestFileIfExists,
      refreshDirectory,
      reportErrorForActiveWorkspaceRoot,
      setExpandedDirectories,
      workspaceFiles,
      workspaceRoot,
    ],
  );
}
