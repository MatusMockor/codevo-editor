import type { UseDebugWatchExpressionsResult } from "../application/useDebugWatchExpressions";

export function createEmptyDebugWatches(): UseDebugWatchExpressionsResult {
  return {
    definitions: [],
    evaluations: {},
    pendingIds: [],
    refreshPending: false,
    canInvalidateEvaluations: () => false,
    add: () => true,
    canAdd: () => true,
    clear: () => undefined,
    remove: () => undefined,
    setEnabled: () => undefined,
    update: () => undefined,
    invalidateEvaluations: () => false,
  };
}
