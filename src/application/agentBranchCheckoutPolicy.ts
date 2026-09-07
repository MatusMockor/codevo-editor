import type { EditorDocument } from "../domain/workspace";
import { isInsideAgentSurfaceRoot } from "./useAgentSurfaceFileTree";

export function agentBranchCheckoutBlockedReason(
  rootPath: string,
  documents: ReadonlyArray<Pick<EditorDocument, "path" | "content" | "savedContent">> | undefined,
  threads: ReadonlyArray<{ readonly rootPath: string; readonly running: boolean }>,
  dispatching: boolean,
  isLiveDocumentDirty?: (path: string) => boolean,
): string | null {
  if (documents === undefined) return "The editor is not ready to switch branches.";
  if (documents.length > 256) return "Close some open files before switching branches.";
  if (dispatching) return "Wait for the agent to finish starting before switching branches.";
  if (threads.some((thread) => thread.rootPath === rootPath && thread.running))
    return "Stop the agent working in this checkout before switching branches.";
  if (
    documents.some(
      (document) =>
        isInsideAgentSurfaceRoot(rootPath, document.path) &&
        (document.content !== document.savedContent ||
          isLiveDocumentDirty?.(document.path) === true),
    )
  )
    return "Save your unsaved files in this checkout before switching branches.";
  return null;
}
