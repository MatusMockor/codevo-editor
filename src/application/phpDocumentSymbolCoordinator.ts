import type { LanguageServerDocumentSymbol } from "../domain/languageServerFeatures";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";

export interface PhpDocumentSymbolRequest {
  content: string;
  path: string;
  rootPath: string;
  runtimeIdentity: object;
  sessionId: number;
}

/** Shares only overlapping requests for the same exact PHP server snapshot. */
export class PhpDocumentSymbolCoordinator {
  private readonly inFlight = new Map<
    string,
    Promise<LanguageServerDocumentSymbol[]>
  >();
  private readonly runtimeIds = new WeakMap<object, number>();
  private nextRuntimeId = 1;

  coordinate(
    request: PhpDocumentSymbolRequest,
    load: () => Promise<LanguageServerDocumentSymbol[]>,
  ): Promise<LanguageServerDocumentSymbol[]> {
    const key = requestKey(request, this.runtimeId(request.runtimeIdentity));
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }

    const pending = Promise.resolve().then(load);
    this.inFlight.set(key, pending);
    void pending
      .finally(() => {
        if (this.inFlight.get(key) === pending) {
          this.inFlight.delete(key);
        }
      })
      .catch(() => undefined);
    return pending;
  }

  clear(): void {
    this.inFlight.clear();
  }

  private runtimeId(identity: object): number {
    const existing = this.runtimeIds.get(identity);
    if (existing) {
      return existing;
    }
    const id = this.nextRuntimeId++;
    this.runtimeIds.set(identity, id);
    return id;
  }
}

function requestKey(
  request: PhpDocumentSymbolRequest,
  runtimeId: number,
): string {
  return JSON.stringify([
    runtimeId,
    request.sessionId,
    normalizedWorkspaceRootKey(request.rootPath),
    request.path,
    request.content,
  ]);
}
