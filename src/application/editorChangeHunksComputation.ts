import type { EditorChangeHunk } from "../domain/editorChangeMarkers";
import type { LargeSmartDocumentPolicy } from "../domain/largeDocumentPolicy";

export interface EditorChangeHunksComputationRequest {
  readonly baselineContent: string;
  readonly content: string;
  readonly generation: number;
  readonly ownerKey: string;
  readonly path: string;
  readonly policy: LargeSmartDocumentPolicy;
}

export type EditorChangeHunksComputationResponse =
  | {
      readonly generation: number;
      readonly hunks: readonly EditorChangeHunk[];
      readonly ownerKey: string;
      readonly path: string;
      readonly status: "ready";
    }
  | {
      readonly generation: number;
      readonly hunks: readonly [];
      readonly ownerKey: string;
      readonly path: string;
      readonly reason: "large-file";
      readonly status: "degraded";
    };

export interface EditorChangeHunksComputationGateway {
  compute(
    request: EditorChangeHunksComputationRequest,
    signal: AbortSignal,
  ): Promise<EditorChangeHunksComputationResponse>;
}
