import type { AgentCliKind } from "../../domain/agentTask";
import {
  agentProviderDisplayName,
  type AgentAuthenticationFailureCause,
  type AgentCapacityScope,
  type AgentProviderError,
} from "../../domain/agentOutput/agentProviderError";
import type { AgentRunnerFailureReason } from "../../domain/agentOutput/agentRunnerFailure";

export type AgentProviderErrorTarget = "local" | "remote";

const USAGE_LIMIT_ADVICE = "Wait for the limit to reset, or switch to another model or provider.";
const CONVERSATION_IMAGES_ADVICE = "Start a new thread to continue.";
const CHECK_RUNNER_ADVICE = "Try again. If it keeps failing, check the runner on that server.";

export function agentProviderErrorAdvice(
  error: AgentProviderError,
  target: AgentProviderErrorTarget,
): string | null {
  const detail = error.detail;
  switch (detail.kind) {
    case "authenticationRequired":
      return authenticationAdvice(detail.provider, detail.cause, target);
    case "usageLimited":
      return USAGE_LIMIT_ADVICE;
    case "temporarilyOverCapacity":
      return capacityAdvice(detail.scope);
    case "protocolFailure":
      return target === "remote"
        ? "The server could not continue the provider session. Check the runner on that server and try again."
        : "The provider session could not continue. Check the provider CLI and try again.";
    case "runnerFailure":
      return runnerFailureAdvice(detail.reason);
    case "conversationImagesTooLarge":
      return CONVERSATION_IMAGES_ADVICE;
    case "unsupportedModelForCliVersion":
      return target === "remote"
        ? "Update the CLI on the server running this thread, then try again."
        : "Open Settings > Providers to update it.";
    case "advisory":
    case "unknown":
      return null;
    default:
      return unsupportedDetail(detail);
  }
}

function authenticationAdvice(
  provider: AgentCliKind,
  cause: AgentAuthenticationFailureCause,
  target: AgentProviderErrorTarget,
): string {
  const signIn =
    target === "remote"
      ? `sign in to ${agentProviderDisplayName(provider)} on the server running this thread`
      : localSignIn(provider);
  switch (cause) {
    case "sessionExpired":
      return `${capitalized(signIn)}, then try again.`;
    case "rejected":
      return `Try again. If it keeps failing, ${signIn}.`;
    default:
      return unsupportedCause(cause);
  }
}

function runnerFailureAdvice(reason: AgentRunnerFailureReason): string {
  switch (reason) {
    case "processCleanupFailed":
      return "Processes from this run may still be running on that server. Check them before you try again. If it keeps happening, restart the runner on that server.";
    case "timedOut":
      return "Files this run already changed are left as they are. Try again to continue, or raise the runner's time limit on that server.";
    case "providerUnavailable":
      return "Check the provider CLI and the runner on that server, then try again.";
    case "providerResultMissing":
      return "Try again. If it keeps failing, check the provider CLI on that server.";
    case "outputNotSaved":
      return "Try again. If it keeps failing, check free disk space for the runner on that server.";
    case "outputLimitExceeded":
    case "instructionSyncFailed":
    case "executionFailed":
      return CHECK_RUNNER_ADVICE;
    default:
      return unsupportedRunnerFailureReason(reason);
  }
}

function capacityAdvice(scope: AgentCapacityScope): string {
  switch (scope) {
    case "service":
      return "Try again in a moment.";
    case "model":
      return "Try again in a moment, or switch to another model.";
    default:
      return unsupportedScope(scope);
  }
}

function localSignIn(provider: AgentCliKind): string {
  switch (provider) {
    case "claudeCode":
      return "run claude in a terminal and sign in with /login";
    case "codex":
      return "run codex login in a terminal";
    default:
      return unsupportedProvider(provider);
  }
}

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function unsupportedDetail(detail: never): never {
  throw new TypeError(`Unsupported provider error detail: ${JSON.stringify(detail)}.`);
}

function unsupportedRunnerFailureReason(reason: never): never {
  throw new TypeError(`Unsupported runner failure reason: ${String(reason)}.`);
}

function unsupportedCause(cause: never): never {
  throw new TypeError(`Unsupported authentication failure cause: ${String(cause)}.`);
}

function unsupportedScope(scope: never): never {
  throw new TypeError(`Unsupported capacity scope: ${String(scope)}.`);
}

function unsupportedProvider(provider: never): never {
  throw new TypeError(`Unsupported agent CLI kind: ${String(provider)}.`);
}
