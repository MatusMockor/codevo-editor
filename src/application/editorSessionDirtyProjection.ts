import {
  type DocumentSessionDocumentLease,
  type DocumentSessionOwnerLease,
} from "../domain/documentSession";
import type { DocumentSessionStorePort } from "./documentSessionStorePort";

export type EditorDocumentDirtySnapshot =
  { readonly status: "unavailable" } | { readonly dirty: boolean; readonly status: "available" };

export type EditorOwnerDirtyCountSnapshot =
  | { readonly status: "unavailable" }
  | { readonly dirtyCount: number; readonly status: "available" };

export interface EditorDocumentDirtyProjection {
  readonly kind: "editor-document-dirty-projection";
}

export interface EditorOwnerDirtyCountProjection {
  readonly kind: "editor-owner-dirty-count-projection";
}

interface ProjectionCapabilities<Lease> {
  readonly lease: Lease;
  readonly store: DocumentSessionStorePort;
  subscriptions: number;
}

const MAX_PROJECTION_SUBSCRIPTIONS = 16;
const MAX_PROJECTED_DIRTY_COUNT = 256;
const UNAVAILABLE_DIRTY_SNAPSHOT: EditorDocumentDirtySnapshot = Object.freeze({
  status: "unavailable",
});
const CLEAN_SNAPSHOT: EditorDocumentDirtySnapshot = Object.freeze({
  dirty: false,
  status: "available",
});
const DIRTY_SNAPSHOT: EditorDocumentDirtySnapshot = Object.freeze({
  dirty: true,
  status: "available",
});
const UNAVAILABLE_DIRTY_COUNT_SNAPSHOT: EditorOwnerDirtyCountSnapshot = Object.freeze({
  status: "unavailable",
});
const DIRTY_COUNT_SNAPSHOTS: readonly EditorOwnerDirtyCountSnapshot[] = Object.freeze(
  Array.from({ length: MAX_PROJECTED_DIRTY_COUNT + 1 }, (_, dirtyCount) =>
    Object.freeze({ dirtyCount, status: "available" as const }),
  ),
);

const documentCapabilities = new WeakMap<
  EditorDocumentDirtyProjection,
  ProjectionCapabilities<DocumentSessionDocumentLease>
>();
const ownerCapabilities = new WeakMap<
  EditorOwnerDirtyCountProjection,
  ProjectionCapabilities<DocumentSessionOwnerLease>
>();

export function createEditorDocumentDirtyProjection(
  store: DocumentSessionStorePort,
  lease: DocumentSessionDocumentLease,
): EditorDocumentDirtyProjection {
  const projection = Object.freeze({
    kind: "editor-document-dirty-projection" as const,
  });
  documentCapabilities.set(projection, { lease, store, subscriptions: 0 });
  return projection;
}

export function createEditorOwnerDirtyCountProjection(
  store: DocumentSessionStorePort,
  lease: DocumentSessionOwnerLease,
): EditorOwnerDirtyCountProjection {
  const projection = Object.freeze({
    kind: "editor-owner-dirty-count-projection" as const,
  });
  ownerCapabilities.set(projection, { lease, store, subscriptions: 0 });
  return projection;
}

export function getEditorDocumentDirtySnapshot(
  projection: EditorDocumentDirtyProjection | null,
): EditorDocumentDirtySnapshot {
  const capabilities = projection ? documentCapabilities.get(projection) : null;
  if (!capabilities) {
    return UNAVAILABLE_DIRTY_SNAPSHOT;
  }
  const snapshot = capabilities.store.getDocumentSnapshot(capabilities.lease);
  return snapshot.status === "available"
    ? snapshot.dirty
      ? DIRTY_SNAPSHOT
      : CLEAN_SNAPSHOT
    : UNAVAILABLE_DIRTY_SNAPSHOT;
}

export function getEditorOwnerDirtyCountSnapshot(
  projection: EditorOwnerDirtyCountProjection | null,
): EditorOwnerDirtyCountSnapshot {
  const capabilities = projection ? ownerCapabilities.get(projection) : null;
  if (!capabilities) {
    return UNAVAILABLE_DIRTY_COUNT_SNAPSHOT;
  }
  const snapshot = capabilities.store.getOwnerSnapshot(capabilities.lease);
  if (snapshot.status !== "active") {
    return UNAVAILABLE_DIRTY_COUNT_SNAPSHOT;
  }
  return DIRTY_COUNT_SNAPSHOTS[snapshot.dirtyCount] ?? UNAVAILABLE_DIRTY_COUNT_SNAPSHOT;
}

export function subscribeEditorDocumentDirtyProjection(
  projection: EditorDocumentDirtyProjection | null,
  listener: () => void,
): () => void {
  const capabilities = projection ? documentCapabilities.get(projection) : null;
  return capabilities
    ? subscribeBounded(capabilities, listener, (lease, notify) =>
        capabilities.store.subscribeDocument(lease, notify),
      )
    : noop;
}

export function subscribeEditorOwnerDirtyCountProjection(
  projection: EditorOwnerDirtyCountProjection | null,
  listener: () => void,
): () => void {
  const capabilities = projection ? ownerCapabilities.get(projection) : null;
  return capabilities
    ? subscribeBounded(capabilities, listener, (lease, notify) =>
        capabilities.store.subscribeOwner(lease, notify),
      )
    : noop;
}

function subscribeBounded<Lease>(
  capabilities: ProjectionCapabilities<Lease>,
  listener: () => void,
  subscribe: (lease: Lease, listener: () => void) => () => void,
): () => void {
  if (
    typeof listener !== "function" ||
    capabilities.subscriptions >= MAX_PROJECTION_SUBSCRIPTIONS
  ) {
    return noop;
  }
  capabilities.subscriptions += 1;
  let active = true;
  let unsubscribe: () => void;
  try {
    unsubscribe = subscribe(capabilities.lease, listener);
  } catch {
    capabilities.subscriptions -= 1;
    return noop;
  }
  return () => {
    if (!active) {
      return;
    }
    active = false;
    capabilities.subscriptions -= 1;
    try {
      unsubscribe();
    } catch {
      // Subscription cleanup must remain idempotent and fail closed.
    }
  };
}

function noop(): void {}
