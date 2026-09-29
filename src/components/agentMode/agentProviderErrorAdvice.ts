import type { AgentCliKind } from "../../domain/agentTask";
import {
  agentProviderDisplayName,
  type AgentAuthenticationFailureCause,
  type AgentCapacityScope,
  type AgentProviderError,
} from "../../domain/agentOutput/agentProviderError";

export type AgentProviderErrorTarget = "local" | "remote";

const USAGE_LIMIT_ADVICE = "Wait for the limit to reset, or switch to another model or provider.";

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
    case "unsupportedModelForCliVersion":
      return target === "remote"
        ? "Update the CLI on the server running this thread, then try again."
        : "Open Settings > Agents to update it.";
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

function unsupportedCause(cause: never): never {
  throw new TypeError(`Unsupported authentication failure cause: ${String(cause)}.`);
}

function unsupportedScope(scope: never): never {
  throw new TypeError(`Unsupported capacity scope: ${String(scope)}.`);
}

function unsupportedProvider(provider: never): never {
  throw new TypeError(`Unsupported agent CLI kind: ${String(provider)}.`);
}
