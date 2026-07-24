import { debugUtf8ByteLength } from "./debugEvaluationPolicy";

export const MAX_DEBUG_WATCH_STORAGE_BYTES = 64 * 1_024;
export const DEBUG_WATCH_STORAGE_VERSION = 1;

export interface SerializableDebugWatchDefinition {
  readonly id: string;
  readonly expression: string;
  readonly enabled: boolean;
  readonly revision: number;
}

/** Serializes the exact persisted V1 envelope used by watch storage. */
export function serializeDebugWatchV1Payload(
  definitions: readonly SerializableDebugWatchDefinition[],
): string {
  return JSON.stringify({ version: DEBUG_WATCH_STORAGE_VERSION, definitions });
}

export function fitsDebugWatchV1PayloadBudget(
  definitions: readonly SerializableDebugWatchDefinition[],
): boolean {
  return (
    debugUtf8ByteLength(serializeDebugWatchV1Payload(definitions)) <=
    MAX_DEBUG_WATCH_STORAGE_BYTES
  );
}
