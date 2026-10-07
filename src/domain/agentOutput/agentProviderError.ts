import { type AgentCliKind, boundedUtf8Text } from "@codevo/agent-events";
import {
  agentRunnerFailureHeadline,
  agentRunnerTerminalOutcome,
  type AgentRunnerFailureReason,
} from "./agentRunnerFailure";

export const MAX_AGENT_PROVIDER_ERROR_MESSAGE_BYTES = 4 * 1_024;
export const MAX_AGENT_PROVIDER_ERROR_PAYLOAD_CHARS = 64 * 1_024;

const MAX_ERROR_PAYLOAD_UNWRAPS = 4;
const MAX_AGENT_MODEL_NAME_CHARS = 120;
const MAX_USAGE_LIMIT_RESET_CHARS = 64;
const QUOTE_CHARACTERS = "`'\"‘’“”";
const NEWER_VERSION_PATTERN = /requires a newer version of\s+(codex|claude)/iu;
const QUOTED_MODEL_PATTERN = new RegExp(
  `[${QUOTE_CHARACTERS}]([^\\s${QUOTE_CHARACTERS}]+)[${QUOTE_CHARACTERS}]\\s+model\\s+requires a newer version`,
  "iu",
);

const OAUTH_SESSION_EXPIRED_PATTERN =
  /^Failed to authenticate: OAuth session expired and could not be refreshed[.!]?$/iu;
const CLAUDE_USAGE_LIMIT_PREFIXES: ReadonlyArray<string> = [
  "You've hit your ",
  "You've reached your ",
  "You're out of usage credits",
  "You're out of extra usage",
  "Your org is out of usage",
];
const CODEX_USAGE_LIMIT_PREFIXES: ReadonlyArray<string> = [
  "You've hit your usage limit",
  "You've reached your usage limit",
  "You're out of credits",
  "Usage limit reached",
];
const CLAUDE_CAPACITY_PATTERNS: ReadonlyArray<CapacityPattern> = [
  {
    pattern: /^API Error: Request rejected \(429\) · this may be a temporary capacity issue\b/u,
    scope: "service",
  },
  {
    pattern: /^API Error: Server is temporarily limiting requests \(not your usage limit\)/u,
    scope: "service",
  },
  { pattern: /^API Error: Repeated 529 Overloaded errors\b/u, scope: "service" },
  { pattern: /^API Error: 529\b/u, scope: "service" },
  { pattern: /^Overloaded$/u, scope: "service" },
  { pattern: /^[A-Z][\w.-]{0,40} is experiencing high load\b/u, scope: "model" },
];
const CODEX_CAPACITY_PATTERNS: ReadonlyArray<CapacityPattern> = [
  { pattern: /^Selected model is at capacity\b/u, scope: "model" },
];
const CLAUDE_CONVERSATION_IMAGE_PATTERNS: ReadonlyArray<RegExp> = [
  /^(?:API Error:\s*)?an image in the conversation could not be processed and was removed\b/iu,
  /^(?:API Error:\s{0,8})?(?:\d{3}\s{1,8})?(?:messages\.\d{1,6}\.content\.\d{1,6}\.image\.source\.base64(?:\.data)?:\s{0,8})?At least one of the image dimensions exceed max allowed size for many-image requests\b/iu,
];
const API_ERROR_PAYLOAD_PREFIX = /^(?:API Error:[ \t]{0,8})?(?:\d{3}[ \t]{1,8})?(?=\{)/u;
const CLAUDE_RESET_PATTERN = /\s·\s*resets\s+(.+)$/u;
const CODEX_RESET_PATTERN = /\btry again (at|in)\s+(.+)$/iu;
const RESET_TRAILING_PUNCTUATION = /[\s.!]+$/u;

export type AgentAuthenticationFailureCause = "sessionExpired" | "rejected";
export type AgentCapacityScope = "service" | "model";

interface CapacityPattern {
  readonly pattern: RegExp;
  readonly scope: AgentCapacityScope;
}

export interface AgentProviderAdvisory {
  readonly provider: AgentCliKind;
  readonly text: string;
}

export const KNOWN_AGENT_PROVIDER_ADVISORIES: ReadonlyArray<AgentProviderAdvisory> = [
  {
    provider: "codex",
    text: "`--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.",
  },
];

export type AgentProviderErrorDetail =
  | {
      readonly kind: "unsupportedModelForCliVersion";
      readonly provider: AgentCliKind;
      readonly model: string;
    }
  | {
      readonly kind: "authenticationRequired";
      readonly provider: AgentCliKind;
      readonly cause: AgentAuthenticationFailureCause;
    }
  | {
      readonly kind: "temporarilyOverCapacity";
      readonly provider: AgentCliKind;
      readonly scope: AgentCapacityScope;
    }
  | {
      readonly kind: "usageLimited";
      readonly provider: AgentCliKind;
      readonly resetsAt: string | null;
    }
  | { readonly kind: "protocolFailure"; readonly provider: AgentCliKind }
  | {
      readonly kind: "runnerFailure";
      readonly provider: AgentCliKind;
      readonly reason: AgentRunnerFailureReason;
    }
  | { readonly kind: "conversationImagesTooLarge"; readonly provider: "claudeCode" }
  | { readonly kind: "advisory"; readonly provider: AgentCliKind; readonly text: string }
  | { readonly kind: "unknown" };

export interface AgentProviderError {
  readonly detail: AgentProviderErrorDetail;
  readonly message: string;
  readonly raw: string;
  readonly signature: string;
}

export function classifyAgentProviderError(
  raw: string,
  provider: AgentCliKind,
): AgentProviderError {
  const message = boundedUtf8Text(unwrappedMessage(raw), MAX_AGENT_PROVIDER_ERROR_MESSAGE_BYTES);
  const detail = advisoryDetail(message, provider) ??
    unsupportedModelDetail(message, provider) ??
    launchFailureDetail(message, provider) ??
    usageLimitDetail(message, provider) ??
    conversationImageDetail(message, provider) ??
    capacityDetail(message, provider) ?? { kind: "unknown" };

  return {
    detail,
    message,
    raw: boundedUtf8Text(raw.trim(), MAX_AGENT_PROVIDER_ERROR_MESSAGE_BYTES),
    signature: errorSignature(detail, message),
  };
}

export function agentProviderErrorHeadline(
  error: AgentProviderError,
  installedVersion: string | null,
): string {
  const detail = error.detail;

  if (detail.kind === "unsupportedModelForCliVersion") {
    const name = agentProviderDisplayName(detail.provider);
    const version = displayVersion(installedVersion);
    const subject = version === null ? name : `${name} ${version}`;

    return `${subject} cannot run ${detail.model}. Update ${name} and try again.`;
  }
  if (detail.kind === "authenticationRequired") return authenticationHeadline(detail);
  if (detail.kind === "usageLimited") return usageLimitHeadline(detail);
  if (detail.kind === "temporarilyOverCapacity")
    return `${agentProviderDisplayName(detail.provider)} is temporarily over capacity.`;
  if (detail.kind === "protocolFailure")
    return `${agentProviderDisplayName(detail.provider)} could not complete this run.`;
  if (detail.kind === "runnerFailure")
    return agentRunnerFailureHeadline(detail.reason, agentProviderDisplayName(detail.provider));
  if (detail.kind === "conversationImagesTooLarge")
    return "This conversation contains images larger than the API allows.";
  if (detail.kind === "advisory") return detail.text;
  if (detail.kind === "unknown") return error.message;

  return unsupportedAgentProviderErrorDetail(detail);
}

export function isGenericProviderFailure(error: AgentProviderError): boolean {
  const detail = error.detail;

  return detail.kind === "runnerFailure" && detail.reason === "providerReportedFailure";
}

export function sameAgentProviderError(
  left: AgentProviderError,
  right: AgentProviderError,
): boolean {
  return left.signature === right.signature;
}

export function agentProviderDisplayName(provider: AgentCliKind): string {
  if (provider === "claudeCode") return "Claude Code";
  if (provider === "codex") return "Codex";

  return unsupportedAgentProviderKind(provider);
}

function unwrappedMessage(raw: string): string {
  const trimmed = raw.trim();
  let current = trimmed;

  for (let depth = 0; depth < MAX_ERROR_PAYLOAD_UNWRAPS; depth += 1) {
    const nested = jsonErrorMessage(current);

    if (nested === null) break;

    current = nested.trim();
  }

  return current === "" ? trimmed : current;
}

function jsonErrorMessage(text: string): string | null {
  if (text.length > MAX_AGENT_PROVIDER_ERROR_PAYLOAD_CHARS) return null;

  const payload = text.replace(API_ERROR_PAYLOAD_PREFIX, "");

  if (!payload.startsWith("{")) return null;

  const value = jsonObject(payload);

  if (value === null) return null;

  const error = objectValue(value.error);

  if (error !== null && typeof error.message === "string") return error.message;
  if (typeof value.message === "string") return value.message;

  return null;
}

function launchFailureDetail(
  message: string,
  provider: AgentCliKind,
): AgentProviderErrorDetail | null {
  const outcome = agentRunnerTerminalOutcome(message);

  if (outcome !== null) return { ...outcome, provider };
  if (provider === "claudeCode" && OAUTH_SESSION_EXPIRED_PATTERN.test(message)) {
    return { kind: "authenticationRequired", provider, cause: "sessionExpired" };
  }
  return null;
}

function usageLimitDetail(
  message: string,
  provider: AgentCliKind,
): AgentProviderErrorDetail | null {
  const line = firstLine(message).replace(/[‘’]/gu, "'");
  const prefixes =
    provider === "claudeCode" ? CLAUDE_USAGE_LIMIT_PREFIXES : CODEX_USAGE_LIMIT_PREFIXES;

  if (!prefixes.some((prefix) => line.startsWith(prefix))) return null;

  return { kind: "usageLimited", provider, resetsAt: usageLimitReset(line, provider) };
}

function capacityDetail(message: string, provider: AgentCliKind): AgentProviderErrorDetail | null {
  const line = firstLine(message);
  const patterns = provider === "claudeCode" ? CLAUDE_CAPACITY_PATTERNS : CODEX_CAPACITY_PATTERNS;

  const match = patterns.find((candidate) => candidate.pattern.test(line));

  if (match === undefined) return null;

  return { kind: "temporarilyOverCapacity", provider, scope: match.scope };
}

function conversationImageDetail(
  message: string,
  provider: AgentCliKind,
): AgentProviderErrorDetail | null {
  if (provider !== "claudeCode") return null;

  const line = firstLine(message);

  if (!CLAUDE_CONVERSATION_IMAGE_PATTERNS.some((pattern) => pattern.test(line))) return null;

  return { kind: "conversationImagesTooLarge", provider };
}

function usageLimitReset(line: string, provider: AgentCliKind): string | null {
  const reset = provider === "claudeCode" ? claudeReset(line) : codexReset(line);

  if (reset === null) return null;

  const trimmed = reset.replace(RESET_TRAILING_PUNCTUATION, "").trim();

  if (trimmed === "" || trimmed.length > MAX_USAGE_LIMIT_RESET_CHARS) return null;

  return trimmed;
}

function claudeReset(line: string): string | null {
  return CLAUDE_RESET_PATTERN.exec(line)?.[1] ?? null;
}

function codexReset(line: string): string | null {
  const match = CODEX_RESET_PATTERN.exec(line);

  if (match === null) return null;

  const reset = match[2] ?? "";

  return match[1]?.toLowerCase() === "in" ? `in ${reset}` : reset;
}

function firstLine(message: string): string {
  const newline = message.indexOf("\n");

  return (newline === -1 ? message : message.slice(0, newline)).trim();
}

function authenticationHeadline(
  detail: Extract<AgentProviderErrorDetail, { kind: "authenticationRequired" }>,
): string {
  const name = agentProviderDisplayName(detail.provider);

  switch (detail.cause) {
    case "sessionExpired":
      return `${name} needs you to sign in again.`;
    case "rejected":
      return `${name} could not authenticate this run.`;
    default:
      return unsupportedAuthenticationCause(detail.cause);
  }
}

function usageLimitHeadline(
  detail: Extract<AgentProviderErrorDetail, { kind: "usageLimited" }>,
): string {
  const headline = `${agentProviderDisplayName(detail.provider)} usage limit reached.`;

  if (detail.resetsAt === null) return headline;

  return `${headline} Resets ${detail.resetsAt}.`;
}

function advisoryDetail(message: string, provider: AgentCliKind): AgentProviderErrorDetail | null {
  const advisory = KNOWN_AGENT_PROVIDER_ADVISORIES.find(
    (known) => known.provider === provider && known.text === message,
  );

  if (advisory === undefined) return null;

  return { kind: "advisory", provider: advisory.provider, text: advisory.text };
}

function unsupportedModelDetail(
  message: string,
  provider: AgentCliKind,
): AgentProviderErrorDetail | null {
  const mention = NEWER_VERSION_PATTERN.exec(message);

  if (mention === null) return null;
  if (mentionedProvider(mention[1] ?? "") !== provider) return null;

  const quoted = QUOTED_MODEL_PATTERN.exec(message);
  const model = quoted?.[1] ?? "";

  if (model === "" || model.length > MAX_AGENT_MODEL_NAME_CHARS) return null;

  return { kind: "unsupportedModelForCliVersion", provider, model };
}

function mentionedProvider(mention: string): AgentCliKind | null {
  const normalized = mention.toLowerCase();

  if (normalized === "codex") return "codex";
  if (normalized === "claude") return "claudeCode";

  return null;
}

function errorSignature(detail: AgentProviderErrorDetail, message: string): string {
  if (detail.kind === "unsupportedModelForCliVersion") {
    return `unsupportedModelForCliVersion:${detail.provider}:${detail.model}`;
  }
  if (detail.kind === "authenticationRequired") {
    return `${detail.kind}:${detail.provider}:${detail.cause}`;
  }
  if (detail.kind === "usageLimited") {
    return `${detail.kind}:${detail.provider}:${detail.resetsAt ?? ""}`;
  }
  if (detail.kind === "temporarilyOverCapacity") {
    return `${detail.kind}:${detail.provider}:${detail.scope}`;
  }
  if (detail.kind === "protocolFailure" || detail.kind === "conversationImagesTooLarge") {
    return `${detail.kind}:${detail.provider}`;
  }
  if (detail.kind === "runnerFailure") {
    if (detail.reason === "providerReportedFailure") return unclassifiedSignature(message);
    return `${detail.kind}:${detail.provider}:${detail.reason}`;
  }
  if (detail.kind === "advisory") {
    return `advisory:${detail.provider}:${normalizedMessage(detail.text)}`;
  }
  if (detail.kind === "unknown") return unclassifiedSignature(message);

  return unsupportedAgentProviderErrorDetail(detail);
}

function unclassifiedSignature(message: string): string {
  return `unknown:${normalizedMessage(message)}`;
}

function normalizedMessage(message: string): string {
  return message.replace(/\s+/gu, " ").trim().toLowerCase();
}

function displayVersion(installedVersion: string | null): string | null {
  if (installedVersion === null) return null;

  const trimmed = installedVersion.trim();

  return trimmed === "" ? null : trimmed;
}

function jsonObject(text: string): Record<string, unknown> | null {
  try {
    return objectValue(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  return value as Record<string, unknown>;
}

function unsupportedAgentProviderErrorDetail(detail: never): never {
  throw new TypeError(`Unsupported agent provider error: ${JSON.stringify(detail)}.`);
}

function unsupportedAuthenticationCause(cause: never): never {
  throw new TypeError(`Unsupported authentication failure cause: ${String(cause)}.`);
}

function unsupportedAgentProviderKind(provider: never): never {
  throw new TypeError(`Unsupported agent CLI kind: ${String(provider)}.`);
}
