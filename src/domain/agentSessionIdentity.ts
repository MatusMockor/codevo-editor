import { isAgentSessionId, type AgentCliKind } from "./agentTask";
import type { AgentProviderSession } from "./agentThread";

export type AgentFreshSessionReason = "noSession" | "sessionLost";

export type AgentResumePlan =
  | { readonly kind: "resume"; readonly sessionId: string }
  | { readonly kind: "fresh"; readonly reason: AgentFreshSessionReason };

export type AgentSessionDirective =
  | { readonly kind: "fresh"; readonly basisSessionId: string }
  | { readonly kind: "adopted"; readonly basisSessionId: string; readonly sessionId: string };

export type AgentSessionDirectiveChange =
  | { readonly kind: "keep" }
  | { readonly kind: "clear" }
  | { readonly kind: "set"; readonly directive: AgentSessionDirective };

export interface AgentSessionReport {
  readonly provider: AgentCliKind;
  readonly resumedSessionId: string | null;
  readonly reportedSessionId: string | null;
}

const KEEP: AgentSessionDirectiveChange = { kind: "keep" };
const CLEAR: AgentSessionDirectiveChange = { kind: "clear" };
const MAX_SESSION_FAILURE_TEXT_CHARS = 4 * 1024;
const CLAUDE_SESSION_NOT_FOUND_MARKERS: ReadonlyArray<string> = [
  "no conversation found with session id",
];
const CODEX_SESSION_NOT_FOUND_MARKERS: ReadonlyArray<string> = [
  "no rollout found for thread id",
  "thread not found",
  "conversation not found",
];

export function agentResumePlan(
  persistedSessionId: string | null,
  directive: AgentSessionDirective | null,
): AgentResumePlan {
  const current = currentDirective(persistedSessionId, directive);
  if (current?.kind === "fresh") return { kind: "fresh", reason: "sessionLost" };
  if (current?.kind === "adopted") return { kind: "resume", sessionId: current.sessionId };
  if (persistedSessionId === null) return { kind: "fresh", reason: "noSession" };
  return { kind: "resume", sessionId: persistedSessionId };
}

export function agentSessionDirectiveAfterReport(
  persistedSessionId: string | null,
  directive: AgentSessionDirective | null,
  report: AgentSessionReport,
): AgentSessionDirectiveChange {
  const reported = report.reportedSessionId;
  if (reported === null || !isAgentSessionId(reported)) return KEEP;
  if (persistedSessionId === null) return directive === null ? KEEP : CLEAR;
  if (report.resumedSessionId === null) {
    if (agentResumeSessionId(persistedSessionId, directive) !== null) return KEEP;
    if (reported === persistedSessionId) return CLEAR;
    return adopt(persistedSessionId, reported);
  }
  if (report.resumedSessionId !== agentResumeSessionId(persistedSessionId, directive)) return KEEP;
  if (reported === report.resumedSessionId) return KEEP;
  if (report.provider !== "claudeCode") return KEEP;
  if (reported === persistedSessionId) return CLEAR;
  return adopt(persistedSessionId, reported);
}

export function agentSessionDirectiveAfterLoss(
  persistedSessionId: string | null,
  directive: AgentSessionDirective | null,
  lostSessionId: string,
): AgentSessionDirectiveChange {
  if (persistedSessionId === null) return KEEP;
  if (agentResumeSessionId(persistedSessionId, directive) !== lostSessionId) return KEEP;
  return { kind: "set", directive: { kind: "fresh", basisSessionId: persistedSessionId } };
}

export function agentProviderSessionAfterReport(
  provider: AgentProviderSession,
  reportedSessionId: string | null,
): AgentProviderSession {
  if (reportedSessionId === null || !isAgentSessionId(reportedSessionId)) return provider;
  if (provider.sessionId === reportedSessionId) return provider;
  if (provider.sessionId !== null && provider.kind !== "claudeCode") return provider;
  return { ...provider, sessionId: reportedSessionId };
}

export function isAgentSessionNotFoundText(provider: AgentCliKind, text: string): boolean {
  const bounded =
    text.length > MAX_SESSION_FAILURE_TEXT_CHARS
      ? text.slice(0, MAX_SESSION_FAILURE_TEXT_CHARS)
      : text;
  const normalized = bounded.toLowerCase();
  return sessionNotFoundMarkers(provider).some((marker) => normalized.includes(marker));
}

function sessionNotFoundMarkers(provider: AgentCliKind): ReadonlyArray<string> {
  switch (provider) {
    case "claudeCode":
      return CLAUDE_SESSION_NOT_FOUND_MARKERS;
    case "codex":
      return CODEX_SESSION_NOT_FOUND_MARKERS;
    default:
      return unsupportedProvider(provider);
  }
}

function unsupportedProvider(provider: never): never {
  throw new TypeError(`Unsupported agent provider: ${String(provider)}.`);
}

function agentResumeSessionId(
  persistedSessionId: string | null,
  directive: AgentSessionDirective | null,
): string | null {
  const plan = agentResumePlan(persistedSessionId, directive);
  return plan.kind === "resume" ? plan.sessionId : null;
}

function currentDirective(
  persistedSessionId: string | null,
  directive: AgentSessionDirective | null,
): AgentSessionDirective | null {
  if (directive === null) return null;
  return directive.basisSessionId === persistedSessionId ? directive : null;
}

function adopt(basisSessionId: string, sessionId: string): AgentSessionDirectiveChange {
  return { kind: "set", directive: { kind: "adopted", basisSessionId, sessionId } };
}
