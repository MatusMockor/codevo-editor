const MAX_NATIVE_NODE_WATCH_SCRIPT_PATH_BYTES = 4 * 1024;

export interface NativeNodeWatchLaunchIntent {
  readonly kind: "native-node-watch";
  readonly scriptPath: string;
  readonly watch: true;
  readonly preserveOutput?: true;
}

export type CloneNativeNodeWatchLaunchIntentResult =
  | { readonly kind: "ok"; readonly intent: NativeNodeWatchLaunchIntent }
  | { readonly kind: "error"; readonly message: string };

/**
 * Revalidates and immutably clones the runtime-free native Node watch intent.
 *
 * Runtime discovery and executable ownership remain backend responsibilities.
 * This contract cannot carry an executable, shell, tool indirection, raw
 * arguments, environment variables, or a claimed Node version.
 */
export function cloneNativeNodeWatchLaunchIntent(
  value: unknown,
): CloneNativeNodeWatchLaunchIntentResult {
  if (
    !isExactRecord(value, ["kind", "scriptPath", "watch", "preserveOutput"]) ||
    value.kind !== "native-node-watch" ||
    value.watch !== true ||
    (value.preserveOutput !== undefined && value.preserveOutput !== true) ||
    !isNativeNodeWatchScriptPath(value.scriptPath)
  ) {
    return invalidIntent();
  }

  return {
    kind: "ok",
    intent: Object.freeze({
      kind: "native-node-watch",
      scriptPath: value.scriptPath,
      watch: true,
      ...(value.preserveOutput === true ? { preserveOutput: true as const } : {}),
    }),
  };
}

function isNativeNodeWatchScriptPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\0") &&
    utf8ByteLength(value) <= MAX_NATIVE_NODE_WATCH_SCRIPT_PATH_BYTES &&
    [".js", ".mjs", ".cjs"].some((extension) => value.endsWith(extension))
  );
}

function isExactRecord(
  value: unknown,
  allowedKeys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function invalidIntent(): CloneNativeNodeWatchLaunchIntentResult {
  return { kind: "error", message: "Invalid native Node watch launch intent." };
}
