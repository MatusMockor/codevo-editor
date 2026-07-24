import type { NetteWorkspaceRouteOverlay } from "../domain/netteWorkspaceRoutesGateway";
import { workspaceRelativePath, type EditorDocument } from "../domain/workspace";

export function dirtyNetteWorkspaceRouteOverlays(
  documents: readonly EditorDocument[],
  rootPath: string | null,
): NetteWorkspaceRouteOverlay[] {
  if (!rootPath) return [];
  return documents.flatMap((document) => {
    const relativePath = workspaceRelativePath(rootPath, document.path);
    return relativePath?.toLowerCase().endsWith(".php") &&
      document.content !== document.savedContent
      ? [{ path: document.path, source: document.content }]
      : [];
  });
}
