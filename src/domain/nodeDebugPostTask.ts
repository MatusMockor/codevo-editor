import { isNodeDebugTaskLabel, MAX_NODE_DEBUG_TASK_LABEL_BYTES } from "./nodeDebugTaskLabel";

export const MAX_NODE_DEBUG_POST_TASK_LABEL_BYTES = MAX_NODE_DEBUG_TASK_LABEL_BYTES;

export interface NodeDebugPostTask {
  /**
   * Exact imported task label. Executable task details remain owned by the
   * configured Tasks lifecycle and never enter debug IPC.
   */
  readonly label: string;
}

export type NodeDebugPostTaskValidationResult =
  | { readonly kind: "none" }
  | { readonly kind: "valid"; readonly task: NodeDebugPostTask }
  | { readonly kind: "invalid"; readonly message: string };

export function validateNodeDebugPostTask(value: unknown): NodeDebugPostTaskValidationResult {
  if (value === undefined) return Object.freeze({ kind: "none" });
  if (!isNodeDebugTaskLabel(value)) {
    return Object.freeze({
      kind: "invalid",
      message: `postDebugTask must be an exact display-safe task label of at most ${MAX_NODE_DEBUG_POST_TASK_LABEL_BYTES} UTF-8 bytes`,
    });
  }
  return Object.freeze({
    kind: "valid",
    task: Object.freeze({ label: value }),
  });
}
