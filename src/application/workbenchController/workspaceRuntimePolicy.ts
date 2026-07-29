import type { BackgroundRuntimePolicy } from "../../domain/settings";
import {
  createLegacyWorkspaceRuntimeOwner,
  createWorkspaceRuntimeOwner,
  type WorkspaceRuntimeOwner,
} from "../../domain/workspaceRuntimeOwner";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";

export function backgroundRuntimeOwnersForPolicy(
  policy: BackgroundRuntimePolicy,
  activeRootPath: string | null,
  previousRootPath: string | null,
  workspaceTabs: readonly string[],
  runtimeOwnersByTab: Record<string, WorkspaceRuntimeOwner>,
): WorkspaceRuntimeOwner[] {
  if (policy === "keepAlive") {
    return [];
  }

  const rootPaths =
    policy === "singleActive" || previousRootPath === null
      ? workspaceTabs.filter((rootPath) => !workspaceRootKeysEqual(rootPath, activeRootPath))
      : previousRootPath && !workspaceRootKeysEqual(previousRootPath, activeRootPath)
        ? [previousRootPath]
        : [];
  const owners = rootPaths.flatMap((rootPath) => {
    const owner = runtimeOwnersByTab[rootPath];
    return owner ? [owner] : [];
  });

  return owners.filter(
    (owner, index) =>
      owners.findIndex((candidate) => candidate.ownerKey === owner.ownerKey) === index,
  );
}

export function workspaceRuntimeOwnerFor(
  executionRoot: string,
  descriptor: WorkspaceIdentityDescriptor | null,
): WorkspaceRuntimeOwner {
  if (descriptor) {
    return createWorkspaceRuntimeOwner(descriptor.workspaceId, executionRoot);
  }

  return createLegacyWorkspaceRuntimeOwner(executionRoot);
}
