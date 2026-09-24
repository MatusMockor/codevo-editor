export const WORKSPACE_RELEASE_RETRY_DELAYS_MS: readonly number[] = [100, 250, 500, 1_000];

export const WORKSPACE_RELEASE_STILL_IN_PROGRESS =
  "Workspace release is still in progress in the backend.";

export type WorkspaceReleaseRetryDelay = (delayMs: number) => Promise<void>;

export const scheduleWorkspaceReleaseRetry: WorkspaceReleaseRetryDelay = (delayMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

export type WorkspaceReleaseRetryOutcome<Result> =
  | { readonly kind: "settled"; readonly result: Result }
  | { readonly kind: "abandoned" }
  | { readonly kind: "exhausted" };

export type WorkspaceReleaseRetryFailurePolicy = "propagate" | "retryUnknownOutcome";

export interface WorkspaceReleaseRetryRequest<Result> {
  attempt(): Promise<Result>;
  isReleasing(result: Result): boolean;
  isCurrent(): boolean;
  readonly delay?: WorkspaceReleaseRetryDelay;
  readonly onFailure?: WorkspaceReleaseRetryFailurePolicy;
}

type WorkspaceReleaseAttempt<Result> =
  { readonly kind: "result"; readonly result: Result } | { readonly kind: "unknown" };

export async function retryWhileWorkspaceReleasing<Result>({
  attempt,
  delay = scheduleWorkspaceReleaseRetry,
  isCurrent,
  isReleasing,
  onFailure = "propagate",
}: WorkspaceReleaseRetryRequest<Result>): Promise<WorkspaceReleaseRetryOutcome<Result>> {
  const run = async (): Promise<WorkspaceReleaseAttempt<Result>> => {
    try {
      return { kind: "result", result: await attempt() };
    } catch (error) {
      if (onFailure === "propagate") throw error;
      return { kind: "unknown" };
    }
  };
  const settled = (
    outcome: WorkspaceReleaseAttempt<Result>,
  ): outcome is {
    readonly kind: "result";
    readonly result: Result;
  } => outcome.kind === "result" && !isReleasing(outcome.result);
  let outcome = await run();
  for (const delayMs of WORKSPACE_RELEASE_RETRY_DELAYS_MS) {
    if (settled(outcome)) return { kind: "settled", result: outcome.result };
    if (!isCurrent()) return { kind: "abandoned" };
    await delay(delayMs);
    if (!isCurrent()) return { kind: "abandoned" };
    outcome = await run();
  }
  if (settled(outcome)) return { kind: "settled", result: outcome.result };
  return { kind: "exhausted" };
}

export interface CancellableWorkspaceRetryScheduler {
  readonly delay: WorkspaceReleaseRetryDelay;
  activate(): void;
  cancelAll(): void;
  isActive(): boolean;
}

export function createCancellableWorkspaceRetryScheduler(): CancellableWorkspaceRetryScheduler {
  const pending = new Map<ReturnType<typeof setTimeout>, () => void>();
  let active = true;
  return {
    delay: (delayMs) =>
      new Promise((resolve) => {
        if (!active) {
          resolve();
          return;
        }
        const timer = setTimeout(() => {
          pending.delete(timer);
          resolve();
        }, delayMs);
        pending.set(timer, resolve);
      }),
    activate: () => {
      active = true;
    },
    cancelAll: () => {
      active = false;
      for (const [timer, resolve] of pending) {
        clearTimeout(timer);
        resolve();
      }
      pending.clear();
    },
    isActive: () => active,
  };
}
