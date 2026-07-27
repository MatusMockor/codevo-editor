export const MAX_DEBUG_EVALUATION_EXPRESSION_BYTES = 4 * 1_024;
export const MAX_DEBUG_EVALUATION_VALUE_BYTES = 64 * 1_024;
export const MAX_DEBUG_EVALUATION_TYPE_BYTES = 256;
export const MAX_DEBUG_EVALUATION_ERROR_BYTES = 4 * 1_024;

export type DebugEvaluationContext = "clipboard" | "repl" | "watch";
export type DebugEvaluationErrorKind = "exception" | "side-effect" | "unsupported";

export interface DebugEvaluationPolicy {
  readonly context: DebugEvaluationContext;
  readonly allowSideEffects: boolean;
}

export interface DebugEvaluationOwner {
  readonly sessionId: number;
  readonly pauseGeneration: number;
}

export interface DebugEvaluationSuccess {
  readonly status: "ok";
  readonly value: string;
  readonly type?: string | null;
  readonly evaluateName?: string;
  readonly variablesReference?: number;
  /** Opaque, pause-owned adapter authority for DAP setExpression. */
  readonly setExpressionReference?: number;
}

export type DebugEvaluationResult =
  | DebugEvaluationSuccess
  | {
      readonly status: "error";
      readonly kind: DebugEvaluationErrorKind;
      readonly message: string;
    };

export type DebugExpressionValidation =
  | { readonly ok: true; readonly expression: string }
  | { readonly ok: false; readonly reason: "empty" | "control" | "too-large" | "type" };

export const DEBUG_REPL_EVALUATION_POLICY: DebugEvaluationPolicy = {
  context: "repl",
  allowSideEffects: true,
};

export const DEBUG_CLIPBOARD_EVALUATION_POLICY: DebugEvaluationPolicy = {
  context: "clipboard",
  allowSideEffects: true,
};

export const DEBUG_WATCH_EVALUATION_POLICY: DebugEvaluationPolicy = {
  context: "watch",
  allowSideEffects: false,
};

export function validateDebugExpression(value: unknown): DebugExpressionValidation {
  if (typeof value !== "string") return { ok: false, reason: "type" };
  if (!value.trim()) return { ok: false, reason: "empty" };
  if ([...value].some((character) => character !== "\t" && /\p{Cc}/u.test(character))) {
    return { ok: false, reason: "control" };
  }
  if (debugUtf8ByteLength(value) > MAX_DEBUG_EVALUATION_EXPRESSION_BYTES) {
    return { ok: false, reason: "too-large" };
  }
  return { ok: true, expression: value };
}

export function isBoundedDebugEvaluateName(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    debugUtf8ByteLength(value) > MAX_DEBUG_EVALUATION_EXPRESSION_BYTES
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\t" || character === "\n") continue;
    if (character === "\r" && value[index + 1] === "\n") continue;
    if (/\p{Cc}/u.test(character)) return false;
  }
  return true;
}

export function isDebugEvaluationOwner(value: unknown): value is DebugEvaluationOwner {
  if (!isRecord(value) || !hasExactKeys(value, ["sessionId", "pauseGeneration"])) return false;
  return isPositiveSafeInteger(value.sessionId) && isPositiveSafeInteger(value.pauseGeneration);
}

export function debugEvaluationOwnersEqual(
  left: DebugEvaluationOwner | null,
  right: DebugEvaluationOwner | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.sessionId === right.sessionId &&
      left.pauseGeneration === right.pauseGeneration)
  );
}

export function isDebugEvaluationPolicy(value: unknown): value is DebugEvaluationPolicy {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["context", "allowSideEffects"]) &&
    ((value.context === "clipboard" && value.allowSideEffects === true) ||
      (value.context === "repl" && value.allowSideEffects === true) ||
      (value.context === "watch" && value.allowSideEffects === false))
  );
}

export function debugEvaluationPolicyForContext(
  context: DebugEvaluationContext,
): DebugEvaluationPolicy {
  if (context === "clipboard") return DEBUG_CLIPBOARD_EVALUATION_POLICY;
  return context === "repl" ? DEBUG_REPL_EVALUATION_POLICY : DEBUG_WATCH_EVALUATION_POLICY;
}

export function debugUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}
