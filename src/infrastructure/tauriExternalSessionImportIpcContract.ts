import { parseExternalAgentSessionHistory } from "../domain/externalAgentSession";
import type {
  ExternalSessionImportOwner,
  ExternalSessionImportProgress,
  ImportedSessionHistoryPage,
} from "../domain/externalSessionImport";
import { validateDeleteAgentThreadRequest } from "./tauriAgentThreadStoreIpcContract";

export function validateSessionImportOwner(
  request: ExternalSessionImportOwner,
): ExternalSessionImportOwner {
  return validateDeleteAgentThreadRequest(request);
}
export function parseSessionImportProgress(value: unknown): ExternalSessionImportProgress {
  const record = closed(value, ["complete", "importedCount", "truncated"]);
  return {
    complete: boolean(record.complete),
    importedCount: ordinal(record.importedCount),
    truncated: boolean(record.truncated),
  };
}
export function parseImportedHistoryPage(value: unknown): ImportedSessionHistoryPage {
  const record = closed(value, ["history", "hasEarlier", "beforeOrdinal", "complete"]);
  const hasEarlier = boolean(record.hasEarlier);
  const beforeOrdinal = record.beforeOrdinal === null ? null : ordinal(record.beforeOrdinal);
  if (hasEarlier !== (beforeOrdinal !== null))
    throw new TypeError("Invalid imported history continuation.");
  return {
    history: parseExternalAgentSessionHistory(record.history),
    hasEarlier,
    beforeOrdinal,
    complete: boolean(record.complete),
  };
}
export function ordinal(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError("Invalid imported history ordinal.");
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new TypeError("Invalid imported history flag.");
  return value;
}
function closed(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("Invalid imported history response.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record)))
    throw new TypeError("Invalid imported history fields.");
  return record;
}
