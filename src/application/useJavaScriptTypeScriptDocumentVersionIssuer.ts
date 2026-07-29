import { useCallback, type MutableRefObject } from "react";
import { languageServerDocumentSyncKey } from "../domain/languageServerDocumentSync";

export function useJavaScriptTypeScriptDocumentVersionIssuer(
  nextVersion: (rootPath: string, path: string) => number,
  authorityVersionsRef: MutableRefObject<Record<string, number>>,
  nextAuthorityVersionRef: MutableRefObject<number>,
) {
  return useCallback(
    (rootPath: string, path: string): number => {
      const version = nextVersion(rootPath, path);
      nextAuthorityVersionRef.current += 1;
      authorityVersionsRef.current[languageServerDocumentSyncKey(rootPath, path)] =
        nextAuthorityVersionRef.current;
      return version;
    },
    [authorityVersionsRef, nextAuthorityVersionRef, nextVersion],
  );
}
