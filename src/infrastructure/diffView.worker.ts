/// <reference lib="webworker" />

import type {
  DiffViewWorkerRequest,
  DiffViewWorkerResponse,
} from "../application/diffViewComputation";
import { computeLineDiff } from "../domain/diffView/lineDiff";

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<DiffViewWorkerRequest>) => {
  const request = event.data;
  const response: DiffViewWorkerResponse = {
    requestId: request.requestId,
    result: computeLineDiff(request.original, request.modified, {
      ignoreWhitespace: request.ignoreWhitespace,
    }),
  };
  workerScope.postMessage(response);
};

export {};
