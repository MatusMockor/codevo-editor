import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
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

export const MAX_RETAINED_GIT_HISTORY_DIFF_DOCUMENTS = 16;

export interface GitHistoryDiffDocumentState {
  diff: GitFileDiff | null;
  isLoading: boolean;
}

interface GitHistoryDiffDocumentStore {
  documents: Record<string, GitHistoryDiffDocumentState>;
  ownerKey: string | null;
  recency: readonly string[];
}

interface GitHistoryDiffRequestLease {
  ownerKey: string;
  token: symbol;
}

interface GitHistoryDiffReloadRecipe {
  commitHash: string;
  oldPath: string | null;
  ownerKey: string;
  path: string;
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
  reloadDocumentPath(documentPath: string): Promise<void>;
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
  const requestTokensRef = useRef(new Map<string, GitHistoryDiffRequestLease>());
  const reloadRecipesRef = useRef(new Map<string, GitHistoryDiffReloadRecipe>());
  const [store, setStore] = useState<GitHistoryDiffDocumentStore>(() => ({
    documents: {},
    ownerKey,
    recency: [],
  }));
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    const requestTokens = requestTokensRef.current;
    const reloadRecipes = reloadRecipesRef.current;
    if (storeRef.current.ownerKey !== ownerKey) {
      const next = emptyHistoryDocumentStore(ownerKey);
      storeRef.current = next;
      setStore(next);
    }

    removeForeignOwnerEntries(requestTokens, ownerKey);
    removeForeignOwnerEntries(reloadRecipes, ownerKey);
    return () => {
      removeOwnerEntries(requestTokens, ownerKey);
      removeOwnerEntries(reloadRecipes, ownerKey);
    };
  }, [ownerKey]);

  const documentsByPath = useMemo(
    () => store.ownerKey === ownerKey ? store.documents : {},
    [ownerKey, store],
  );

  const closeDocumentPaths = useCallback((paths: readonly string[]) => {
    const closeOwner = ownerKey;
    if (!closeOwner || ownerKeyRef.current !== closeOwner) {
      return;
    }

    const closedPaths = new Set(paths.filter(isGitHistoryDiffDocumentPath));
    if (closedPaths.size === 0) {
      return;
    }

    for (const path of closedPaths) {
      deleteOwnedEntry(requestTokensRef.current, path, closeOwner);
      deleteOwnedEntry(reloadRecipesRef.current, path, closeOwner);
    }

    const current = storeRef.current;
    if (current.ownerKey !== ownerKeyRef.current) {
      return;
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
      return;
    }

    publishHistoryDocumentStore(storeRef, setStore, {
      ...current,
      documents,
      recency: current.recency.filter((path) => !closedPaths.has(path)),
    });
  }, [ownerKey]);

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
      onOpenDocument(historyDiffDocument(documentPath, path));
      if (ownerKeyRef.current !== requestedOwner) {
        return;
      }

      const requestToken = Symbol(documentPath);
      requestTokensRef.current.set(documentPath, {
        ownerKey: requestedOwner,
        token: requestToken,
      });
      reloadRecipesRef.current.set(documentPath, {
        commitHash,
        oldPath,
        ownerKey: requestedOwner,
        path,
      });
      const insertion = insertHistoryDocument(storeRef.current, requestedOwner, documentPath, {
        diff: null,
        isLoading: true,
      });
      for (const evictedPath of insertion.evictedPaths) {
        deleteOwnedEntry(requestTokensRef.current, evictedPath, requestedOwner);
      }
      publishHistoryDocumentStore(storeRef, setStore, insertion.store);

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
        publishHistoryDocumentStore(
          storeRef,
          setStore,
          updateHistoryDocument(storeRef.current, requestedOwner, documentPath, {
            diff,
            isLoading: false,
          }),
        );
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
        publishHistoryDocumentStore(
          storeRef,
          setStore,
          updateHistoryDocument(storeRef.current, requestedOwner, documentPath, {
            diff: null,
            isLoading: false,
          }),
        );
      } finally {
        const lease = requestTokensRef.current.get(documentPath);
        if (lease?.ownerKey === requestedOwner && lease.token === requestToken) {
          requestTokensRef.current.delete(documentPath);
        }
      }
    },
    [gateway, onOpenDocument, ownerKey, workspaceRoot],
  );

  const reloadDocumentPath = useCallback(
    async (documentPath: string) => {
      const recipe = reloadRecipesRef.current.get(documentPath);
      if (!recipe || recipe.ownerKey !== ownerKeyRef.current) {
        return;
      }

      await openCommitDiff(recipe.commitHash, recipe.path, recipe.oldPath);
    },
    [openCommitDiff],
  );

  return {
    closeDocumentPaths,
    documentsByPath,
    openCommitDiff,
    reloadDocumentPath,
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
  tokens: ReadonlyMap<string, GitHistoryDiffRequestLease>,
  currentOwner: string | null,
  documentPath: string,
  requestToken: symbol,
  requestedOwner: string,
): boolean {
  const lease = tokens.get(documentPath);
  return currentOwner === requestedOwner &&
    lease?.ownerKey === requestedOwner && lease.token === requestToken;
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

function emptyHistoryDocumentStore(ownerKey: string | null): GitHistoryDiffDocumentStore {
  return { documents: {}, ownerKey, recency: [] };
}

function insertHistoryDocument(
  current: GitHistoryDiffDocumentStore,
  ownerKey: string,
  documentPath: string,
  document: GitHistoryDiffDocumentState,
): {
  evictedPaths: readonly string[];
  store: GitHistoryDiffDocumentStore;
} {
  const sameOwner = current.ownerKey === ownerKey;
  const documents = {
    ...(sameOwner ? current.documents : {}),
    [documentPath]: document,
  };
  let recency = [
    ...(sameOwner ? current.recency.filter((path) => path !== documentPath) : []),
    documentPath,
  ];
  const evictedPaths: string[] = [];

  while (recency.length > MAX_RETAINED_GIT_HISTORY_DIFF_DOCUMENTS) {
    const candidates = recency.filter((path) => path !== documentPath);
    // Keep the newly opened tab and in-flight work whenever a settled LRU
    // victim exists. If every older entry is loading, evict the oldest one to
    // preserve the hard bound and invalidate its token at the call site.
    const victim = candidates.find((path) => !documents[path]?.isLoading) ?? candidates[0];
    if (!victim) {
      break;
    }

    delete documents[victim];
    recency = recency.filter((path) => path !== victim);
    evictedPaths.push(victim);
  }

  return {
    evictedPaths,
    store: { documents, ownerKey, recency },
  };
}

function publishHistoryDocumentStore(
  storeRef: MutableRefObject<GitHistoryDiffDocumentStore>,
  setStore: Dispatch<SetStateAction<GitHistoryDiffDocumentStore>>,
  next: GitHistoryDiffDocumentStore,
): void {
  if (next === storeRef.current) {
    return;
  }

  storeRef.current = next;
  setStore(next);
}

function deleteOwnedEntry<T extends { ownerKey: string }>(
  entries: Map<string, T>,
  key: string,
  ownerKey: string,
): void {
  if (entries.get(key)?.ownerKey === ownerKey) {
    entries.delete(key);
  }
}

function removeOwnerEntries<T extends { ownerKey: string }>(
  entries: Map<string, T>,
  ownerKey: string | null,
): void {
  for (const [key, entry] of entries) {
    if (entry.ownerKey === ownerKey) {
      entries.delete(key);
    }
  }
}

function removeForeignOwnerEntries<T extends { ownerKey: string }>(
  entries: Map<string, T>,
  ownerKey: string | null,
): void {
  for (const [key, entry] of entries) {
    if (entry.ownerKey !== ownerKey) {
      entries.delete(key);
    }
  }
}

function fileNameForPath(path: string): string {
  const normalizedPath = path.replace(/\\/g, "/");
  const parts = normalizedPath.split("/").filter(Boolean);

  return parts[parts.length - 1] ?? normalizedPath;
}
