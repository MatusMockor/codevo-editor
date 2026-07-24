import { useRef, useSyncExternalStore } from "react";
import type { EditorDocument, WorkspaceFileRevision } from "../domain/workspace";
import type { PhpTestCoverageInvalidationStore } from "./phpTestCoverageInvalidationStore";

interface PhpCoverageInvalidationOptions {
  readonly documents: readonly EditorDocument[];
  readonly fileChangeStore: PhpTestCoverageInvalidationStore;
  readonly runRequestVersion: number;
}

interface DocumentSnapshot {
  readonly content: string;
  readonly revision: string;
}

/**
 * Produces one collision-free monotonic fence from disk changes, explicit test
 * requests and mutations of already-open PHP documents.
 */
export function usePhpCoverageInvalidationVersion({
  documents,
  fileChangeStore,
  runRequestVersion,
}: PhpCoverageInvalidationOptions): number {
  const fileChangeVersion = useSyncExternalStore(
    fileChangeStore.subscribe,
    fileChangeStore.getSnapshot,
    fileChangeStore.getSnapshot,
  );
  const openDocumentVersion = useOpenPhpDocumentCoverageVersion(documents);
  const state = useRef({
    fileChangeVersion,
    openDocumentVersion,
    runRequestVersion,
    version: 0,
  });
  if (
    state.current.fileChangeVersion !== fileChangeVersion ||
    state.current.openDocumentVersion !== openDocumentVersion ||
    state.current.runRequestVersion !== runRequestVersion
  ) {
    state.current = {
      fileChangeVersion,
      openDocumentVersion,
      runRequestVersion,
      version: state.current.version + 1,
    };
  }
  return state.current.version;
}

/**
 * Opening or closing a PHP document establishes or removes observation only.
 * Content or trusted disk-revision changes on an already observed path advance
 * the fence synchronously in the render that observes them.
 */
export function useOpenPhpDocumentCoverageVersion(documents: readonly EditorDocument[]): number {
  const state = useRef({
    snapshots: new Map<string, DocumentSnapshot>(),
    version: 0,
  });
  const next = new Map<string, DocumentSnapshot>();
  let changed = false;
  for (const document of documents) {
    if (document.language.toLowerCase() !== "php") continue;
    const snapshot = {
      content: document.content,
      revision: revisionIdentity(document.revision),
    };
    next.set(document.path, snapshot);
    const previous = state.current.snapshots.get(document.path);
    if (
      previous &&
      (previous.content !== snapshot.content || previous.revision !== snapshot.revision)
    ) {
      changed = true;
    }
  }
  state.current = {
    snapshots: next,
    version: state.current.version + (changed ? 1 : 0),
  };
  return state.current.version;
}

function revisionIdentity(revision: WorkspaceFileRevision | null | undefined): string {
  if (revision === undefined) return "undefined";
  if (revision === null) return "null";
  return JSON.stringify([
    revision.device,
    revision.inode,
    revision.size,
    revision.modifiedSeconds,
    revision.modifiedNanoseconds,
    revision.contentHash,
  ]);
}
