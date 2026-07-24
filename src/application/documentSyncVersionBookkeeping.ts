import {
  fileUriFromPath,
  languageServerDocumentSyncKey,
  languageServerUriSyncKey,
} from "../domain/languageServerDocumentSync";

interface VersionRef {
  readonly current: Record<string, number>;
}

export interface DocumentSyncVersionState {
  readonly diagnosticVersionsByUriRef: VersionRef;
  readonly documentVersionsByUriRef: VersionRef;
  readonly documentVersionsRef: VersionRef;
}

export function documentSyncVersion(
  documentVersionsRef: VersionRef,
  rootPath: string,
  path: string,
): number | null {
  return documentVersionsRef.current[languageServerDocumentSyncKey(rootPath, path)] ?? null;
}

export function clearDocumentSyncVersionState(
  state: DocumentSyncVersionState,
  rootPath: string,
  path: string,
  syncKey: string,
): void {
  delete state.documentVersionsRef.current[syncKey];
  const uriKey = languageServerUriSyncKey(rootPath, fileUriFromPath(path));
  delete state.documentVersionsByUriRef.current[uriKey];
  delete state.diagnosticVersionsByUriRef.current[uriKey];
}
