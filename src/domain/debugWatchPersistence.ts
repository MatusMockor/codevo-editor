import { debugUtf8ByteLength } from "./debugEvaluationPolicy";
import {
  MAX_DEBUG_WATCH_EXPRESSIONS,
  createDebugWatchState,
  isDebugWatchDefinition,
  type DebugWatchDefinition,
} from "./debugWatchExpressions";
import { normalizedWorkspaceRootKey } from "./workspaceRootKey";
import {
  DEBUG_WATCH_STORAGE_VERSION,
  MAX_DEBUG_WATCH_STORAGE_BYTES,
  fitsDebugWatchV1PayloadBudget,
  serializeDebugWatchV1Payload,
} from "./debugWatchPayload";

export { DEBUG_WATCH_STORAGE_VERSION, MAX_DEBUG_WATCH_STORAGE_BYTES } from "./debugWatchPayload";

export interface DebugWatchStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

interface PersistedDebugWatchV1 {
  readonly version: 1;
  readonly definitions: readonly DebugWatchDefinition[];
}

const STORAGE_KEY_PREFIX = "mockor.debug.watch.";

export function debugWatchStorageKey(workspaceRoot: string): string {
  return `${STORAGE_KEY_PREFIX}${normalizedWorkspaceRootKey(workspaceRoot)}`;
}

export function deserializeDebugWatchDefinitions(raw: string): DebugWatchDefinition[] {
  if (debugUtf8ByteLength(raw) > MAX_DEBUG_WATCH_STORAGE_BYTES) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (isLegacyWatchList(value)) {
    const definitions = value.map((expression, index) => ({
      id: `watch-${index + 1}`,
      expression,
      enabled: true,
      revision: index + 1,
    }));
    return definitionsAreStrictlyValid(definitions) ? definitions : [];
  }
  if (!isExactV1(value) || !definitionsAreStrictlyValid(value.definitions)) return [];
  return value.definitions.map((definition) => ({ ...definition }));
}

export function serializeDebugWatchDefinitions(
  definitions: readonly DebugWatchDefinition[],
): string | null {
  if (!definitionsAreStrictlyValid(definitions)) return null;
  if (!fitsDebugWatchV1PayloadBudget(definitions)) return null;
  return serializeDebugWatchV1Payload(definitions);
}

export function loadPersistedDebugWatchDefinitions(
  storage: DebugWatchStorage,
  workspaceRoot: string,
): DebugWatchDefinition[] {
  try {
    const raw = storage.getItem(debugWatchStorageKey(workspaceRoot));
    return raw === null ? [] : deserializeDebugWatchDefinitions(raw);
  } catch {
    return [];
  }
}

export function savePersistedDebugWatchDefinitions(
  storage: DebugWatchStorage,
  workspaceRoot: string,
  definitions: readonly DebugWatchDefinition[],
): boolean {
  const key = debugWatchStorageKey(workspaceRoot);
  try {
    if (definitions.length === 0) {
      storage.removeItem(key);
      return true;
    }
    const serialized = serializeDebugWatchDefinitions(definitions);
    if (serialized === null) return false;
    storage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}

function definitionsAreStrictlyValid(
  definitions: readonly unknown[],
): definitions is DebugWatchDefinition[] {
  if (
    definitions.length > MAX_DEBUG_WATCH_EXPRESSIONS ||
    !definitions.every(isDebugWatchDefinition)
  ) {
    return false;
  }
  const state = createDebugWatchState(definitions);
  return state.definitions.length === definitions.length;
}

function isLegacyWatchList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((expression) => typeof expression === "string");
}

function isExactV1(value: unknown): value is PersistedDebugWatchV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return (
    keys.length === 2 &&
    Object.prototype.hasOwnProperty.call(record, "version") &&
    Object.prototype.hasOwnProperty.call(record, "definitions") &&
    record.version === DEBUG_WATCH_STORAGE_VERSION &&
    Array.isArray(record.definitions)
  );
}
