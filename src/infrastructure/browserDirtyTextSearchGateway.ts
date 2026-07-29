import {
  DIRTY_TEXT_SEARCH_MAX_AGGREGATE_CODE_UNITS,
  DIRTY_TEXT_SEARCH_MAX_DIRTY_PATHS,
  DIRTY_TEXT_SEARCH_MAX_DOCUMENTS,
  DIRTY_TEXT_SEARCH_MAX_DOCUMENT_CODE_UNITS,
  DIRTY_TEXT_SEARCH_MAX_RESPONSE_BYTES,
  DIRTY_TEXT_SEARCH_MAX_RESULTS,
  DIRTY_TEXT_SEARCH_PREVIEW_CODE_POINTS,
  dirtyTextSearchAuthorityEqual,
  type DirtyTextSearchComputationGateway,
  type DirtyTextSearchLimitation,
  type DirtyTextSearchComputationRequest,
  type DirtyTextSearchComputationResponse,
} from "../application/dirtyTextSearchComputation";

export const DIRTY_TEXT_SEARCH_TIMEOUT_MS = 1_000;
const MAX_QUERY_CODE_UNITS = 64 * 1024;
const MAX_FILE_MASK_CODE_UNITS = 16 * 1024;
const MAX_PATH_CODE_UNITS = 4_096;
const MAX_AGGREGATE_PATH_CODE_UNITS = 256 * 1024;
const UTF8_ENCODER = new TextEncoder();
const LIMITATIONS = new Set<DirtyTextSearchLimitation>([
  "aggregate-input-limit",
  "dirty-path-limit",
  "document-limit",
  "document-too-large",
  "response-limit",
  "result-limit",
  "time-limit",
  "unsupported-file-mask",
  "unsupported-query-semantics",
]);

type DirtyTextSearchWorker = Pick<
  Worker,
  "onerror" | "onmessage" | "onmessageerror" | "postMessage" | "terminate"
>;
type DirtyTextSearchWorkerFactory = () => DirtyTextSearchWorker;

export class BrowserDirtyTextSearchGateway implements DirtyTextSearchComputationGateway {
  private activeCancel: (() => void) | null = null;
  private worker: DirtyTextSearchWorker | null = null;

  constructor(
    private readonly createWorker: DirtyTextSearchWorkerFactory = defaultWorkerFactory,
    private readonly timeoutMs = DIRTY_TEXT_SEARCH_TIMEOUT_MS,
  ) {}

  compute(
    request: DirtyTextSearchComputationRequest,
    signal: AbortSignal,
  ): Promise<DirtyTextSearchComputationResponse> {
    const requestError = validateRequest(request);
    if (requestError) {
      return Promise.reject(new Error(requestError));
    }
    if (signal.aborted) {
      return Promise.reject(abortError());
    }

    this.activeCancel?.();
    const worker = this.worker ?? this.createWorker();
    this.worker = worker;

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout: number | null = null;
      const settle = (
        outcome:
          | { readonly kind: "resolve"; readonly value: DirtyTextSearchComputationResponse }
          | { readonly kind: "reject"; readonly value: unknown },
        terminate: boolean,
      ) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout !== null) {
          window.clearTimeout(timeout);
        }
        signal.removeEventListener("abort", cancel);
        if (this.activeCancel === cancel) {
          this.activeCancel = null;
        }
        worker.onerror = null;
        worker.onmessage = null;
        worker.onmessageerror = null;
        if (terminate) {
          worker.terminate();
          if (this.worker === worker) {
            this.worker = null;
          }
        }
        if (outcome.kind === "resolve") {
          resolve(outcome.value);
        } else {
          reject(outcome.value);
        }
      };
      const cancel = () => settle({ kind: "reject", value: abortError() }, true);
      this.activeCancel = cancel;
      signal.addEventListener("abort", cancel, { once: true });
      timeout = window.setTimeout(
        () =>
          settle({ kind: "reject", value: new Error("Dirty-buffer text search timed out.") }, true),
        Math.max(1, this.timeoutMs),
      );
      worker.onerror = (event) =>
        settle(
          {
            kind: "reject",
            value: new Error(event.message || "Dirty-buffer text search worker failed."),
          },
          true,
        );
      worker.onmessageerror = () =>
        settle(
          {
            kind: "reject",
            value: new Error("Dirty-buffer text search returned an unreadable response."),
          },
          true,
        );
      worker.onmessage = (event: MessageEvent<DirtyTextSearchComputationResponse>) => {
        const response = event.data;
        if (
          !validResponse(response, request) ||
          !dirtyTextSearchAuthorityEqual(response.authority, request.authority)
        ) {
          settle(
            {
              kind: "reject",
              value: new Error("Dirty-buffer text search returned invalid authority or payload."),
            },
            true,
          );
          return;
        }
        settle({ kind: "resolve", value: response }, false);
      };

      try {
        worker.postMessage(request);
      } catch (error) {
        settle({ kind: "reject", value: error }, true);
      }
    });
  }
}

function validateRequest(request: DirtyTextSearchComputationRequest): string | null {
  if (
    !request.authority.workspaceOwnerKey ||
    !request.authority.root ||
    request.authority.workspaceOwnerKey.length > MAX_PATH_CODE_UNITS ||
    request.authority.root.length > MAX_PATH_CODE_UNITS ||
    !/^[\x21-\x7e]{1,128}$/.test(request.authority.requestGeneration) ||
    !Number.isSafeInteger(request.authority.searchGeneration) ||
    !Number.isSafeInteger(request.authority.dirtySnapshotGeneration) ||
    request.query.length > MAX_QUERY_CODE_UNITS ||
    request.options.fileMask.length > MAX_FILE_MASK_CODE_UNITS ||
    typeof request.options.caseSensitive !== "boolean" ||
    typeof request.options.isRegex !== "boolean" ||
    typeof request.options.preserveCase !== "boolean" ||
    typeof request.options.wholeWord !== "boolean" ||
    request.preflightLimitations.some((limitation) => !LIMITATIONS.has(limitation)) ||
    !Number.isSafeInteger(request.limit) ||
    request.limit < 1 ||
    request.limit > DIRTY_TEXT_SEARCH_MAX_RESULTS ||
    request.documents.length > DIRTY_TEXT_SEARCH_MAX_DOCUMENTS ||
    request.dirtyPaths.length > DIRTY_TEXT_SEARCH_MAX_DIRTY_PATHS
  ) {
    return "Dirty-buffer text search request is invalid or exceeds a hard limit.";
  }

  let aggregateCodeUnits = 0;
  let aggregatePathCodeUnits = 0;
  for (const path of request.dirtyPaths) {
    if (!path || path.length > MAX_PATH_CODE_UNITS) {
      return "Dirty-buffer text search request is invalid or exceeds a hard limit.";
    }
    aggregatePathCodeUnits += path.length;
    if (aggregatePathCodeUnits > MAX_AGGREGATE_PATH_CODE_UNITS) {
      return "Dirty-buffer text search request is invalid or exceeds a hard limit.";
    }
  }
  for (const document of request.documents) {
    if (
      !document.path ||
      !document.relativePath ||
      document.path.length > MAX_PATH_CODE_UNITS ||
      document.relativePath.length > MAX_PATH_CODE_UNITS ||
      !Number.isSafeInteger(document.documentRevision) ||
      document.documentRevision < 1 ||
      document.content.length > DIRTY_TEXT_SEARCH_MAX_DOCUMENT_CODE_UNITS
    ) {
      return "Dirty-buffer text search request is invalid or exceeds a hard limit.";
    }
    aggregateCodeUnits += document.content.length;
    if (aggregateCodeUnits > DIRTY_TEXT_SEARCH_MAX_AGGREGATE_CODE_UNITS) {
      return "Dirty-buffer text search request is invalid or exceeds a hard limit.";
    }
  }
  return null;
}

function validResponse(
  response: unknown,
  request: DirtyTextSearchComputationRequest,
): response is DirtyTextSearchComputationResponse {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return false;
  }
  if (!hasExactKeys(response, ["authority", "dirtyPaths", "limitations", "results", "truncated"])) {
    return false;
  }
  const candidate = response as DirtyTextSearchComputationResponse;
  if (
    !candidate.authority ||
    !hasExactKeys(candidate.authority, [
      "dirtySnapshotGeneration",
      "requestGeneration",
      "root",
      "searchGeneration",
      "workspaceOwnerKey",
    ]) ||
    typeof candidate.authority.workspaceOwnerKey !== "string" ||
    typeof candidate.authority.root !== "string" ||
    typeof candidate.authority.requestGeneration !== "string" ||
    !Number.isSafeInteger(candidate.authority.searchGeneration) ||
    !Number.isSafeInteger(candidate.authority.dirtySnapshotGeneration) ||
    !Array.isArray(candidate.dirtyPaths) ||
    !Array.isArray(candidate.limitations) ||
    !Array.isArray(candidate.results) ||
    typeof candidate.truncated !== "boolean" ||
    candidate.limitations.length > LIMITATIONS.size ||
    new Set(candidate.limitations).size !== candidate.limitations.length ||
    candidate.limitations.some((limitation) => !LIMITATIONS.has(limitation)) ||
    candidate.truncated !== candidate.limitations.length > 0 ||
    candidate.results.length > request.limit ||
    candidate.dirtyPaths.length !== request.dirtyPaths.length ||
    candidate.dirtyPaths.some((path, index) => path !== request.dirtyPaths[index])
  ) {
    return false;
  }
  const requestedDocuments = new Map(
    request.documents.map((document) => [document.path, document.relativePath]),
  );
  const validResults = candidate.results.every((result) => {
    if (
      hasExactKeys(result, [
        "column",
        "lineNumber",
        "lineText",
        "matchEnd",
        "matchStart",
        "matchTruncated",
        "path",
        "previewTruncated",
        "relativePath",
      ]) &&
      typeof result.path === "string" &&
      typeof result.relativePath === "string" &&
      requestedDocuments.get(result.path) === result.relativePath &&
      Number.isSafeInteger(result.lineNumber) &&
      result.lineNumber >= 1 &&
      result.lineNumber <= DIRTY_TEXT_SEARCH_MAX_DOCUMENT_CODE_UNITS + 1 &&
      Number.isSafeInteger(result.column) &&
      result.column >= 1 &&
      result.column <= DIRTY_TEXT_SEARCH_MAX_DOCUMENT_CODE_UNITS + 1 &&
      typeof result.lineText === "string" &&
      result.lineText.length <= DIRTY_TEXT_SEARCH_PREVIEW_CODE_POINTS * 2 &&
      Number.isSafeInteger(result.matchStart) &&
      Number.isSafeInteger(result.matchEnd) &&
      (result.matchStart ?? -1) >= 0 &&
      (result.matchEnd ?? -1) >= (result.matchStart ?? 0) &&
      typeof result.previewTruncated === "boolean" &&
      typeof result.matchTruncated === "boolean"
    ) {
      const previewCodePoints = Array.from(result.lineText).length;
      if (
        previewCodePoints > DIRTY_TEXT_SEARCH_PREVIEW_CODE_POINTS ||
        (result.matchEnd ?? Number.POSITIVE_INFINITY) > previewCodePoints ||
        (result.matchTruncated && !result.previewTruncated)
      ) {
        return false;
      }
      return true;
    }
    return false;
  });
  if (!validResults) {
    return false;
  }
  try {
    return (
      UTF8_ENCODER.encode(JSON.stringify(candidate)).byteLength <=
      DIRTY_TEXT_SEARCH_MAX_RESPONSE_BYTES
    );
  } catch {
    return false;
  }
}

function hasExactKeys(value: unknown, expected: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function defaultWorkerFactory(): DirtyTextSearchWorker {
  return new Worker(new URL("./dirtyTextSearch.worker.ts", import.meta.url), {
    type: "module",
  });
}

function abortError(): DOMException {
  return new DOMException("Dirty-buffer text search was cancelled.", "AbortError");
}
