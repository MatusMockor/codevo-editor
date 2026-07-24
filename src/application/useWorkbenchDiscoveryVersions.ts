import type { PhpProjectDescriptor } from "../domain/workspace";
import { isNetteApplicationProject } from "../domain/netteOperationalProject";
import { useWorkspaceDiscoveryVersions } from "./useWorkspaceDiscoveryVersions";

export function useWorkbenchDiscoveryVersions(
  phpProject: PhpProjectDescriptor | null | undefined,
  symfonyEnabled: boolean,
) {
  return {
    ...useWorkspaceDiscoveryVersions({ phpProject, symfonyEnabled }),
    hasNetteApplicationFramework: phpProject ? isNetteApplicationProject(phpProject) : false,
  };
}
