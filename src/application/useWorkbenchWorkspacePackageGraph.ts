import type { WorkspaceSourceDiscoveryGateway } from "../domain/workspaceSourceDiscovery";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import { useWorkbenchDiscoveryVersions } from "./useWorkbenchDiscoveryVersions";
import { useWorkspacePackageGraph } from "./useWorkspacePackageGraph";

const UNAVAILABLE_GATEWAY: WorkspaceSourceDiscoveryGateway = {
  enumerateJavaScriptSourceFiles: () => Promise.resolve({ files: [], truncated: true, visited: 0 }),
  readSourceTextBounded: () => Promise.resolve({ status: "changed" }),
};

export function useWorkbenchWorkspacePackageGraph(
  workspaceDescriptor: WorkspaceDescriptor | null,
  symfonyEnabled: boolean,
  gateway: WorkspaceSourceDiscoveryGateway | undefined,
  owner: WorkspaceRuntimeOwner | null,
) {
  const versions = useWorkbenchDiscoveryVersions(workspaceDescriptor?.php, symfonyEnabled);
  const rootPath = owner?.executionRoot ?? null;
  const workspacePackageDiscovery = useWorkspacePackageGraph({
    discoveryVersion: versions.workspacePackageDiscoveryVersion,
    enabled: Boolean(
      rootPath &&
      workspaceDescriptor?.javaScriptTypeScript &&
      workspaceRootKeysEqual(workspaceDescriptor.rootPath, rootPath),
    ),
    gateway: gateway ?? UNAVAILABLE_GATEWAY,
    rootPath,
    workspaceId: owner?.ownerKey ?? null,
  });
  return {
    ...versions,
    packageForPath: workspacePackageDiscovery.packageForPath,
    workspacePackageDiscovery,
  };
}
