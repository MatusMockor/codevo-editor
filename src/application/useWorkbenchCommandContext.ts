import { useMemo, useRef } from "react";
import { isDirty, type EditorDocument } from "../domain/workspace";
import type { CommandContext } from "./commandRegistry";

interface UseWorkbenchCommandContextOptions {
  readonly activeDocument: EditorDocument | null;
  readonly captureEditorSurfaceScope: () => CommandContext["editorSurfaceScope"];
  readonly workspaceRoot: string | null;
}

export function useWorkbenchCommandContext({
  activeDocument,
  captureEditorSurfaceScope,
  workspaceRoot,
}: UseWorkbenchCommandContextOptions) {
  const commandContext = useMemo(
    () => ({
      hasWorkspace: Boolean(workspaceRoot),
      hasActiveDocument: Boolean(activeDocument),
      activeDocumentDirty: activeDocument
        ? !activeDocument.readOnly && isDirty(activeDocument)
        : false,
      editorSurfaceScope: captureEditorSurfaceScope(),
    }),
    [activeDocument, captureEditorSurfaceScope, workspaceRoot],
  );
  const commandContextRef = useRef(commandContext);
  commandContextRef.current = commandContext;
  return { commandContext, commandContextRef };
}
