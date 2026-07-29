/// <reference lib="webworker" />

import type {
  EditorChangeHunksComputationRequest,
  EditorChangeHunksComputationResponse,
} from "../application/editorChangeHunksComputation";
import { editorChangeHunks } from "../domain/editorChangeMarkers";
import { isLargeSmartDocumentContent } from "../domain/largeDocumentPolicy";

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<EditorChangeHunksComputationRequest>) => {
  const request = event.data;
  const response: EditorChangeHunksComputationResponse =
    isLargeSmartDocumentContent(request.content, request.policy) ||
    isLargeSmartDocumentContent(request.baselineContent, request.policy)
      ? {
          generation: request.generation,
          hunks: [],
          ownerKey: request.ownerKey,
          path: request.path,
          reason: "large-file",
          status: "degraded",
        }
      : {
          generation: request.generation,
          hunks: editorChangeHunks(request.baselineContent, request.content),
          ownerKey: request.ownerKey,
          path: request.path,
          status: "ready",
        };
  workerScope.postMessage(response);
};

export {};
