import { describe, expect, it } from "vitest";
import {
  languageServerDocumentSyncKey,
  languageServerUriSyncKey,
  fileUriFromPath,
} from "../domain/languageServerDocumentSync";
import {
  clearDocumentSyncVersionState,
  documentSyncVersion,
} from "./documentSyncVersionBookkeeping";

describe("document sync version bookkeeping", () => {
  it("reads a scoped version and clears every version alias together", () => {
    const rootPath = "/workspace";
    const path = "/workspace/src/App.ts";
    const syncKey = languageServerDocumentSyncKey(rootPath, path);
    const uriKey = languageServerUriSyncKey(rootPath, fileUriFromPath(path));
    const documentVersionsRef = { current: { [syncKey]: 7 } };
    const documentVersionsByUriRef = { current: { [uriKey]: 7 } };
    const diagnosticVersionsByUriRef = { current: { [uriKey]: 6 } };

    expect(documentSyncVersion(documentVersionsRef, rootPath, path)).toBe(7);
    clearDocumentSyncVersionState(
      { diagnosticVersionsByUriRef, documentVersionsByUriRef, documentVersionsRef },
      rootPath,
      path,
      syncKey,
    );

    expect(documentSyncVersion(documentVersionsRef, rootPath, path)).toBeNull();
    expect(documentVersionsByUriRef.current).toEqual({});
    expect(diagnosticVersionsByUriRef.current).toEqual({});
  });
});
