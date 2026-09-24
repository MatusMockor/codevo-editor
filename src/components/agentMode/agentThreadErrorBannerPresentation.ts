import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
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
  if (failed.status.kind === "exited") {
    return {
      ...base,
      title: generic,
      detail: `The agent process exited with code ${failed.status.exitCode}.`,
    };
  }
  if (failed.status.kind !== "failed") return null;
  const error = classifyAgentProviderError(failed.status.message, provider);
  return { ...base, ...failureText(error, generic) };
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

function failureText(error: AgentProviderError, generic: string): BannerText {
  const detail = error.detail;
  switch (detail.kind) {
    case "protocolFailure":
      return {
        title: agentProviderErrorHeadline(error, null),
        detail: "The provider session could not continue. Check the provider CLI and try again.",
      };
    case "authenticationRequired":
      return {
        title: agentProviderErrorHeadline(error, null),
        detail: `Sign in to ${agentProviderDisplayName(detail.provider)} again, then retry.`,
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
