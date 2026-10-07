import { isTransientRunnerBusyError } from "./agentAttachmentReadLimiter";

/** Shared admission matches the backend across readers, workspaces, summaries and file diffs. */
const MAX_READS = 4;
const MAX_QUEUED_READS = 1024;
export const TURN_READ_CANCELLED = "Recorded changes owner is no longer available.";
export const TURN_READ_BUSY = "Too many turn changes reads. Try again shortly.";
const QUEUE_FULL = "Recorded changes loading queue is full. Try again shortly.";
const isBusyRead = (error: unknown) =>
  errorText(error) === TURN_READ_BUSY || isTransientRunnerBusyError(error);
type ReadJob = {
  readonly owner: object;
  readonly start: () => Promise<void>;
  readonly cancel: () => void;
};
let active = 0;
const queued: ReadJob[] = [];
function pump() {
  while (active < MAX_READS && queued.length > 0) {
    const job = queued.shift()!;
    active += 1;
    void Promise.resolve()
      .then(job.start)
      .finally(() => {
        active -= 1;
        pump();
      });
  }
}
export function cancelTurnChangesReads(owner: object) {
  for (let i = queued.length - 1; i >= 0; i -= 1) {
    if (queued[i].owner === owner) queued.splice(i, 1)[0].cancel();
  }
}
export function queueTurnChangesRead<T>(
  owner: object,
  current: () => boolean,
  read: () => Promise<T>,
): Promise<T> {
  if (queued.length >= MAX_QUEUED_READS) return Promise.reject(new Error(QUEUE_FULL));
  return new Promise<T>((resolve, reject) => {
    queued.push({
      owner,
      cancel: () => reject(new Error(TURN_READ_CANCELLED)),
      start: async () => {
        try {
          for (let attempt = 0; ; attempt += 1) {
            if (!current()) throw new Error(TURN_READ_CANCELLED);
            try {
              const result = await read();
              if (!current()) throw new Error(TURN_READ_CANCELLED);
              resolve(result);
              return;
            } catch (error) {
              if (!current()) throw new Error(TURN_READ_CANCELLED);
              if (!isBusyRead(error) || attempt >= 2) throw error;
              await new Promise<void>((done) => setTimeout(done, 50 * (attempt + 1)));
            }
          }
        } catch (error) {
          reject(error);
        }
      },
    });
    pump();
  });
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "";
}
const READ_FAILED = "Recorded changes could not be loaded.";
const SERVER_READ_FAILED =
  "Server changes could not be loaded. Check the connection and try again.";
const SERVER_IDENTITY_CHANGED = "The server identity changed. Reconnect to load recorded changes.";
const SERVER_REJECTED = "The server rejected this recorded changes request.";
const SERVER_OUTDATED =
  "The server runner cannot provide recorded changes. Update the runner on the server.";
const SERVER_CONNECTION_FAILED =
  "The server connection could not be established. Check the server connection settings and reconnect.";
const TURN_GONE = "Recorded changes for this turn are no longer available on the server.";
const SERVER_READ_ERRORS: ReadonlySet<string> = new Set([
  "Server is not connected",
  "Runner connection is closed. Reconnect the server.",
  "Runner request timed out. Its outcome may be unknown.",
  "Runner connection unavailable.",
  "Runner connection was superseded.",
  "Runner connection was canceled.",
  "Server connection changed during request",
  "Runner connection changed during request.",
  "Runner connection failed. The request outcome may be unknown.",
  "Runner connections are shutting down",
  "Runner operation failed",
  "Server registry unavailable",
  "Unable to read runner response.",
  "Unable to create private runner connection.",
  "Unable to open SSH handshake.",
  "Unable to configure SSH handshake.",
  "Unable to configure runner HTTP connection.",
]);
const SERVER_CONNECTION_ERRORS: ReadonlySet<string> = new Set([
  "Invalid SSH host or username.",
  "Unable to start SSH tunnel.",
  "SSH tunnel connection failed. Check SSH access and runner authentication.",
  "SSH tunnel authentication failed.",
  "Invalid runner authentication.",
]);
const HTTP_STATUS = /^Runner request failed \(HTTP (\d{3})\)\.$/u;
const OUTDATED_RUNNER_MESSAGE =
  "The server runner rejected this request as invalid (HTTP 400). If it is older than this editor, update the runner on the server.";
const INVALID_RESPONSE = "The saved changes response is invalid and cannot be displayed.";
function classifyHttpStatus(message: string): TurnChangesReadFailure | null {
  const status = Number(HTTP_STATUS.exec(message)?.[1]);
  if (!Number.isInteger(status)) return null;
  if (status >= 500 || status === 408 || status === 429)
    return { kind: "retryable", reason: SERVER_READ_FAILED };
  if (status === 404) return { kind: "final", reason: TURN_GONE };
  if (status === 400) return { kind: "final", reason: SERVER_OUTDATED };
  if (status >= 400) return { kind: "final", reason: SERVER_REJECTED };
  return { kind: "final", reason: INVALID_RESPONSE };
}
export type TurnChangesReadFailure =
  | { readonly kind: "notApplicable" }
  | { readonly kind: "retryable"; readonly reason: string }
  | { readonly kind: "final"; readonly reason: string };
export const TRANSIENT_BACKEND_READ_ERRORS = [
  TURN_READ_BUSY,
  "Workspace trust changed while loading turn changes.",
  "Turn changes workspace is unavailable.",
  "Saved turn changes are unavailable.",
  "Saved turn changes could not be read.",
] as const;
const RETRYABLE_REASONS: ReadonlySet<string> = new Set([
  ...TRANSIENT_BACKEND_READ_ERRORS,
  QUEUE_FULL,
  SERVER_READ_FAILED,
  READ_FAILED,
]);
const NOT_APPLICABLE_REASONS: ReadonlySet<string> = new Set([
  TURN_READ_CANCELLED,
  "Viewing turn changes requires a trusted workspace.",
]);
const SIZE_EXCEEDED = "Saved turn changes exceed the supported size.";
const FINAL_REASONS: ReadonlySet<string> = new Set([
  SIZE_EXCEEDED,
  "Saved turn changes are invalid.",
]);
const INVALID_RESPONSE_MESSAGES: ReadonlySet<string> = new Set([
  "Invalid runner turn changes",
  "Invalid runner UUID",
  "Invalid runner identifier",
  "Invalid turn file path",
  "Invalid remote runner getTurnChanges response.",
  "Invalid remote runner getTurnFileDiff response.",
  "Runner returned changes for another turn.",
  "Runner returned a different turn file diff.",
  "Runner returned an invalid response.",
  "Invalid turn changes response.",
  "Invalid turn changes fields.",
  "Invalid turn changes summary.",
  "Invalid unsupported turn changes.",
  "Invalid changed file.",
  "Changed line totals exceed the supported range.",
  "Unavailable changes must not include files.",
  "Invalid turn file diff.",
  "Invalid turn diff content.",
]);
/** Only fixed known diagnostics may cross into the UI; never display raw backend details. */
export function classifyTurnChangesReadFailure(error: unknown): TurnChangesReadFailure {
  const message = errorText(error);
  if (SERVER_READ_ERRORS.has(message) || isTransientRunnerBusyError(error))
    return { kind: "retryable", reason: SERVER_READ_FAILED };
  if (SERVER_CONNECTION_ERRORS.has(message))
    return { kind: "final", reason: SERVER_CONNECTION_FAILED };
  if (message === "Runner identity changed. Reconnect the server before continuing.")
    return { kind: "final", reason: SERVER_IDENTITY_CHANGED };
  if (message === OUTDATED_RUNNER_MESSAGE) return { kind: "final", reason: SERVER_OUTDATED };
  const status = classifyHttpStatus(message);
  if (status !== null) return status;
  if (NOT_APPLICABLE_REASONS.has(message)) return { kind: "notApplicable" };
  if (RETRYABLE_REASONS.has(message)) return { kind: "retryable", reason: message };
  if (FINAL_REASONS.has(message)) return { kind: "final", reason: message };
  if (INVALID_RESPONSE_MESSAGES.has(message)) return { kind: "final", reason: INVALID_RESPONSE };
  if (message === "Runner response exceeds output limit.")
    return { kind: "final", reason: SIZE_EXCEEDED };
  return { kind: "retryable", reason: READ_FAILED };
}
export function turnChangesReadFailureReason(error: unknown): string {
  const failure = classifyTurnChangesReadFailure(error);
  if (failure.kind === "notApplicable") return errorText(error);
  return failure.reason;
}
export function isRetryableTurnChangesReason(reason: string | null): boolean {
  return reason !== null && RETRYABLE_REASONS.has(reason);
}
export function isAutoRetryableTurnChangesReason(reason: string | null): boolean {
  return reason === SERVER_READ_FAILED;
}
