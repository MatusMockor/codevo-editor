import type { TextSearchOptions, TextSearchResult } from "../domain/workspace";

export const DIRTY_TEXT_SEARCH_MAX_DOCUMENTS = 16;
export const DIRTY_TEXT_SEARCH_MAX_DIRTY_PATHS = 4_096;
export const DIRTY_TEXT_SEARCH_MAX_DOCUMENT_CODE_UNITS = 256 * 1024;
export const DIRTY_TEXT_SEARCH_MAX_AGGREGATE_CODE_UNITS = 1024 * 1024;
export const DIRTY_TEXT_SEARCH_MAX_DOCUMENT_BYTES = 768 * 1024;
export const DIRTY_TEXT_SEARCH_MAX_AGGREGATE_BYTES = 3 * 1024 * 1024;
export const DIRTY_TEXT_SEARCH_MAX_RESULTS = 500;
export const DIRTY_TEXT_SEARCH_PREVIEW_CODE_POINTS = 4_096;
export const DIRTY_TEXT_SEARCH_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export type DirtyTextSearchLimitation =
  | "aggregate-input-limit"
  | "dirty-path-limit"
  | "document-limit"
  | "document-too-large"
  | "response-limit"
  | "result-limit"
  | "time-limit"
  | "unsupported-file-mask"
  | "unsupported-query-semantics";

export interface DirtyTextSearchDocumentSnapshot {
  readonly content: string;
  readonly documentRevision: number;
  readonly path: string;
  readonly relativePath: string;
}

export interface DirtyTextSearchAuthority {
  readonly dirtySnapshotGeneration: number;
  readonly requestGeneration: string;
  readonly root: string;
  readonly searchGeneration: number;
  readonly workspaceOwnerKey: string;
}

export interface DirtyTextSearchComputationRequest {
  readonly authority: DirtyTextSearchAuthority;
  readonly dirtyPaths: readonly string[];
  readonly documents: readonly DirtyTextSearchDocumentSnapshot[];
  readonly limit: number;
  readonly options: TextSearchOptions;
  readonly preflightLimitations: readonly DirtyTextSearchLimitation[];
  readonly query: string;
}

export interface DirtyTextSearchComputationResponse {
  readonly authority: DirtyTextSearchAuthority;
  readonly dirtyPaths: readonly string[];
  readonly limitations: readonly DirtyTextSearchLimitation[];
  readonly results: readonly TextSearchResult[];
  readonly truncated: boolean;
}

export interface DirtyTextSearchComputationGateway {
  compute(
    request: DirtyTextSearchComputationRequest,
    signal: AbortSignal,
  ): Promise<DirtyTextSearchComputationResponse>;
}

export function dirtyTextSearchAuthorityEqual(
  left: DirtyTextSearchAuthority,
  right: DirtyTextSearchAuthority,
): boolean {
  return (
    left.dirtySnapshotGeneration === right.dirtySnapshotGeneration &&
    left.requestGeneration === right.requestGeneration &&
    left.root === right.root &&
    left.searchGeneration === right.searchGeneration &&
    left.workspaceOwnerKey === right.workspaceOwnerKey
  );
}
