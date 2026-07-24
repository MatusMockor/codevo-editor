import { useMemo } from "react";
import type { EditorDocument } from "../domain/workspace";
import { dirtyExpressRoutesDocumentSnapshots } from "./expressRoutesDocumentEligibility";

export function useDirtyExpressRoutesDocumentSnapshots(
  openDocuments: readonly EditorDocument[],
  activeDocument: EditorDocument | null,
  workspaceRoot: string | null,
) {
  return useMemo(
    () => dirtyExpressRoutesDocumentSnapshots([...openDocuments, activeDocument], workspaceRoot),
    [activeDocument, openDocuments, workspaceRoot],
  );
}
