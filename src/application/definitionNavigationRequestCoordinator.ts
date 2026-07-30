import type { IdentifiedLanguageServerRequest } from "../domain/languageServerFeatures";

export const DEFINITION_NAVIGATION_REQUEST_TIMEOUT_MS = 2_500;
export const DEFINITION_NAVIGATION_REQUEST_INTERRUPTED = Symbol(
  "definitionNavigationRequestInterrupted",
);

type CancelRequest = (rootPath: string, sessionId: number, requestId: number) => Promise<void>;

interface ActiveDefinitionNavigationRequest {
  readonly generation: number;
  readonly interrupted: Promise<typeof DEFINITION_NAVIGATION_REQUEST_INTERRUPTED>;
  cancelBackendRequest: (() => void) | null;
  interrupt: () => void;
  timeout: ReturnType<typeof setTimeout> | null;
}

export interface DefinitionNavigationRequestLease {
  readonly generation: number;
  isCurrent(): boolean;
  isRequestCurrent(): boolean;
  observeBackendRequest<T>(
    rootPath: string,
    request: IdentifiedLanguageServerRequest<T>,
    cancelRequest: CancelRequest | undefined,
  ): void;
  waitFor<T>(request: Promise<T>): Promise<T | typeof DEFINITION_NAVIGATION_REQUEST_INTERRUPTED>;
  finish(): void;
}

export interface DefinitionNavigationRequestCoordinator {
  begin(isAuthorityCurrent: () => boolean): DefinitionNavigationRequestLease;
  dispose(): void;
}

export function createDefinitionNavigationRequestCoordinator(
  timeoutMs = DEFINITION_NAVIGATION_REQUEST_TIMEOUT_MS,
): DefinitionNavigationRequestCoordinator {
  let nextGeneration = 0;
  let active: ActiveDefinitionNavigationRequest | null = null;
  let disposed = false;

  const retire = (request: ActiveDefinitionNavigationRequest | null) => {
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
      let resolveInterrupted:
        ((value: typeof DEFINITION_NAVIGATION_REQUEST_INTERRUPTED) => void) | null = null;
      let interrupted = false;
      const interruptedPromise = new Promise<typeof DEFINITION_NAVIGATION_REQUEST_INTERRUPTED>(
        (resolve) => {
          resolveInterrupted = resolve;
        },
      );
      const request: ActiveDefinitionNavigationRequest = {
        cancelBackendRequest: null,
        generation,
        interrupt: () => {
          if (interrupted) {
            return;
          }

          interrupted = true;
          resolveInterrupted?.(DEFINITION_NAVIGATION_REQUEST_INTERRUPTED);
        },
        interrupted: interruptedPromise,
        timeout: null,
      };
      request.timeout = setTimeout(() => retire(request), timeoutMs);
      active = request;

      const isRequestCurrent = () =>
        !disposed && !interrupted && active === request && request.generation === generation;
      const isCurrent = () => isRequestCurrent() && isAuthorityCurrent();

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
        isRequestCurrent,
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
            return Promise.resolve(DEFINITION_NAVIGATION_REQUEST_INTERRUPTED);
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
