import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";

export interface LocalPhpValidationRequest {
  consumerId: string;
  content: string;
  documentPath: string;
  modelUri: string;
  version: number;
  workspaceRoot: string;
}

export interface LocalPhpValidationComputation<TImmediate, TResult> {
  immediate: TImmediate;
  result: Promise<TResult>;
}

export interface CoordinatedLocalPhpValidation<TImmediate, TResult> {
  immediate: TImmediate;
  result: Promise<TResult | null>;
}

interface ValidationEntry<TImmediate, TResult> {
  immediate: TImmediate;
  result: Promise<TResult>;
}

export class LocalPhpValidationCoordinator<TImmediate, TResult> {
  private generation = 0;
  private readonly entries = new Map<
    string,
    ValidationEntry<TImmediate, TResult>
  >();
  private readonly latestKeyByConsumer = new Map<string, string>();
  private readonly latestKeyByDocument = new Map<string, string>();

  get size(): number {
    return this.entries.size;
  }

  coordinate(
    request: LocalPhpValidationRequest,
    compute: () => LocalPhpValidationComputation<TImmediate, TResult>,
  ): CoordinatedLocalPhpValidation<TImmediate, TResult> {
    const documentKey = validationDocumentKey(request);
    const key = validationSnapshotKey(request, documentKey);
    const previousDocumentKey = this.latestKeyByDocument.get(documentKey);

    const previousConsumerKey = this.latestKeyByConsumer.get(
      request.consumerId,
    );
    this.latestKeyByConsumer.set(request.consumerId, key);
    this.latestKeyByDocument.set(documentKey, key);

    let entry = this.entries.get(key);
    if (!entry) {
      const computation = compute();
      entry = {
        immediate: computation.immediate,
        result: computation.result.catch((error) => {
          if (this.entries.get(key)?.result === entry?.result) {
            this.entries.delete(key);
          }
          throw error;
        }),
      };
      this.entries.set(key, entry);
    }

    if (previousDocumentKey && previousDocumentKey !== key) {
      this.entries.delete(previousDocumentKey);
    }
    if (previousConsumerKey && previousConsumerKey !== key) {
      this.pruneUnretainedEntry(previousConsumerKey);
    }

    const generation = this.generation;
    return {
      immediate: entry.immediate,
      result: entry.result.then((result) => {
        if (generation !== this.generation) {
          return null;
        }
        if (this.latestKeyByConsumer.get(request.consumerId) !== key) {
          return null;
        }
        if (this.latestKeyByDocument.get(documentKey) !== key) {
          return null;
        }

        return result;
      }),
    };
  }

  releaseConsumer(consumerId: string): void {
    const key = this.latestKeyByConsumer.get(consumerId);
    if (!key) {
      return;
    }

    this.latestKeyByConsumer.delete(consumerId);
    this.pruneUnretainedEntry(key);
  }

  dispose(): void {
    this.generation += 1;
    this.entries.clear();
    this.latestKeyByConsumer.clear();
    this.latestKeyByDocument.clear();
  }

  private pruneUnretainedEntry(key: string): void {
    for (const retainedKey of this.latestKeyByConsumer.values()) {
      if (retainedKey === key) {
        return;
      }
    }

    this.entries.delete(key);
    for (const [documentKey, latestKey] of this.latestKeyByDocument) {
      if (latestKey === key) {
        this.latestKeyByDocument.delete(documentKey);
      }
    }
  }
}

function validationDocumentKey(request: LocalPhpValidationRequest): string {
  return [
    normalizedWorkspaceRootKey(request.workspaceRoot),
    request.documentPath,
    request.modelUri,
  ].join("\0");
}

function validationSnapshotKey(
  request: LocalPhpValidationRequest,
  documentKey: string,
): string {
  return [documentKey, request.version, request.content].join("\0");
}
