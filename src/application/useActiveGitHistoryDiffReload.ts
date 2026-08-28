import { useEffect } from "react";
import { isGitHistoryDiffDocumentPath } from "../domain/editorDocumentSchemes";

interface ActiveGitHistoryDiffReloadOptions {
  readonly activeDocumentPath: string | null;
  readonly documentsByPath: Readonly<Record<string, unknown>>;
  readonly reloadDocumentPath: (documentPath: string) => Promise<void>;
}

export function useActiveGitHistoryDiffReload({
  activeDocumentPath,
  documentsByPath,
  reloadDocumentPath,
}: ActiveGitHistoryDiffReloadOptions): void {
  useEffect(() => {
    if (
      !activeDocumentPath ||
      !isGitHistoryDiffDocumentPath(activeDocumentPath) ||
      documentsByPath[activeDocumentPath]
    ) {
      return;
    }

    void reloadDocumentPath(activeDocumentPath);
  }, [activeDocumentPath, documentsByPath, reloadDocumentPath]);
}
