import type { NetteWorkspaceServiceOverlay } from "../domain/netteWorkspaceServicesGateway";
import { workspaceRelativePath, type EditorDocument } from "../domain/workspace";

export function dirtyNetteWorkspaceServiceOverlays(
  documents: readonly EditorDocument[],
  rootPath: string | null,
): NetteWorkspaceServiceOverlay[] {
  if (!rootPath) return [];

  return documents.flatMap((document) => {
    const relativePath = workspaceRelativePath(rootPath, document.path);
    return relativePath &&
      relativePath.toLowerCase().endsWith(".neon") &&
      document.content !== document.savedContent
      ? [{ path: document.path, source: document.content }]
      : [];
  });
}
