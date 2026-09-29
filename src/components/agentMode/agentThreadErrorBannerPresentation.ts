import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import type { AgentCliKind } from "../../domain/agentTask";
import type { AgentTurn } from "../../domain/agentThread";
import {
  agentProviderDisplayName,
  agentProviderErrorHeadline,
  classifyAgentProviderError,
  type AgentProviderError,
} from "../../domain/agentOutput/agentProviderError";
import { normalizeStoredAgentLaunch } from "../../domain/agentStoredLaunch";
import {
  agentFailedLastTurn,
  agentTurnRetryPlan,
  type AgentTurnRetryPlan,
  type AgentTurnRetryReadyPlan,
} from "../../domain/agentTurnRetry";
import {
  agentLaunchModeHint,
  agentLaunchModeLabel,
  agentLaunchModelLabel,
} from "./agentLaunchPresentation";
import {
  agentProviderErrorAdvice,
  type AgentProviderErrorTarget,
} from "./agentProviderErrorAdvice";

const MAX_DETAIL_CHARACTERS = 240;
const KEY_SEPARATOR = "\u0001";

export interface AgentThreadErrorBannerModel {
  readonly key: string;
  readonly failedTurnId: string;
  readonly title: string;
  readonly detail: string;
  readonly retry: AgentTurnRetryPlan;
}

interface BannerText {
  readonly title: string;
  readonly detail: string;
}

export function agentThreadErrorBannerModel(
  view: AgentThreadView | null,
  fallbackLaunch: AgentLaunchOptions | null,
): AgentThreadErrorBannerModel | null {
  if (view === null) return null;
  const thread = view.thread;
  const failed = agentFailedLastTurn(thread);
  const retry = agentTurnRetryPlan(thread, fallbackLaunch);
  if (failed === null || retry === null) return null;
  const provider = thread.provider.kind;
  const base = {
    key: `${thread.threadId}${KEY_SEPARATOR}${failed.turnId}`,
    failedTurnId: failed.turnId,
    retry,
  };
  const generic = `${agentProviderDisplayName(provider)} could not complete this run.`;
  const target: AgentProviderErrorTarget = view.execution === undefined ? "local" : "remote";
  if (failed.status.kind === "exited") {
    const reported = reportedFailure(failed, provider);
    if (reported !== null) return { ...base, ...failureText(reported, generic, target) };
    return {
      ...base,
      title: generic,
      detail: `The agent process exited with code ${failed.status.exitCode}.`,
    };
  }
  if (failed.status.kind !== "failed") return null;
  const error = classifyAgentProviderError(failed.status.message, provider);
  return { ...base, ...failureText(error, generic, target) };
}

export function agentRetryModeLabel(plan: AgentTurnRetryReadyPlan): string {
  return agentLaunchModeLabel(normalizeStoredAgentLaunch(plan.launch));
}

export function agentRetryLaunchNote(plan: AgentTurnRetryReadyPlan): string | null {
  const launch = normalizeStoredAgentLaunch(plan.launch);
  const mode = agentLaunchModeLabel(launch);
  if (plan.source === "lastUsed") {
    return `Retries with your last used settings: ${agentLaunchModelLabel(launch)} · ${mode}.`;
  }
  if (!plan.dangerous) return null;
  return `Retries with ${mode}: ${agentLaunchModeHint(launch)}`;
}

function reportedFailure(turn: AgentTurn, provider: AgentCliKind): AgentProviderError | null {
  for (let index = turn.events.length - 1; index >= 0; index -= 1) {
    const event = turn.events[index];
    if (event?.kind === "result") {
      return event.isError ? recognized(classifyAgentProviderError(event.text, provider)) : null;
    }
    if (event?.kind === "assistantText" || event?.kind === "toolCall") return null;
    if (event?.kind !== "error") continue;
    const error = classifyAgentProviderError(event.message, provider);
    if (error.detail.kind !== "advisory") return recognized(error);
  }
  return null;
}

function recognized(error: AgentProviderError): AgentProviderError | null {
  return error.detail.kind === "unknown" ? null : error;
}

function failureText(
  error: AgentProviderError,
  generic: string,
  target: AgentProviderErrorTarget,
): BannerText {
  const detail = error.detail;
  switch (detail.kind) {
    case "protocolFailure":
    case "authenticationRequired":
    case "usageLimited":
    case "temporarilyOverCapacity":
      return {
        title: agentProviderErrorHeadline(error, null),
        detail: agentProviderErrorAdvice(error, target) ?? "",
      };
    case "unsupportedModelForCliVersion":
      return {
        title: agentProviderErrorHeadline(error, null),
        detail: "Pick another model in the composer, or update the provider CLI.",
      };
    case "advisory":
    case "unknown":
      return { title: generic, detail: firstLine(error.message) };
    default:
      return unsupportedDetail(detail);
  }
}

function firstLine(message: string): string {
  const line =
    message
      .split("\n")
      .find((candidate) => candidate.trim() !== "")
      ?.trim() ?? "";
  if (line.length <= MAX_DETAIL_CHARACTERS) return line;
  return `${line.slice(0, MAX_DETAIL_CHARACTERS)}…`;
}

function unsupportedDetail(detail: never): never {
  throw new TypeError(`Unsupported provider error detail: ${JSON.stringify(detail)}.`);
}
