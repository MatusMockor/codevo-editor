import type {
  IdentifiedLanguageServerRequest,
  IdentifiedLanguageServerRequestsPort,
} from "../domain/languageServerFeatures";

export const DOCUMENT_SAVE_PARTICIPANT_TIMEOUT_MS = 2_500;
export const DOCUMENT_SAVE_PARTICIPANT_INTERRUPTED = Symbol("documentSaveParticipantInterrupted");

interface ActiveDocumentSaveParticipant {
  readonly generation: number;
  readonly interrupted: Promise<typeof DOCUMENT_SAVE_PARTICIPANT_INTERRUPTED>;
  cancelBackendRequest: (() => void) | null;
  interrupt: () => void;
  timeout: ReturnType<typeof setTimeout> | null;
}

export interface DocumentSaveParticipantLease {
  readonly generation: number;
  isCurrent(): boolean;
  observeBackendRequest<T>(
    rootPath: string,
    request: IdentifiedLanguageServerRequest<T>,
    cancelRequest: IdentifiedLanguageServerRequestsPort["cancelRequest"] | undefined,
  ): void;
  waitFor<T>(request: Promise<T>): Promise<T | typeof DOCUMENT_SAVE_PARTICIPANT_INTERRUPTED>;
  finish(): void;
}

export interface DocumentSaveParticipantRequestCoordinator {
  begin(isAuthorityCurrent: () => boolean): DocumentSaveParticipantLease;
  dispose(): void;
}

export const MAX_CONCURRENT_DOCUMENT_SAVE_PARTICIPANTS = 32;

export interface DocumentSaveParticipantRequestPool {
  begin(
    exactKey: string,
    replacementKey: string,
    isAuthorityCurrent: () => boolean,
  ): DocumentSaveParticipantLease;
  dispose(): void;
}

interface DocumentSaveParticipantPoolEntry {
  readonly coordinator: DocumentSaveParticipantRequestCoordinator;
  readonly exactKey: string;
  readonly replacementKey: string;
  readonly trackedPromises: Set<Promise<unknown>>;
  logicalFinished: boolean;
}

export function createDocumentSaveParticipantRequestPool(
  timeoutMs = DOCUMENT_SAVE_PARTICIPANT_TIMEOUT_MS,
  capacity = MAX_CONCURRENT_DOCUMENT_SAVE_PARTICIPANTS,
): DocumentSaveParticipantRequestPool {
  const entries = new Set<DocumentSaveParticipantPoolEntry>();
  const activeByReplacementKey = new Map<string, DocumentSaveParticipantPoolEntry>();
  const boundedCapacity =
    Number.isSafeInteger(capacity) && capacity > 0
      ? Math.min(capacity, MAX_CONCURRENT_DOCUMENT_SAVE_PARTICIPANTS)
      : 1;
  let disposed = false;

  const releaseIfSettled = (entry: DocumentSaveParticipantPoolEntry) => {
    if (!entry.logicalFinished || entry.trackedPromises.size > 0) {
      return;
    }

    entries.delete(entry);
    if (activeByReplacementKey.get(entry.replacementKey) === entry) {
      activeByReplacementKey.delete(entry.replacementKey);
    }
  };

  return {
    begin(exactKey, replacementKey, isAuthorityCurrent) {
      if (disposed) {
        return interruptedLease();
      }

      const replaced = activeByReplacementKey.get(replacementKey);
      if (replaced) {
        replaced.coordinator.dispose();
        replaced.logicalFinished = true;
        activeByReplacementKey.delete(replacementKey);
        releaseIfSettled(replaced);
      }

      if (entries.size >= boundedCapacity) {
        return interruptedLease();
      }

      const entry: DocumentSaveParticipantPoolEntry = {
        coordinator: createDocumentSaveParticipantRequestCoordinator(timeoutMs),
        exactKey,
        logicalFinished: false,
        replacementKey,
        trackedPromises: new Set(),
      };
      entries.add(entry);
      activeByReplacementKey.set(replacementKey, entry);
      const lease = entry.coordinator.begin(isAuthorityCurrent);

      return {
        ...lease,
        finish() {
          lease.finish();
          entry.logicalFinished = true;
          releaseIfSettled(entry);
        },
        waitFor<T>(pendingRequest: Promise<T>) {
          if (!entry.trackedPromises.has(pendingRequest)) {
            entry.trackedPromises.add(pendingRequest);
            void pendingRequest.then(
              () => {
                entry.trackedPromises.delete(pendingRequest);
                releaseIfSettled(entry);
              },
              () => {
                entry.trackedPromises.delete(pendingRequest);
                releaseIfSettled(entry);
              },
            );
          }

          return lease.waitFor(pendingRequest);
        },
      };
    },
    dispose() {
      disposed = true;
      for (const entry of entries) {
        entry.coordinator.dispose();
      }
      activeByReplacementKey.clear();
      entries.clear();
    },
  };
}

export function createDocumentSaveParticipantRequestCoordinator(
  timeoutMs = DOCUMENT_SAVE_PARTICIPANT_TIMEOUT_MS,
): DocumentSaveParticipantRequestCoordinator {
  let active: ActiveDocumentSaveParticipant | null = null;
  let disposed = false;
  let nextGeneration = 0;

  const retire = (request: ActiveDocumentSaveParticipant | null) => {
    if (!request) {
      return;
    }

    request.interrupt();
    request.cancelBackendRequest?.();
    request.cancelBackendRequest = null;
    if (request.timeout) {
      clearTimeout(request.timeout);
      request.timeout = null;
    }
  };

  return {
    begin(isAuthorityCurrent) {
      retire(active);
      const generation = ++nextGeneration;
      let wasInterrupted = false;
      let resolveInterrupted:
        ((value: typeof DOCUMENT_SAVE_PARTICIPANT_INTERRUPTED) => void) | null = null;
      const interruptedPromise = new Promise<typeof DOCUMENT_SAVE_PARTICIPANT_INTERRUPTED>(
        (resolve) => {
          resolveInterrupted = resolve;
        },
      );
      const request: ActiveDocumentSaveParticipant = {
        cancelBackendRequest: null,
        generation,
        interrupt: () => {
          if (wasInterrupted) {
            return;
          }

          wasInterrupted = true;
          resolveInterrupted?.(DOCUMENT_SAVE_PARTICIPANT_INTERRUPTED);
        },
        interrupted: interruptedPromise,
        timeout: null,
      };
      request.timeout = setTimeout(() => retire(request), timeoutMs);
      active = request;

      const isCurrent = () =>
        !disposed &&
        !wasInterrupted &&
        active === request &&
        request.generation === generation &&
        isAuthorityCurrent();

      return {
        finish() {
          if (active !== request) {
            return;
          }

          active = null;
          if (request.timeout) {
            clearTimeout(request.timeout);
            request.timeout = null;
          }
          request.cancelBackendRequest = null;
        },
        generation,
        isCurrent,
        observeBackendRequest(rootPath, backendRequest, cancelRequest) {
          if (!cancelRequest) {
            return;
          }

          let cancellationIssued = false;
          const cancelOnce = () => {
            if (cancellationIssued) {
              return;
            }

            cancellationIssued = true;
            void cancelRequest(rootPath, backendRequest.sessionId, backendRequest.requestId).catch(
              () => undefined,
            );
          };

          if (!isCurrent()) {
            cancelOnce();
            return;
          }

          request.cancelBackendRequest = cancelOnce;
          void backendRequest.then(
            () => {
              if (request.cancelBackendRequest === cancelOnce) {
                request.cancelBackendRequest = null;
              }
            },
            () => {
              if (request.cancelBackendRequest === cancelOnce) {
                request.cancelBackendRequest = null;
              }
            },
          );
        },
        waitFor(pendingRequest) {
          if (!isCurrent()) {
            return Promise.resolve(DOCUMENT_SAVE_PARTICIPANT_INTERRUPTED);
          }

          return Promise.race([pendingRequest, request.interrupted]);
        },
      };
    },
    dispose() {
      disposed = true;
      retire(active);
      active = null;
    },
  };
}

function interruptedLease(): DocumentSaveParticipantLease {
  return {
    finish: () => undefined,
    generation: 0,
    isCurrent: () => false,
    observeBackendRequest: () => undefined,
    waitFor: () => Promise.resolve(DOCUMENT_SAVE_PARTICIPANT_INTERRUPTED),
  };
}
