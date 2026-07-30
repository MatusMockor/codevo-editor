import { invoke } from "@tauri-apps/api/core";
import type {
  ProjectSymbolSearchGateway,
  ProjectSymbolSearchResult,
} from "../domain/projectSymbols";

type InvokeCommand = typeof invoke;

const PROJECT_SYMBOL_SEARCH_CANCEL_COMMAND = "cancel_project_symbol_search";
const PROJECT_SYMBOL_SEARCH_BEGIN_COMMAND = "begin_project_symbol_search";
const PROJECT_SYMBOL_SEARCH_COMMAND = "search_project_symbols";
const allocateDefaultRequestId = createMonotonicProjectSymbolSearchRequestIdAllocator();

export function createMonotonicProjectSymbolSearchRequestIdAllocator(
  initialRequestId = 0,
): () => number {
  let requestId = initialRequestId;
  return () => {
    if (requestId >= Number.MAX_SAFE_INTEGER) {
      throw new Error("Project-symbol search request identifier space is exhausted.");
    }
    requestId += 1;
    return requestId;
  };
}

export class TauriProjectSymbolSearchGateway implements ProjectSymbolSearchGateway {
  private readonly allocateRequestId: () => number;

  constructor(
    private readonly invokeCommand: InvokeCommand = invoke,
    allocateRequestId: () => number = allocateDefaultRequestId,
    private readonly ownerId: string = globalThis.crypto.randomUUID(),
  ) {
    this.allocateRequestId = allocateRequestId;
  }

  searchProjectSymbols(
    root: string,
    query: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<ProjectSymbolSearchResult[]> {
    if (signal?.aborted) {
      return Promise.reject(abortError());
    }

    const requestId = this.allocateRequestId();
    let authority = {
      ownerId: this.ownerId,
      requestId,
      root,
    };
    const begin = this.invokeCommand<string>(PROJECT_SYMBOL_SEARCH_BEGIN_COMMAND, authority);
    if (!signal) {
      return begin.then((registeredRoot) => {
        authority = { ...authority, root: registeredRoot };
        return this.invokeCommand<ProjectSymbolSearchResult[]>(PROJECT_SYMBOL_SEARCH_COMMAND, {
          ...authority,
          query,
          limit,
        });
      });
    }

    let rejectAborted: ((reason: unknown) => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAborted = reject;
    });
    let registered = false;
    let cancelSent = false;
    const cancelRegisteredRequest = () => {
      if (!registered || cancelSent) return;
      cancelSent = true;
      void this.invokeCommand(PROJECT_SYMBOL_SEARCH_CANCEL_COMMAND, authority).catch(
        () => undefined,
      );
    };
    const cancel = () => {
      rejectAborted?.(abortError());
      cancelRegisteredRequest();
    };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) {
      cancel();
    }

    const request = begin.then((registeredRoot) => {
      authority = { ...authority, root: registeredRoot };
      registered = true;
      if (signal.aborted) {
        cancelRegisteredRequest();
        throw abortError();
      }
      return this.invokeCommand<ProjectSymbolSearchResult[]>(PROJECT_SYMBOL_SEARCH_COMMAND, {
        ...authority,
        query,
        limit,
      });
    });
    return Promise.race([request, aborted]).finally(() => {
      signal.removeEventListener("abort", cancel);
    });
  }
}

function abortError(): DOMException {
  return new DOMException("Project-symbol search was cancelled.", "AbortError");
}
