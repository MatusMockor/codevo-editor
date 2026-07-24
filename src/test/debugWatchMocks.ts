import type { UseDebugWatchExpressionsResult } from "../application/useDebugWatchExpressions";

export function createEmptyDebugWatches(): UseDebugWatchExpressionsResult {
  return {
    definitions: [],
    evaluations: {},
    pendingIds: [],
    add: () => true,
    canAdd: () => true,
    clear: () => undefined,
    remove: () => undefined,
    setEnabled: () => undefined,
    update: () => undefined,
    invalidateEvaluations: () => undefined,
  };
}
