import type { LineDiffResult } from "../domain/diffView/lineDiff";

export interface DiffViewComputationInput {
  readonly original: string;
  readonly modified: string;
  readonly ignoreWhitespace: boolean;
}

export interface DiffViewWorkerRequest extends DiffViewComputationInput {
  readonly requestId: number;
}

export interface DiffViewWorkerResponse {
  readonly requestId: number;
  readonly result: LineDiffResult;
}

export interface DiffViewComputationGateway {
  compute(input: DiffViewComputationInput, signal: AbortSignal): Promise<LineDiffResult>;
}
