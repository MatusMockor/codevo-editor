/** Shared admission matches the backend across readers, workspaces, summaries and file diffs. */
const MAX_READS = 4;
const MAX_QUEUED_READS = 1024;
export const TURN_READ_CANCELLED = "Recorded changes owner is no longer available.";
export const TURN_READ_BUSY = "Too many turn changes reads. Try again shortly.";
const QUEUE_FULL = "Recorded changes loading queue is full. Try again shortly.";
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
              if (errorText(error) !== TURN_READ_BUSY || attempt >= 2) throw error;
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
const INVALID_RESPONSE = "The saved changes response is invalid and cannot be displayed.";
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
]);
const NOT_APPLICABLE_REASONS: ReadonlySet<string> = new Set([
  TURN_READ_CANCELLED,
  "Viewing turn changes requires a trusted workspace.",
]);
const FINAL_REASONS: ReadonlySet<string> = new Set([
  "Saved turn changes exceed the supported size.",
  "Saved turn changes are invalid.",
]);
const INVALID_RESPONSE_MESSAGES: ReadonlySet<string> = new Set([
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
  if (NOT_APPLICABLE_REASONS.has(message)) return { kind: "notApplicable" };
  if (RETRYABLE_REASONS.has(message)) return { kind: "retryable", reason: message };
  if (FINAL_REASONS.has(message)) return { kind: "final", reason: message };
  if (INVALID_RESPONSE_MESSAGES.has(message)) return { kind: "final", reason: INVALID_RESPONSE };
  return { kind: "final", reason: READ_FAILED };
}
export function turnChangesReadFailureReason(error: unknown): string {
  const failure = classifyTurnChangesReadFailure(error);
  if (failure.kind === "notApplicable") return errorText(error);
  return failure.reason;
}
export function isRetryableTurnChangesReason(reason: string | null): boolean {
  return reason !== null && RETRYABLE_REASONS.has(reason);
}
