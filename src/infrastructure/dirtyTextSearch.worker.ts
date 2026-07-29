/// <reference lib="webworker" />

import type {
  DirtyTextSearchComputationRequest,
  DirtyTextSearchComputationResponse,
} from "../application/dirtyTextSearchComputation";
import { computeDirtyTextSearch } from "../application/dirtyTextSearchMatcher";

const DIRTY_TEXT_SEARCH_COOPERATIVE_BUDGET_MS = 250;
const encoder = new TextEncoder();
const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<DirtyTextSearchComputationRequest>) => {
  const deadline = performance.now() + DIRTY_TEXT_SEARCH_COOPERATIVE_BUDGET_MS;
  const response: DirtyTextSearchComputationResponse = computeDirtyTextSearch(event.data, {
    hasTimeRemaining: () => performance.now() <= deadline,
    utf8ByteLength: (value) => encoder.encode(value).byteLength,
  });
  workerScope.postMessage(response);
};

export {};
