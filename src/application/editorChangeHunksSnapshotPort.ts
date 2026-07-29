import type { LiveDocumentAuthority } from "../domain/liveDocumentContentAuthority";
import type {
  CaptureLiveDocumentSnapshotReceipt,
  LiveDocumentSnapshot,
} from "./liveDocumentSnapshotBroker";
import type { LiveModelRevision, LiveModelSourceHandle } from "./liveModelIngressCoordinator";

/**
 * Exact saved-baseline authority supplied by the document-session owner.
 *
 * The model identity is deliberately absent: replacing a Monaco model must not
 * invalidate the saved baseline for the same exact document incarnation.
 */
export interface EditorChangeHunksBaseline {
  readonly authority: object;
  readonly canonicalRoot: LiveDocumentAuthority["canonicalRoot"];
  readonly content: string;
  readonly documentIdentityKey: LiveDocumentAuthority["documentIdentityKey"];
  readonly documentIncarnation: LiveDocumentAuthority["documentIncarnation"];
  readonly ownerGeneration: LiveDocumentAuthority["ownerGeneration"];
  readonly ownerIncarnation: LiveDocumentAuthority["ownerIncarnation"];
  readonly ownerKey: LiveDocumentAuthority["ownerKey"];
  readonly path: LiveDocumentAuthority["path"];
}

/**
 * Narrow application boundary for retaining a full-text snapshot by an exact
 * live-model handle. The implementation owns the private handle-to-reservation
 * mapping; React never receives a broker reservation or source registration.
 */
export interface EditorChangeHunksSnapshotPort {
  capture(handle: LiveModelSourceHandle, signal: AbortSignal): CaptureLiveDocumentSnapshotReceipt;
  consumeCurrent(handle: LiveModelSourceHandle, snapshot: LiveDocumentSnapshot): boolean;
  release(handle: LiveModelSourceHandle, snapshot: LiveDocumentSnapshot): boolean;
  subscribe(
    handle: LiveModelSourceHandle,
    listener: (revision: LiveModelRevision) => void,
  ): () => void;
}

/**
 * Closed application boundary for the two full-content purposes that may be
 * requested by an exact active editor binding. The purpose is selected by the
 * method, so callers cannot bypass purpose-specific broker limits.
 */
export interface EditorLiveDocumentContentAccessPort {
  captureForDirtySearch(
    handle: LiveModelSourceHandle,
    signal?: AbortSignal,
  ): CaptureLiveDocumentSnapshotReceipt;
  captureForSave(
    handle: LiveModelSourceHandle,
    signal?: AbortSignal,
  ): CaptureLiveDocumentSnapshotReceipt;
  consumeCurrent(handle: LiveModelSourceHandle, snapshot: LiveDocumentSnapshot): boolean;
  release(handle: LiveModelSourceHandle, snapshot: LiveDocumentSnapshot): boolean;
}

export function baselineMatchesLiveDocument(
  baseline: EditorChangeHunksBaseline,
  live: LiveDocumentAuthority,
): boolean {
  return (
    baseline.canonicalRoot === live.canonicalRoot &&
    baseline.documentIdentityKey === live.documentIdentityKey &&
    baseline.documentIncarnation === live.documentIncarnation &&
    baseline.ownerGeneration === live.ownerGeneration &&
    baseline.ownerIncarnation === live.ownerIncarnation &&
    baseline.ownerKey === live.ownerKey &&
    baseline.path === live.path
  );
}
