import type { AgentCliKind } from "../../domain/agentTask";
import type { AgentTurnStatus } from "../../domain/agentThread";
import type { AgentTurnItem } from "./agentModePresentation";
import {
  classifyAgentProviderError,
  sameAgentProviderError,
  type AgentProviderError,
} from "../../domain/agentOutput/agentProviderError";

export interface AgentTurnErrorContext {
  readonly provider: AgentCliKind;
  readonly installedVersion: string | null;
  readonly executionTarget: "local" | "remote";
  readonly hasProviderFailure: boolean;
}

export function createTurnErrorContext(
  provider: AgentCliKind,
  installedVersion: string | null,
  executionTarget: "local" | "remote",
  items: ReadonlyArray<AgentTurnItem>,
): AgentTurnErrorContext {
  return {
    provider,
    installedVersion,
    executionTarget,
    hasProviderFailure: items.some((item) => {
      const error = reportedError(item, provider);
      return (
        error !== null &&
        error.detail.kind !== "advisory" &&
        error.message !== "" &&
        error.message !== "provider_reported_failure"
      );
    }),
  };
}

export function suppressGenericFailure(
  error: AgentProviderError,
  context: AgentTurnErrorContext,
): boolean {
  return (
    context.executionTarget === "remote" &&
    context.hasProviderFailure &&
    error.message === "provider_reported_failure"
  );
}

export function turnFailure(
  status: AgentTurnStatus,
  context: AgentTurnErrorContext,
): AgentProviderError | null {
  if (status.kind !== "failed") return null;
  const error = classifyAgentProviderError(status.message, context.provider);
  return suppressGenericFailure(error, context) ? null : error;
}

export function repeatsLastError(
  failure: AgentProviderError,
  items: ReadonlyArray<AgentTurnItem>,
  context: AgentTurnErrorContext,
): boolean {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const reported = reportedError(items[index], context.provider);
    if (reported === null || reported.detail.kind === "advisory") continue;
    return sameAgentProviderError(failure, reported);
  }
  return false;
}

function reportedError(
  item: AgentTurnItem | undefined,
  provider: AgentCliKind,
): AgentProviderError | null {
  if (item?.kind === "error") return classifyAgentProviderError(item.message, provider);
  if (item?.kind === "result" && item.isError)
    return classifyAgentProviderError(item.text, provider);
  return null;
}
