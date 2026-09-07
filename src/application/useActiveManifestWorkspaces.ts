import { useEffect } from "react";
import type {
  WorkspaceDescriptor,
  ComposerPackageDescriptor,
  NpmPackageDescriptor,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export function useActiveManifestWorkspaces(
  workspaceRoot: string | null,
  workspaceDescriptor: WorkspaceDescriptor | null,
  registerActiveComposerManifestWorkspace: (workspace: {
    readonly rootPath: string;
    readonly packages: readonly ComposerPackageDescriptor[];
  }) => () => void,
  registerActiveNpmManifestWorkspace: (workspace: {
    readonly rootPath: string;
    readonly packages: readonly NpmPackageDescriptor[];
  }) => () => void,
): void {
  useEffect(() => {
    if (
      !workspaceRoot ||
      !workspaceDescriptor ||
      !workspaceRootKeysEqual(workspaceRoot, workspaceDescriptor.rootPath)
    ) {
      return;
    }

    return registerActiveComposerManifestWorkspace({
      packages: workspaceDescriptor.php?.packages ?? [],
      rootPath: workspaceRoot,
    });
  }, [registerActiveComposerManifestWorkspace, workspaceDescriptor, workspaceRoot]);
  useEffect(() => {
    if (!workspaceRoot || !workspaceDescriptor) return;
    if (!workspaceRootKeysEqual(workspaceRoot, workspaceDescriptor.rootPath)) return;
    return registerActiveNpmManifestWorkspace({
      packages: workspaceDescriptor.javaScriptTypeScript?.packages ?? [],
      rootPath: workspaceRoot,
    });
  }, [registerActiveNpmManifestWorkspace, workspaceDescriptor, workspaceRoot]);
}
