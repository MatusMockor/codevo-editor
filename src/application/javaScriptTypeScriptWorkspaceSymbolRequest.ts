import type {
  JavaScriptTypeScriptLanguageServerFeaturesGateway,
  LanguageServerWorkspaceSymbol,
} from "../domain/languageServerFeatures";
import {
  WORKSPACE_SYMBOL_REQUEST_TIMEOUT_MS,
  workspaceSymbolQueryFitsProjection,
  workspaceSymbolsFitProjection,
} from "../domain/workspaceSymbolProjection";

export { WORKSPACE_SYMBOL_REQUEST_TIMEOUT_MS } from "../domain/workspaceSymbolProjection";

export interface JavaScriptTypeScriptWorkspaceSymbolRequest {
  readonly cancelRequest: (rootPath: string, sessionId: number, requestId: number) => Promise<void>;
  readonly gateway: Pick<JavaScriptTypeScriptLanguageServerFeaturesGateway, "workspaceSymbols">;
  readonly isAuthorityCurrent: () => boolean;
  readonly query: string;
  readonly rootPath: string;
  readonly sessionId: number;
  readonly signal?: AbortSignal;
}

export async function requestJavaScriptTypeScriptWorkspaceSymbols({
  cancelRequest,
  gateway,
  isAuthorityCurrent,
  query,
  rootPath,
  sessionId,
  signal,
}: JavaScriptTypeScriptWorkspaceSymbolRequest): Promise<LanguageServerWorkspaceSymbol[]> {
  if (signal?.aborted || !isAuthorityCurrent() || !workspaceSymbolQueryFitsProjection(query)) {
    return [];
  }

  const request = gateway.workspaceSymbols(rootPath, query, sessionId);
  if (request.sessionId !== sessionId) {
    void request.catch(() => undefined);
    return [];
  }

  let cancelIssued = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const cancelPending = () => {
    if (cancelIssued) return;
    cancelIssued = true;
    void cancelRequest(rootPath, sessionId, request.requestId).catch(() => undefined);
  };
  const interrupted = new Promise<"aborted" | "timedOut">((resolve) => {
    timeout = setTimeout(() => resolve("timedOut"), WORKSPACE_SYMBOL_REQUEST_TIMEOUT_MS);
    abortListener = () => resolve("aborted");
    signal?.addEventListener("abort", abortListener, { once: true });
    if (signal?.aborted) resolve("aborted");
  });

  try {
    const result = await Promise.race([
      request.then(
        (symbols) => ({ kind: "resolved" as const, symbols }),
        (error: unknown) => ({ error, kind: "rejected" as const }),
      ),
      interrupted.then((kind) =>
        kind === "aborted" ? { kind: "aborted" as const } : { kind: "timedOut" as const },
      ),
    ]);
    if (result.kind === "aborted" || result.kind === "timedOut") {
      cancelPending();
      return [];
    }
    if (result.kind === "rejected") {
      if (signal?.aborted || !isAuthorityCurrent()) return [];
      throw result.error;
    }
    if (
      signal?.aborted ||
      !isAuthorityCurrent() ||
      !workspaceSymbolsFitProjection(result.symbols)
    ) {
      return [];
    }
    return result.symbols;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (abortListener) signal?.removeEventListener("abort", abortListener);
  }
}
