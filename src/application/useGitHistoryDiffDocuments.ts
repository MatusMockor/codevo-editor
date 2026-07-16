import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildGitHistoryDiffDocumentPath,
  isGitHistoryDiffDocumentPath,
} from "../domain/editorDocumentSchemes";
import type {
  DiffPayload,
  FileChange,
  GitChangeStatus,
  GitFileDiff,
  GitHistoryGateway,
} from "../domain/git";
import type { EditorDocument } from "../domain/workspace";

export interface GitHistoryDiffDocumentState {
  diff: GitFileDiff | null;
  isLoading: boolean;
}

interface GitHistoryDiffDocumentStore {
  documents: Record<string, GitHistoryDiffDocumentState>;
  ownerKey: string | null;
}

export interface UseGitHistoryDiffDocumentsOptions {
  gateway: Pick<GitHistoryGateway, "getCommitDiff">;
  onOpenDocument(document: EditorDocument): void;
  ownerId: string | null;
  workspaceRoot: string | null;
}

export interface GitHistoryDiffDocumentsController {
  closeDocumentPaths(paths: readonly string[]): void;
  documentsByPath: Record<string, GitHistoryDiffDocumentState>;
  openCommitDiff(
    commitHash: string,
    path: string,
    oldPath: string | null,
    files?: FileChange[],
  ): Promise<void>;
}

/**
 * Owns commit-diff payloads independently for every editor document.
 *
 * A global last-request token makes two parallel history tabs mutually cancel
 * one another: the slower tab is left open without a payload. This hook keeps
 * one token per transient document and fences every result by the native
 * workspace owner, so reverse-order responses, closes, and same-root workspace
 * replacement cannot populate another editor session.
 */
export function useGitHistoryDiffDocuments({
  gateway,
  onOpenDocument,
  ownerId,
  workspaceRoot,
}: UseGitHistoryDiffDocumentsOptions): GitHistoryDiffDocumentsController {
  const ownerKey = gitHistoryDiffOwnerKey(workspaceRoot, ownerId);
  const ownerKeyRef = useRef(ownerKey);
  ownerKeyRef.current = ownerKey;
  const requestTokensRef = useRef(new Map<string, symbol>());
  const [store, setStore] = useState<GitHistoryDiffDocumentStore>(() => ({
    documents: {},
    ownerKey,
  }));

  useEffect(() => {
    requestTokensRef.current.clear();
    setStore((current) => {
      if (current.ownerKey === ownerKey) {
        return current;
      }

      return { documents: {}, ownerKey };
    });
  }, [ownerKey]);

  const documentsByPath = useMemo(
    () => store.ownerKey === ownerKey ? store.documents : {},
    [ownerKey, store],
  );

  const closeDocumentPaths = useCallback((paths: readonly string[]) => {
    const closedPaths = new Set(paths.filter(isGitHistoryDiffDocumentPath));
    if (closedPaths.size === 0) {
      return;
    }

    for (const path of closedPaths) {
      requestTokensRef.current.delete(path);
    }

    setStore((current) => {
      if (current.ownerKey !== ownerKeyRef.current) {
        return current;
      }

      const documents = { ...current.documents };
      let changed = false;
      for (const path of closedPaths) {
        if (!documents[path]) {
          continue;
        }

        delete documents[path];
        changed = true;
      }

      if (!changed) {
        return current;
      }

      return { ...current, documents };
    });
  }, []);

  const openCommitDiff = useCallback(
    async (
      commitHash: string,
      path: string,
      oldPath: string | null,
      files?: FileChange[],
    ) => {
      const requestedRoot = workspaceRoot;
      const requestedOwner = ownerKey;
      if (!requestedRoot || !requestedOwner) {
        return;
      }

      if (ownerKeyRef.current !== requestedOwner) {
        return;
      }

      const documentPath = buildGitHistoryDiffDocumentPath(
        commitHash,
        path,
        oldPath,
      );
      const requestToken = Symbol(documentPath);
      requestTokensRef.current.set(documentPath, requestToken);
      onOpenDocument(historyDiffDocument(documentPath, path));
      setStore((current) => ({
        documents: {
          ...(current.ownerKey === requestedOwner ? current.documents : {}),
          [documentPath]: { diff: null, isLoading: true },
        },
        ownerKey: requestedOwner,
      }));

      try {
        const payload = await gateway.getCommitDiff(
          requestedRoot,
          commitHash,
          path,
          oldPath,
          files,
        );
        if (!requestIsCurrent(
          requestTokensRef.current,
          ownerKeyRef.current,
          documentPath,
          requestToken,
          requestedOwner,
        )) {
          return;
        }

        const diff = gitFileDiffFromHistoryPayload(payload, path, oldPath);
        setStore((current) => updateHistoryDocument(
          current,
          requestedOwner,
          documentPath,
          { diff, isLoading: false },
        ));
      } catch (error) {
        if (!requestIsCurrent(
          requestTokensRef.current,
          ownerKeyRef.current,
          documentPath,
          requestToken,
          requestedOwner,
        )) {
          return;
        }

        console.error("Failed to load commit file diff.", error);
        setStore((current) => updateHistoryDocument(
          current,
          requestedOwner,
          documentPath,
          { diff: null, isLoading: false },
        ));
      } finally {
        if (requestTokensRef.current.get(documentPath) === requestToken) {
          requestTokensRef.current.delete(documentPath);
        }
      }
    },
    [gateway, onOpenDocument, ownerKey, workspaceRoot],
  );

  return {
    closeDocumentPaths,
    documentsByPath,
    openCommitDiff,
  };
}

function gitHistoryDiffOwnerKey(
  workspaceRoot: string | null,
  ownerId: string | null,
): string | null {
  if (!workspaceRoot) {
    return null;
  }

  return JSON.stringify([ownerId ?? "legacy", workspaceRoot]);
}

function historyDiffDocument(documentPath: string, path: string): EditorDocument {
  return {
    content: "",
    language: "plaintext",
    name: `Diff: ${fileNameForPath(path)}`,
    path: documentPath,
    readOnly: true,
    savedContent: "",
  };
}

function gitFileDiffFromHistoryPayload(
  payload: DiffPayload,
  requestedPath: string,
  requestedOldPath: string | null,
): GitFileDiff {
  const status: GitChangeStatus = payload.status === "A"
    ? "added"
    : payload.status === "D"
      ? "deleted"
      : payload.status === "R"
        ? "renamed"
        : "modified";
  const path = payload.path || requestedPath;
  const oldPath = payload.oldPath ?? requestedOldPath;

  return {
    change: {
      isStaged: false,
      isUnversioned: false,
      oldPath,
      oldRelativePath: oldPath,
      path,
      relativePath: path,
      status,
    },
    language: payload.language,
    modifiedContent: payload.modifiedContent,
    originalContent: payload.originalContent,
  };
}

function requestIsCurrent(
  tokens: ReadonlyMap<string, symbol>,
  currentOwner: string | null,
  documentPath: string,
  requestToken: symbol,
  requestedOwner: string,
): boolean {
  return currentOwner === requestedOwner &&
    tokens.get(documentPath) === requestToken;
}

function updateHistoryDocument(
  current: GitHistoryDiffDocumentStore,
  ownerKey: string,
  documentPath: string,
  document: GitHistoryDiffDocumentState,
): GitHistoryDiffDocumentStore {
  if (current.ownerKey !== ownerKey || !current.documents[documentPath]) {
    return current;
  }

  return {
    ...current,
    documents: {
      ...current.documents,
      [documentPath]: document,
    },
  };
}

function fileNameForPath(path: string): string {
  const normalizedPath = path.replace(/\\/g, "/");
  const parts = normalizedPath.split("/").filter(Boolean);

  return parts[parts.length - 1] ?? normalizedPath;
}
