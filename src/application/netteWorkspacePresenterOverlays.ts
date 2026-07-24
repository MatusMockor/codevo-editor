import type { NetteWorkspacePresenterOverlay } from "../domain/netteWorkspacePresentersGateway";
import { workspaceRelativePath, type EditorDocument } from "../domain/workspace";

export function dirtyNetteWorkspacePresenterOverlays(
  documents: readonly EditorDocument[],
  rootPath: string | null,
): NetteWorkspacePresenterOverlay[] {
  if (!rootPath) return [];

  return documents.flatMap((document) => {
    const relativePath = workspaceRelativePath(rootPath, document.path);
    const eligible =
      relativePath?.toLowerCase().endsWith("presenter.php") ||
      relativePath?.toLowerCase().endsWith(".latte");
    return eligible && document.content !== document.savedContent
      ? [{ path: document.path, source: document.content }]
      : [];
  });
}
