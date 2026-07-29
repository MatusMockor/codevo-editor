export type LiveDocumentSnapshotSourceProbe =
  | {
      readonly status: "unavailable";
    }
  | {
      readonly alternativeVersionId: number;
      readonly modelVersionId: number;
      readonly status: "available";
      readonly utf16Length: number;
    };

export interface LiveDocumentSnapshotReadExpectation {
  readonly alternativeVersionId: number;
  readonly maxUtf16Units: number;
  readonly modelAuthority: object;
  readonly modelVersionId: number;
  readonly sourceAuthority: object;
  readonly utf16Length: number;
}

export interface LiveDocumentSnapshotSourceRead {
  readonly alternativeVersionId: number;
  readonly modelAuthority: object;
  readonly modelVersionId: number;
  readonly sourceAuthority: object;
  readonly text: string;
  readonly utf16Length: number;
}

/**
 * Infrastructure-owned exact model adapter. `probe` must be allocation-light;
 * `readFullText` is the only operation allowed to materialize the whole model.
 * Its adapter must capture the text and version metadata in one synchronous
 * model callback, rather than reading text and versions in separate turns.
 *
 * Both operations return an atomic snapshot of the source at the instant of
 * the call. Every source mutation must synchronously advance its model
 * authority/version metadata and pass through the canonical live-content
 * coordinator ingress before the mutation returns. Implementations must never
 * knowingly return stale probe or read metadata.
 */
export interface LiveDocumentSnapshotSourcePort {
  readonly modelAuthority: object;
  readonly sourceAuthority: object;
  probe(): LiveDocumentSnapshotSourceProbe;
  readFullText(expectation: LiveDocumentSnapshotReadExpectation): LiveDocumentSnapshotSourceRead;
}
