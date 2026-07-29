import { useCallback, type MutableRefObject } from "react";
import { languageServerDocumentSyncKey } from "../domain/languageServerDocumentSync";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export interface JavaScriptTypeScriptLegacyHandoffDependencies {
  canOpen(rootPath: string, path: string): boolean;
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  retire(rootPath: string, path: string, isCurrent?: () => boolean): Promise<void>;
  readonly syncedPathsRef: MutableRefObject<Set<string>>;
}

export function useJavaScriptTypeScriptLegacyHandoff({
  canOpen,
  currentWorkspaceRootRef,
  retire,
  syncedPathsRef,
}: JavaScriptTypeScriptLegacyHandoffDependencies) {
  const isSafe = useCallback(
    (rootPath: string, path: string) =>
      !syncedPathsRef.current.has(languageServerDocumentSyncKey(rootPath, path)) &&
      canOpen(rootPath, path),
    [canOpen, syncedPathsRef],
  );
  const retireForHandoff = useCallback(
    async (rootPath: string, path: string, isCurrent: () => boolean = () => true) => {
      if (!isCurrent() || !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return false;
      }
      await retire(rootPath, path, isCurrent);
      return isCurrent() && isSafe(rootPath, path);
    },
    [currentWorkspaceRootRef, isSafe, retire],
  );
  return { isSafe, retireForHandoff };
}
