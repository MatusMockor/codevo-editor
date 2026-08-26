import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  createWorkspaceTextFileWithContent,
  getFileName,
  getParentPath,
  type FileEntry,
  type WorkspaceFileGateway,
  type WorkspaceOwnerFileGateway,
  type WorkspaceWriteResult,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";
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
  workspaceIdentityDescriptorRef: MutableRefObject<WorkspaceIdentityDescriptor | null>;
  workspaceOwnerFiles: WorkspaceOwnerFileGateway | undefined;
  workspaceRuntimeOwnerClaimsRef: {
    readonly current: { generationFor(ownerKey: string): number | null | undefined };
  };
  workspaceRuntimeOwnerRef: MutableRefObject<WorkspaceRuntimeOwner | null>;
  setExpandedDirectories: Dispatch<SetStateAction<Set<string>>>;
  notifyJavaScriptTypeScriptWatchedFilesChanged: (changes: WatchedFileChange[]) => Promise<void>;
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
  workspaceIdentityDescriptorRef,
  workspaceOwnerFiles,
  workspaceRuntimeOwnerClaimsRef,
  workspaceRuntimeOwnerRef,
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
      const requestedIdentity = workspaceIdentityDescriptorRef.current;
      const requestedOwner = workspaceRuntimeOwnerRef.current;
      const requestedOwnerGeneration = requestedOwner
        ? workspaceRuntimeOwnerClaimsRef.current.generationFor(requestedOwner.ownerKey)
        : null;
      const isRequestedRootActive = () => {
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) return false;
        if (!requestedIdentity) {
          return !requestedOwner && requestedOwnerGeneration === null;
        }
        if (!requestedOwner || requestedOwnerGeneration === null) return false;
        if (requestedOwnerGeneration === undefined) return false;
        return (
          workspaceIdentityDescriptorRef.current === requestedIdentity &&
          workspaceRuntimeOwnerRef.current === requestedOwner &&
          requestedIdentity.workspaceId === requestedOwner.ownerKey &&
          workspaceRootKeysEqual(requestedOwner.executionRoot, requestedRoot) &&
          workspaceRuntimeOwnerClaimsRef.current.generationFor(requestedOwner.ownerKey) ===
            requestedOwnerGeneration
        );
      };

      if (!requestedRoot || !isRequestedRootActive()) {
        return false;
      }

      const targetPath = newFile.path;
      const operationTitle = newFile.title ?? "Extract Interface";
      const result = await writeExtractedInterfaceFile(targetPath, newFile.content, {
        fileExists: async (path) => {
          if (!isRequestedRootActive()) throw new Error("Workspace authority changed.");
          const exists = (await readTestFileIfExists(path)) !== null;
          if (!isRequestedRootActive()) throw new Error("Workspace authority changed.");
          return exists;
        },
        writeFile: async (path, content) => {
          if (!isRequestedRootActive()) throw new Error("Workspace authority changed.");
          if (requestedIdentity && requestedOwner) {
            if (!workspaceOwnerFiles) throw new Error("Workspace owner file gateway unavailable.");
            const writeResult = await workspaceOwnerFiles.createTextFileWithContentForWorkspace(
              requestedOwner.ownerKey,
              path,
              content,
            );
            if (!isRequestedRootActive()) throw new Error("Workspace authority changed.");
            requireSuccessfulWorkspaceWrite(writeResult);
            return;
          }
          await createWorkspaceTextFileWithContent(workspaceFiles, path, content);
          if (!isRequestedRootActive()) throw new Error("Workspace authority changed.");
        },
      });

      if (!isRequestedRootActive()) return false;

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
        reportErrorForActiveWorkspaceRoot(requestedRoot, operationTitle, result.error);

        return false;
      }

      const parentPath = getParentPath(targetPath);

      if (!isRequestedRootActive()) return false;
      await notifyJavaScriptTypeScriptWatchedFilesChanged([
        {
          changeType: "created",
          path: targetPath,
        },
      ]);
      if (!isRequestedRootActive()) return false;

      setExpandedDirectories((current) => new Set(current).add(parentPath));
      await refreshDirectory(parentPath);
      if (!isRequestedRootActive()) return false;

      await openFile({
        kind: "file",
        name: getFileName(targetPath),
        path: targetPath,
      });
      if (!isRequestedRootActive()) return false;

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
      workspaceIdentityDescriptorRef,
      workspaceOwnerFiles,
      workspaceRoot,
      workspaceRuntimeOwnerClaimsRef,
      workspaceRuntimeOwnerRef,
    ],
  );
}

function requireSuccessfulWorkspaceWrite(result: WorkspaceWriteResult): void {
  switch (result.status) {
    case "success":
      return;
    case "conflict":
    case "partial":
    case "error":
      throw new Error(result.message);
    default: {
      const unsupported: never = result;
      throw new Error(`Unsupported workspace write result: ${String(unsupported)}`);
    }
  }
}
