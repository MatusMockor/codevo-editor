import {
  MAX_DEBUG_EVALUATION_EXPRESSION_BYTES,
  MAX_DEBUG_EVALUATION_VALUE_BYTES,
  debugUtf8ByteLength,
} from "../domain/debugEvaluationPolicy";

const MAX_DEBUG_COPY_VALUE_IDENTITY_BYTES = 1_024;
const MAX_DEBUG_COPY_VALUE_ROOT_BYTES = 4_096;

export type DebugCopyValueSource = "console" | "variables" | "watch";

/** Immutable focus/owner capture shared by Variables and Watch copy actions. */
export interface DebugCopyValueCandidate {
  readonly source: DebugCopyValueSource;
  readonly identity: string;
  readonly rootKey: string;
  readonly workspaceOwnerKey: string;
  readonly sessionId: number;
  readonly pauseGeneration: number;
  readonly frameId: number;
  readonly generation: number;
  readonly epoch: number;
  readonly evaluateName?: string;
  readonly adapterEvaluateName?: string;
  readonly displayedValue: string;
}

export interface DebugCopyValueCandidateReader {
  readDebugCopyValueCandidate(): unknown;
}

export function captureDebugCopyValueCandidate(
  reader: DebugCopyValueCandidateReader | null | undefined,
): DebugCopyValueCandidate | null {
  if (!reader) return null;
  try {
    const value = reader.readDebugCopyValueCandidate();
    if (!isRecord(value)) return null;
    const keys = Reflect.ownKeys(value);
    if (!hasCandidateKeys(keys)) return null;
    const hasEvaluateName = keys.includes("evaluateName");
    if (!hasEvaluateName && Reflect.has(value, "evaluateName")) return null;
    const hasAdapterEvaluateName = keys.includes("adapterEvaluateName");
    if (!hasAdapterEvaluateName && Reflect.has(value, "adapterEvaluateName")) return null;
    const evaluateName = hasEvaluateName ? value.evaluateName : undefined;
    const adapterEvaluateName = hasAdapterEvaluateName ? value.adapterEvaluateName : undefined;
    const snapshot = {
      source: value.source,
      identity: value.identity,
      rootKey: value.rootKey,
      workspaceOwnerKey: value.workspaceOwnerKey,
      sessionId: value.sessionId,
      pauseGeneration: value.pauseGeneration,
      frameId: value.frameId,
      generation: value.generation,
      epoch: value.epoch,
      ...(evaluateName === undefined ? {} : { evaluateName }),
      ...(adapterEvaluateName === undefined ? {} : { adapterEvaluateName }),
      displayedValue: value.displayedValue,
    };
    if (!hasCandidateShape(snapshot)) return null;
    return Object.freeze(snapshot) as unknown as DebugCopyValueCandidate;
  } catch {
    return null;
  }
}

export function debugCopyValueCandidatesEqual(
  left: DebugCopyValueCandidate,
  right: DebugCopyValueCandidate,
): boolean {
  return (
    left.source === right.source &&
    left.identity === right.identity &&
    left.rootKey === right.rootKey &&
    left.workspaceOwnerKey === right.workspaceOwnerKey &&
    left.sessionId === right.sessionId &&
    left.pauseGeneration === right.pauseGeneration &&
    left.frameId === right.frameId &&
    left.generation === right.generation &&
    left.epoch === right.epoch &&
    left.evaluateName === right.evaluateName &&
    left.adapterEvaluateName === right.adapterEvaluateName &&
    left.displayedValue === right.displayedValue
  );
}

export function debugCopyValueExpression(candidate: DebugCopyValueCandidate): string {
  return candidate.evaluateName ?? candidate.displayedValue;
}

function hasCandidateKeys(keys: readonly PropertyKey[]): boolean {
  const required = [
    "source",
    "identity",
    "rootKey",
    "workspaceOwnerKey",
    "sessionId",
    "pauseGeneration",
    "frameId",
    "generation",
    "epoch",
    "displayedValue",
  ];
  const allowed = [...required, "evaluateName", "adapterEvaluateName"];
  return (
    keys.every((key) => typeof key === "string" && allowed.includes(key)) &&
    required.every((key) => keys.includes(key))
  );
}

function hasCandidateShape(value: Record<string, unknown>): boolean {
  return (
    (value.source === "console" || value.source === "variables" || value.source === "watch") &&
    isBoundedCleanText(value.identity, MAX_DEBUG_COPY_VALUE_IDENTITY_BYTES) &&
    isBoundedCleanText(value.rootKey, MAX_DEBUG_COPY_VALUE_ROOT_BYTES) &&
    isBoundedCleanText(value.workspaceOwnerKey, MAX_DEBUG_COPY_VALUE_IDENTITY_BYTES) &&
    [value.sessionId, value.pauseGeneration, value.frameId, value.generation, value.epoch].every(
      isPositiveSafeInteger,
    ) &&
    typeof value.displayedValue === "string" &&
    debugUtf8ByteLength(value.displayedValue) <= MAX_DEBUG_EVALUATION_VALUE_BYTES &&
    (value.evaluateName === undefined ||
      (isBoundedCleanText(value.evaluateName, MAX_DEBUG_EVALUATION_EXPRESSION_BYTES) &&
        value.evaluateName.trim().length > 0)) &&
    (value.adapterEvaluateName === undefined ||
      (isBoundedCleanText(value.adapterEvaluateName, MAX_DEBUG_EVALUATION_EXPRESSION_BYTES) &&
        value.adapterEvaluateName.trim().length > 0))
  );
}

function isBoundedCleanText(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    debugUtf8ByteLength(value) <= maximumBytes &&
    !/\p{Cc}/u.test(value)
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
