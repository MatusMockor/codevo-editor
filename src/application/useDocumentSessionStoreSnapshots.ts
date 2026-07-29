import { useCallback, useSyncExternalStore } from "react";
import {
  UNAVAILABLE_DOCUMENT_SESSION_DOCUMENT_SNAPSHOT,
  UNAVAILABLE_DOCUMENT_SESSION_OWNER_SNAPSHOT,
  type DocumentSessionDocumentLease,
  type DocumentSessionDocumentSnapshot,
  type DocumentSessionOwnerLease,
  type DocumentSessionOwnerSnapshot,
} from "../domain/documentSession";
import type { DocumentSessionStorePort } from "./documentSessionStorePort";

export function useDocumentSessionDocumentSnapshot(
  store: DocumentSessionStorePort,
  lease: DocumentSessionDocumentLease | null,
): DocumentSessionDocumentSnapshot {
  const subscribe = useCallback(
    (listener: () => void) => (lease ? store.subscribeDocument(lease, listener) : () => undefined),
    [lease, store],
  );
  const getSnapshot = useCallback(
    () =>
      lease ? store.getDocumentSnapshot(lease) : UNAVAILABLE_DOCUMENT_SESSION_DOCUMENT_SNAPSHOT,
    [lease, store],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useDocumentSessionOwnerSnapshot(
  store: DocumentSessionStorePort,
  lease: DocumentSessionOwnerLease | null,
): DocumentSessionOwnerSnapshot {
  const subscribe = useCallback(
    (listener: () => void) => (lease ? store.subscribeOwner(lease, listener) : () => undefined),
    [lease, store],
  );
  const getSnapshot = useCallback(
    () => (lease ? store.getOwnerSnapshot(lease) : UNAVAILABLE_DOCUMENT_SESSION_OWNER_SNAPSHOT),
    [lease, store],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
