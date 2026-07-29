import { createWorkspaceRoot, parseWorkspacePath } from "../domain/workspacePath";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";

export function workspaceRelativePathForDescriptor(
  descriptor: WorkspaceIdentityDescriptor,
  path: string,
): string | null {
  for (const rootPath of [descriptor.selectedPath, descriptor.canonicalRoot]) {
    const root = createWorkspaceRoot(descriptor.workspaceId, rootPath, descriptor.policy);
    if (!root.ok) {
      continue;
    }

    const parsed = parseWorkspacePath(root.value, path);
    if (parsed.ok) {
      return parsed.value.relativePath;
    }
  }

  return null;
}
