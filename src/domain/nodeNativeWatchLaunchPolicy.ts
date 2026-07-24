const MAX_NATIVE_NODE_WATCH_SCRIPT_PATH_BYTES = 4 * 1024;

export type NativeNodeWatchRuntimeMajor = 22 | 24 | 26;
export type NativeNodeWatchRuntimeSupport = "supported" | "best-effort";

export interface NativeNodeWatchLaunchRecipe {
  readonly kind: "native-node-watch";
  readonly runtime: Readonly<{
    readonly kind: "managed-node";
    readonly major: NativeNodeWatchRuntimeMajor;
    readonly support: NativeNodeWatchRuntimeSupport;
  }>;
  readonly scriptPath: string;
  readonly watch: true;
  readonly preserveOutput?: true;
}

export type CloneNativeNodeWatchLaunchRecipeResult =
  | { readonly kind: "ok"; readonly recipe: NativeNodeWatchLaunchRecipe }
  | { readonly kind: "error"; readonly message: string };

/**
 * Validates and clones the closed semantic contract reserved for a future
 * native Node watch launcher.
 *
 * The future Rust mapping is deliberately fixed to the managed Node binary
 * with `--watch`, optional `--watch-preserve-output`, an editor-owned
 * loopback inspector flag, and the validated script path. Raw runtime
 * arguments, shells and tool indirection (npm, nodemon or tsx) are not part of
 * this contract. This type is intentionally not a `DebugLaunchTarget` and is
 * not reachable through the current picker or IPC gateway.
 */
export function cloneNativeNodeWatchLaunchRecipe(
  value: unknown,
): CloneNativeNodeWatchLaunchRecipeResult {
  if (
    !isExactRecord(value, ["kind", "runtime", "scriptPath", "watch", "preserveOutput"]) ||
    value.kind !== "native-node-watch" ||
    value.watch !== true ||
    (value.preserveOutput !== undefined && value.preserveOutput !== true)
  ) {
    return invalidRecipe();
  }
  if (
    !isExactRecord(value.runtime, ["kind", "major", "support"]) ||
    value.runtime.kind !== "managed-node" ||
    !isNativeNodeWatchRuntimeMajor(value.runtime.major)
  ) {
    return invalidRecipe();
  }
  const expectedSupport = nativeNodeWatchRuntimeSupport(value.runtime.major);
  if (value.runtime.support !== expectedSupport) {
    return invalidRecipe();
  }
  if (!isNativeNodeWatchScriptPath(value.scriptPath)) {
    return invalidRecipe();
  }

  const runtime = Object.freeze({
    kind: "managed-node" as const,
    major: value.runtime.major,
    support: expectedSupport,
  });
  const recipe: NativeNodeWatchLaunchRecipe =
    value.preserveOutput === true
      ? {
          kind: "native-node-watch",
          runtime,
          scriptPath: value.scriptPath,
          watch: true,
          preserveOutput: true,
        }
      : {
          kind: "native-node-watch",
          runtime,
          scriptPath: value.scriptPath,
          watch: true,
        };
  return { kind: "ok", recipe: Object.freeze(recipe) };
}

export function nativeNodeWatchRuntimeSupport(
  major: NativeNodeWatchRuntimeMajor,
): NativeNodeWatchRuntimeSupport {
  return major === 26 ? "best-effort" : "supported";
}

function isNativeNodeWatchRuntimeMajor(value: unknown): value is NativeNodeWatchRuntimeMajor {
  return value === 22 || value === 24 || value === 26;
}

function isNativeNodeWatchScriptPath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    utf8ByteLength(value) > MAX_NATIVE_NODE_WATCH_SCRIPT_PATH_BYTES
  ) {
    return false;
  }
  return value.endsWith(".js") || value.endsWith(".mjs") || value.endsWith(".cjs");
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

function invalidRecipe(): CloneNativeNodeWatchLaunchRecipeResult {
  return { kind: "error", message: "Invalid native Node watch launch recipe." };
}
