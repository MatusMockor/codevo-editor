import type { DiffViewComputationGateway } from "../application/diffViewComputation";
import { computeLineDiff } from "../domain/diffView/lineDiff";

export const inlineDiffViewGateway: DiffViewComputationGateway = {
  compute(input, signal) {
    if (signal.aborted) {
      return Promise.reject(new DOMException("Diff calculation was cancelled.", "AbortError"));
    }
    return Promise.resolve(
      computeLineDiff(input.original, input.modified, { ignoreWhitespace: input.ignoreWhitespace }),
    );
  },
};
