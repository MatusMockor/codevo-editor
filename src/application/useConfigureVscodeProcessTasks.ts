import { useCallback, type MutableRefObject } from "react";
import type {
  FileEntry,
  WorkspaceFileGateway,
  WorkspaceOwnerFileGateway,
} from "../domain/workspace";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";
import {
  configureVscodeProcessTasks,
  type VscodeProcessTasksConfigurationAction,
} from "./configureVscodeProcessTasks";
import type { WorkspaceRuntimeOwnerClaimRegistry } from "./workspaceRuntimeOwnerClaimRegistry";

interface UseConfigureVscodeProcessTasksOptions {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly openFile: (
    entry: FileEntry,
    options: {
      readonly pin: boolean;
      readonly shouldCommit: () => boolean;
    },
  ) => Promise<boolean>;
  readonly workspaceFiles: WorkspaceFileGateway;
  readonly workspaceOwnerFiles: WorkspaceOwnerFileGateway | undefined;
  readonly workspaceIdentity: WorkspaceIdentityDescriptor | null;
  readonly workspaceRoot: string | null;
  readonly workspaceRuntimeOwner: WorkspaceRuntimeOwner | null;
  readonly workspaceRuntimeOwnerClaimsRef: MutableRefObject<WorkspaceRuntimeOwnerClaimRegistry>;
  readonly workspaceRuntimeOwnerRef: MutableRefObject<WorkspaceRuntimeOwner | null>;
  readonly workspaceTrustedRef: MutableRefObject<boolean>;
}

export function useConfigureVscodeProcessTasks({
  currentWorkspaceRootRef,
  openFile,
  workspaceFiles,
  workspaceOwnerFiles,
  workspaceIdentity,
  workspaceRoot,
  workspaceRuntimeOwner,
  workspaceRuntimeOwnerClaimsRef,
  workspaceRuntimeOwnerRef,
  workspaceTrustedRef,
}: UseConfigureVscodeProcessTasksOptions) {
  return useCallback(
    async (
      action: VscodeProcessTasksConfigurationAction,
    ): Promise<boolean> => {
      if (
        !workspaceRoot ||
        !workspaceIdentity ||
        !workspaceRuntimeOwner ||
        !workspaceOwnerFiles
      ) {
        return false;
      }
      const claimGeneration =
        workspaceRuntimeOwnerClaimsRef.current.generationFor(
          workspaceRuntimeOwner.ownerKey,
        );
      const isCurrent = () =>
        workspaceTrustedRef.current &&
        workspaceRootKeysEqual(
          currentWorkspaceRootRef.current,
          workspaceRoot,
        ) &&
        workspaceRuntimeOwnerRef.current?.ownerKey ===
          workspaceRuntimeOwner.ownerKey &&
        workspaceRuntimeOwnerClaimsRef.current.generationFor(
          workspaceRuntimeOwner.ownerKey,
        ) === claimGeneration;

      return configureVscodeProcessTasks({
        action,
        files: {
          createDirectoryForWorkspace:
            workspaceOwnerFiles.createDirectoryForWorkspace.bind(
              workspaceOwnerFiles,
            ),
          createTextFileWithContentForWorkspace:
            workspaceOwnerFiles.createTextFileWithContentForWorkspace.bind(
              workspaceOwnerFiles,
            ),
          readDirectory: workspaceFiles.readDirectory.bind(workspaceFiles),
        },
        isCurrent,
        openFile: (entry) =>
          openFile(entry, { pin: true, shouldCommit: isCurrent }),
        rootPath: workspaceRoot,
        workspaceId: workspaceIdentity.workspaceId,
      });
    },
    [
      currentWorkspaceRootRef,
      openFile,
      workspaceFiles,
      workspaceIdentity,
      workspaceOwnerFiles,
      workspaceRoot,
      workspaceRuntimeOwner,
      workspaceRuntimeOwnerClaimsRef,
      workspaceRuntimeOwnerRef,
      workspaceTrustedRef,
    ],
  );
}
