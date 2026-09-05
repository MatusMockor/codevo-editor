import type { AgentCliKind } from "../agentTask";
import { boundedUtf8Text } from "./utf8Text";

export const MAX_AGENT_PROVIDER_ERROR_MESSAGE_BYTES = 4 * 1_024;
export const MAX_AGENT_PROVIDER_ERROR_PAYLOAD_CHARS = 64 * 1_024;

const MAX_ERROR_PAYLOAD_UNWRAPS = 4;
const MAX_AGENT_MODEL_NAME_CHARS = 120;
const QUOTE_CHARACTERS = "`'\"‘’“”";
const NEWER_VERSION_PATTERN = /requires a newer version of\s+(codex|claude)/iu;
const QUOTED_MODEL_PATTERN = new RegExp(
  `[${QUOTE_CHARACTERS}]([^\\s${QUOTE_CHARACTERS}]+)[${QUOTE_CHARACTERS}]\\s+model\\s+requires a newer version`,
  "iu",
);

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
    unsupportedModelDetail(message, provider) ?? { kind: "unknown" };

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
  if (detail.kind === "advisory") return detail.text;
  if (detail.kind === "unknown") return error.message;

  return unsupportedAgentProviderErrorDetail(detail);
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
  if (!text.startsWith("{")) return null;
  if (text.length > MAX_AGENT_PROVIDER_ERROR_PAYLOAD_CHARS) return null;

  const value = jsonObject(text);

  if (value === null) return null;

  const error = objectValue(value.error);

  if (error !== null && typeof error.message === "string") return error.message;
  if (typeof value.message === "string") return value.message;

  return null;
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
  if (detail.kind === "advisory") {
    return `advisory:${detail.provider}:${normalizedMessage(detail.text)}`;
  }
  if (detail.kind === "unknown") return `unknown:${normalizedMessage(message)}`;

  return unsupportedAgentProviderErrorDetail(detail);
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

function unsupportedAgentProviderKind(provider: never): never {
  throw new TypeError(`Unsupported agent CLI kind: ${String(provider)}.`);
}
