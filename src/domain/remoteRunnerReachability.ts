import { isRemoteRunnerRequestRejectedError } from "./remoteRunnerErrors";

export type RemoteRunnerDisconnectReason = "serverDisconnected" | "runnerReplaced";

export type RemoteRunnerReachability =
  | { readonly kind: "reachable" }
  | { readonly kind: "reconnecting" }
  | { readonly kind: "disconnected"; readonly reason: RemoteRunnerDisconnectReason };

export const REMOTE_RUNNER_REACHABLE: RemoteRunnerReachability = Object.freeze({
  kind: "reachable",
});

export const REMOTE_RUNNER_RECONNECTING: RemoteRunnerReachability = Object.freeze({
  kind: "reconnecting",
});

const REMOTE_RUNNER_DISCONNECTED: Readonly<
  Record<RemoteRunnerDisconnectReason, RemoteRunnerReachability>
> = Object.freeze({
  serverDisconnected: Object.freeze({ kind: "disconnected", reason: "serverDisconnected" }),
  runnerReplaced: Object.freeze({ kind: "disconnected", reason: "runnerReplaced" }),
});

export const REMOTE_RUNNER_IDENTITY_CHANGED_PATTERN = /\brunner identity changed\b/i;
export const REMOTE_RUNNER_SERVER_NOT_CONNECTED_MESSAGE = "Server is not connected";
export const MAX_REMOTE_RUNNER_FAILURE_REASON_LENGTH = 300;
const MAX_CLASSIFIED_MESSAGE_LENGTH = 1000;

export type RemoteRunnerDescriptorFollowUp =
  | { readonly kind: "none" }
  | { readonly kind: "answered"; readonly runnerId: string }
  | { readonly kind: "failed"; readonly error: unknown };

export const NO_REMOTE_RUNNER_DESCRIPTOR_FOLLOW_UP: RemoteRunnerDescriptorFollowUp = Object.freeze({
  kind: "none",
});

export type RemoteRunnerRefreshOutcome =
  | { readonly kind: "succeeded" }
  | {
      readonly kind: "failed";
      readonly error: unknown;
      readonly expectedRunnerId: string | null;
      readonly answeredRunnerId: string | null;
      readonly followUp: RemoteRunnerDescriptorFollowUp;
    };

type FailedRefresh = Extract<RemoteRunnerRefreshOutcome, { readonly kind: "failed" }>;

export interface RemoteRunnerReachabilityInput {
  readonly serverConnected: boolean;
  readonly connectionCurrent: boolean;
  readonly lastRefresh: RemoteRunnerReachability | null;
}

export function remoteRunnerDisconnected(
  reason: RemoteRunnerDisconnectReason,
): RemoteRunnerReachability {
  return REMOTE_RUNNER_DISCONNECTED[reason];
}

export function remoteRunnerRefreshReachability(
  outcome: RemoteRunnerRefreshOutcome,
): RemoteRunnerReachability {
  switch (outcome.kind) {
    case "succeeded":
      return REMOTE_RUNNER_REACHABLE;
    case "failed":
      return failedRefreshReachability(outcome);
    default:
      return unsupportedOutcome(outcome);
  }
}

export function remoteRunnerReachability(
  input: RemoteRunnerReachabilityInput,
): RemoteRunnerReachability {
  if (!input.serverConnected) return remoteRunnerDisconnected("serverDisconnected");
  if (!input.connectionCurrent) return REMOTE_RUNNER_RECONNECTING;
  return input.lastRefresh ?? REMOTE_RUNNER_RECONNECTING;
}

export function isRemoteRunnerReachable(reachability: RemoteRunnerReachability): boolean {
  return reachability.kind === "reachable";
}

export function remoteRunnerNeedsDescriptorFollowUp(
  expectedRunnerId: string | null,
  answeredRunnerId: string | null,
): boolean {
  if (answeredRunnerId === null) return false;
  return expectedRunnerId === null || expectedRunnerId === answeredRunnerId;
}

export function remoteRunnerFailureReason(error: unknown): string | null {
  const message = rawMessage(error).replace(/\s+/g, " ").trim();
  if (message === "") return null;
  if (message.length <= MAX_REMOTE_RUNNER_FAILURE_REASON_LENGTH) return message;
  return `${message.slice(0, MAX_REMOTE_RUNNER_FAILURE_REASON_LENGTH - 1)}…`;
}

function failedRefreshReachability(failure: FailedRefresh): RemoteRunnerReachability {
  const errors = failureErrors(failure);
  const messages = errors.map(classifiedMessage);
  if (runnerWasReplaced(failure, messages)) return remoteRunnerDisconnected("runnerReplaced");
  if (failure.followUp.kind === "answered") return REMOTE_RUNNER_REACHABLE;
  if (messages.includes(REMOTE_RUNNER_SERVER_NOT_CONNECTED_MESSAGE))
    return remoteRunnerDisconnected("serverDisconnected");
  if (runnerAnswered(failure)) return REMOTE_RUNNER_REACHABLE;
  return REMOTE_RUNNER_RECONNECTING;
}

function failureErrors(failure: FailedRefresh): readonly unknown[] {
  if (failure.followUp.kind === "failed") return [failure.error, failure.followUp.error];
  return [failure.error];
}

function runnerAnswered(failure: FailedRefresh): boolean {
  if (failure.answeredRunnerId === null) return isRemoteRunnerRequestRejectedError(failure.error);
  switch (failure.followUp.kind) {
    case "answered":
      return true;
    case "failed":
      return isRemoteRunnerRequestRejectedError(failure.followUp.error);
    case "none":
      return false;
    default:
      return unsupportedFollowUp(failure.followUp);
  }
}

function runnerWasReplaced(failure: FailedRefresh, messages: readonly string[]): boolean {
  const expected = failure.expectedRunnerId ?? failure.answeredRunnerId;
  const answers = [
    failure.answeredRunnerId,
    failure.followUp.kind === "answered" ? failure.followUp.runnerId : null,
  ];
  if (expected !== null && answers.some((answer) => answer !== null && answer !== expected))
    return true;
  return messages.some((message) => REMOTE_RUNNER_IDENTITY_CHANGED_PATTERN.test(message));
}

function classifiedMessage(error: unknown): string {
  const message = rawMessage(error);
  if (message.length > MAX_CLASSIFIED_MESSAGE_LENGTH) return "";
  return message;
}

function rawMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "";
}

function unsupportedFollowUp(followUp: never): never {
  throw new TypeError(`Unsupported remote runner descriptor follow-up: ${String(followUp)}.`);
}

function unsupportedOutcome(outcome: never): never {
  throw new TypeError(`Unsupported remote runner refresh outcome: ${String(outcome)}.`);
}
