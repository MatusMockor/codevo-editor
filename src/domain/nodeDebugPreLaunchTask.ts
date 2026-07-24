import { isNodeDebugTaskLabel, MAX_NODE_DEBUG_TASK_LABEL_BYTES } from "./nodeDebugTaskLabel";

export const MAX_NODE_DEBUG_PRE_LAUNCH_TASK_LABEL_BYTES = MAX_NODE_DEBUG_TASK_LABEL_BYTES;

export interface NodeDebugPreLaunchTask {
  /**
   * The exact task label parsed from launch configuration metadata.
   *
   * It is deliberately the only task field allowed to cross into the
   * application layer. Commands, arguments, cwd and environment stay owned by
   * the trusted process-task backend.
   */
  readonly label: string;
}

export type NodeDebugPreLaunchTaskValidationResult =
  | { readonly kind: "none" }
  | { readonly kind: "valid"; readonly task: NodeDebugPreLaunchTask }
  | { readonly kind: "invalid"; readonly message: string };

/** Validates optional, config-source-agnostic `preLaunchTask` metadata. */
export function validateNodeDebugPreLaunchTask(
  value: unknown,
): NodeDebugPreLaunchTaskValidationResult {
  if (value === undefined) return Object.freeze({ kind: "none" });
  if (!isNodeDebugTaskLabel(value)) {
    return Object.freeze({
      kind: "invalid",
      message: `preLaunchTask must be an exact display-safe task label of at most ${MAX_NODE_DEBUG_PRE_LAUNCH_TASK_LABEL_BYTES} UTF-8 bytes`,
    });
  }
  return Object.freeze({
    kind: "valid",
    task: Object.freeze({ label: value }),
  });
}
