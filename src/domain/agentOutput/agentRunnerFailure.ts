export type AgentRunnerFailureReason =
  | "processCleanupFailed"
  | "timedOut"
  | "providerUnavailable"
  | "providerResultMissing"
  | "outputNotSaved"
  | "outputLimitExceeded"
  | "instructionSyncFailed"
  | "executionFailed";

export type AgentRunnerTerminalOutcome =
  | { readonly kind: "protocolFailure" }
  | { readonly kind: "authenticationRequired"; readonly cause: "rejected" }
  | { readonly kind: "runnerFailure"; readonly reason: AgentRunnerFailureReason };

const RUNNER_TERMINAL_OUTCOMES: ReadonlyMap<string, AgentRunnerTerminalOutcome> = new Map<
  string,
  AgentRunnerTerminalOutcome
>([
  ["provider_protocol_failed", { kind: "protocolFailure" }],
  ["provider_input_failed", { kind: "protocolFailure" }],
  ["authentication_failed", { kind: "authenticationRequired", cause: "rejected" }],
  ["process_cleanup_failed", { kind: "runnerFailure", reason: "processCleanupFailed" }],
  ["execution_timeout", { kind: "runnerFailure", reason: "timedOut" }],
  ["provider_unavailable", { kind: "runnerFailure", reason: "providerUnavailable" }],
  ["provider_result_missing", { kind: "runnerFailure", reason: "providerResultMissing" }],
  ["output_persistence_failed", { kind: "runnerFailure", reason: "outputNotSaved" }],
  ["output_limit_exceeded", { kind: "runnerFailure", reason: "outputLimitExceeded" }],
  ["instruction_sync_failed", { kind: "runnerFailure", reason: "instructionSyncFailed" }],
  ["execution_failed", { kind: "runnerFailure", reason: "executionFailed" }],
]);

export function agentRunnerTerminalOutcome(message: string): AgentRunnerTerminalOutcome | null {
  return RUNNER_TERMINAL_OUTCOMES.get(message) ?? null;
}

export function agentRunnerFailureHeadline(
  reason: AgentRunnerFailureReason,
  providerName: string,
): string {
  switch (reason) {
    case "processCleanupFailed":
      return "The server could not keep track of this run's processes.";
    case "timedOut":
      return "The server stopped this run because it reached the runner's time limit.";
    case "providerUnavailable":
      return `The server could not start ${providerName}.`;
    case "providerResultMissing":
      return `${providerName} ended without reporting a result.`;
    case "outputNotSaved":
      return "The server stopped this run because it could not save the run's output.";
    case "outputLimitExceeded":
      return "The server stopped this run because it produced more output than the runner allows.";
    case "instructionSyncFailed":
      return "The server could not apply your instruction files for this run.";
    case "executionFailed":
      return "The server ran into a problem and could not complete this run.";
    default:
      return unsupportedRunnerFailureReason(reason);
  }
}

function unsupportedRunnerFailureReason(reason: never): never {
  throw new TypeError(`Unsupported runner failure reason: ${String(reason)}.`);
}
