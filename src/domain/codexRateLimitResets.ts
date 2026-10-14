export interface CodexRateLimitResetHistoryEntry {
  readonly operationId: string;
  readonly usedAtEpochMs: number;
}

export interface CodexRateLimitResetDisplaySnapshot {
  readonly availableCount: number | null;
  readonly history: ReadonlyArray<CodexRateLimitResetHistoryEntry>;
  readonly historyTruncated: boolean;
}

export interface CodexRateLimitResetSnapshot extends CodexRateLimitResetDisplaySnapshot {
  readonly accountIdentity: string | null;
  readonly pendingOperationId: string | null;
}

export type CodexRateLimitResetOutcome =
  "reset" | "alreadyRedeemed" | "nothingToReset" | "noCredit";

export interface CodexRateLimitResetReadRequest {
  readonly providerGeneration: number;
}
export interface CodexRateLimitResetPrepareRequest extends CodexRateLimitResetReadRequest {
  readonly accountIdentity: string;
}
export interface CodexRateLimitResetConsumeRequest extends CodexRateLimitResetReadRequest {
  readonly confirmationToken: string;
  readonly idempotencyKey: string;
}

export const MAX_CODEX_RESET_HISTORY = 100;
export const CODEX_RESET_CONFIRMATION_TIMEOUT_MS = 60_000;

export function parseCodexRateLimitResetSnapshot(value: unknown): CodexRateLimitResetSnapshot {
  const item = record(value, [
    "accountIdentity",
    "availableCount",
    "history",
    "historyTruncated",
    "pendingOperationId",
  ]);
  if (item.availableCount !== null) integer(item.availableCount, 1_000_000);
  if (item.accountIdentity !== null) boundedText(item.accountIdentity, 1024);
  if (item.pendingOperationId !== null) boundedText(item.pendingOperationId, 256);
  if (typeof item.historyTruncated !== "boolean") invalid();
  if (!Array.isArray(item.history) || item.history.length > MAX_CODEX_RESET_HISTORY) invalid();
  const history = item.history.map((value) => {
    const entry = record(value, ["operationId", "usedAtEpochMs"]);
    return Object.freeze({
      operationId: boundedText(entry.operationId, 256),
      usedAtEpochMs: integer(entry.usedAtEpochMs, 8_640_000_000_000_000),
    });
  });
  if (new Set(history.map((entry) => entry.operationId)).size !== history.length) invalid();
  if (item.accountIdentity === null && (item.pendingOperationId !== null || history.length > 0))
    invalid();
  return Object.freeze({
    accountIdentity: item.accountIdentity as string | null,
    pendingOperationId: item.pendingOperationId as string | null,
    availableCount: item.availableCount as number | null,
    history: Object.freeze(history),
    historyTruncated: item.historyTruncated,
  });
}

export function parseCodexRateLimitResetReadRequest(
  value: unknown,
): CodexRateLimitResetReadRequest {
  const item = record(value, ["providerGeneration"]);
  return Object.freeze({ providerGeneration: integer(item.providerGeneration) });
}

export function parseCodexRateLimitResetPrepareRequest(
  value: unknown,
): CodexRateLimitResetPrepareRequest {
  const item = record(value, ["providerGeneration", "accountIdentity"]);
  return Object.freeze({
    providerGeneration: integer(item.providerGeneration),
    accountIdentity: boundedText(item.accountIdentity, 1024),
  });
}

export function parseCodexRateLimitResetConsumeRequest(
  value: unknown,
): CodexRateLimitResetConsumeRequest {
  const item = record(value, ["providerGeneration", "confirmationToken", "idempotencyKey"]);
  return Object.freeze({
    providerGeneration: integer(item.providerGeneration),
    confirmationToken: boundedText(item.confirmationToken, 256),
    idempotencyKey: boundedText(item.idempotencyKey, 256),
  });
}

export function parseCodexRateLimitResetPreparation(value: unknown): {
  readonly confirmationToken: string;
} {
  const item = record(value, ["confirmationToken"]);
  return Object.freeze({ confirmationToken: boundedText(item.confirmationToken, 256) });
}

export function parseCodexRateLimitResetReceipt(value: unknown): {
  readonly outcome: CodexRateLimitResetOutcome;
} {
  const item = record(value, ["outcome"]);
  switch (item.outcome) {
    case "reset":
    case "alreadyRedeemed":
    case "nothingToReset":
    case "noCredit":
      return Object.freeze({ outcome: item.outcome });
    default:
      return invalid();
  }
}

function record(value: unknown, keys: ReadonlyArray<string>): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  const item = value as Record<string, unknown>;
  const actual = Object.keys(item);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) invalid();
  return item;
}

function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max)
    invalid();
  return value;
}

function boundedText(value: unknown, maxBytes: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxBytes ||
    new TextEncoder().encode(value).length > maxBytes ||
    value.trim() !== value ||
    /\p{Cc}/u.test(value)
  )
    invalid();
  return value;
}

function invalid(): never {
  throw new TypeError("Invalid Codex limit reset contract.");
}
