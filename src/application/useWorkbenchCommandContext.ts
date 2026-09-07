import { useMemo, useRef } from "react";
import { isDirty, type EditorDocument } from "../domain/workspace";
import type { ResolveEditorDocumentDirtyProjection } from "./editorDocumentExternalChangeProtection";
import { useEditorDocumentDirtySnapshot } from "./useEditorSessionDirtyProjection";
import type { CommandContext } from "./commandRegistry";

interface UseWorkbenchCommandContextOptions {
  readonly activeDocument: EditorDocument | null;
  readonly resolveDocumentSessionDirtyProjection?: ResolveEditorDocumentDirtyProjection;
  readonly captureEditorSurfaceScope: () => CommandContext["editorSurfaceScope"];
  readonly workspaceRoot: string | null;
}

export function useWorkbenchCommandContext({
  activeDocument,
  captureEditorSurfaceScope,
  resolveDocumentSessionDirtyProjection,
  workspaceRoot,
}: UseWorkbenchCommandContextOptions) {
  const projection = activeDocument
    ? (resolveDocumentSessionDirtyProjection?.(activeDocument.path) ?? null)
    : null;
  const dirtySnapshot = useEditorDocumentDirtySnapshot(projection);
  const commandContext = useMemo(
    () => ({
      hasWorkspace: Boolean(workspaceRoot),
      hasActiveDocument: Boolean(activeDocument),
      activeDocumentDirty: activeDocument
        ? !activeDocument.readOnly &&
          (projection === null
            ? isDirty(activeDocument)
            : dirtySnapshot.status === "available" &&
              (dirtySnapshot.dirty || isDirty(activeDocument)))
        : false,
      editorSurfaceScope: captureEditorSurfaceScope(),
    }),
    [activeDocument, captureEditorSurfaceScope, dirtySnapshot, projection, workspaceRoot],
  );
  const commandContextRef = useRef(commandContext);
  commandContextRef.current = commandContext;
  return { commandContext, commandContextRef };
}
