import type { AgentCliKind } from "../../domain/agentTask";
import {
  isTerminalAgentTurnStatus,
  type AgentTurn,
  type AgentTurnStatus,
} from "../../domain/agentThread";
import type { AgentTurnItem } from "./agentModePresentation";
import {
  classifyAgentProviderError,
  isGenericProviderFailure,
  sameAgentProviderError,
  type AgentProviderError,
} from "../../domain/agentOutput/agentProviderError";

export type AgentTurnHalt = "stopping" | "stopped" | "interrupted";

export interface AgentTurnErrorContext {
  readonly provider: AgentCliKind;
  readonly installedVersion: string | null;
  readonly executionTarget: "local" | "remote";
  readonly halt: AgentTurnHalt | null;
  readonly hasProviderFailure: boolean;
}

export function createTurnErrorContext(
  provider: AgentCliKind,
  installedVersion: string | null,
  executionTarget: "local" | "remote",
  turn: Pick<AgentTurn, "status" | "haltRequested">,
  items: ReadonlyArray<AgentTurnItem>,
): AgentTurnErrorContext {
  return {
    provider,
    installedVersion,
    executionTarget,
    halt: agentTurnHalt(turn),
    hasProviderFailure: items.some((item) => {
      const error = reportedError(item, provider);
      return (
        error !== null &&
        error.detail.kind !== "advisory" &&
        error.message !== "" &&
        !isGenericProviderFailure(error)
      );
    }),
  };
}

export function agentTurnHalt(
  turn: Pick<AgentTurn, "status" | "haltRequested">,
): AgentTurnHalt | null {
  const { status } = turn;
  if (status.kind === "stopped" || status.kind === "interrupted") return status.kind;
  if (turn.haltRequested === true && !isTerminalAgentTurnStatus(status)) return "stopping";
  return null;
}

export function suppressGenericFailure(
  error: AgentProviderError,
  context: AgentTurnErrorContext,
): boolean {
  return (
    context.executionTarget === "remote" &&
    context.hasProviderFailure &&
    isGenericProviderFailure(error)
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

export type AgentTurnEndMarker =
  | { readonly kind: "stopped"; readonly label: string }
  | { readonly kind: "interrupted"; readonly label: string; readonly detail: string }
  | { readonly kind: "exited"; readonly label: string; readonly detail: string };

export function agentTurnEndMarker(
  status: AgentTurnStatus,
  executionTarget: "local" | "remote" = "local",
): AgentTurnEndMarker | null {
  switch (status.kind) {
    case "pending":
    case "running":
    case "failed":
      return null;
    case "stopped":
      return { kind: "stopped", label: "Stopped" };
    case "interrupted":
      return {
        kind: "interrupted",
        label: "Interrupted",
        detail:
          executionTarget === "remote"
            ? "The remote run ended before this turn finished."
            : "The app closed before this turn finished.",
      };
    case "exited":
      if (status.exitCode === 0) return null;
      return {
        kind: "exited",
        label: `Exited with code ${status.exitCode}`,
        detail: "The agent process ended with an error.",
      };
    default:
      return unsupportedTurnStatus(status);
  }
}

function unsupportedTurnStatus(status: never): never {
  throw new TypeError(`Unsupported agent turn status: ${JSON.stringify(status)}.`);
}
