import type { AgentCliKind } from "./agentTask";

export const AGENT_APPROVAL_KINDS = [
  "command",
  "fileChange",
  "tool",
  "plan",
  "mcpElicitation",
] as const;
export type AgentApprovalKind = (typeof AGENT_APPROVAL_KINDS)[number];

export const AGENT_APPROVAL_DECISIONS = ["allowOnce", "allowForSession", "deny"] as const;
export type AgentApprovalDecision = (typeof AGENT_APPROVAL_DECISIONS)[number];

export const AGENT_APPROVAL_STATUSES = [
  "pending",
  "approved",
  "denied",
  "cancelled",
  "expired",
  "timedOut",
] as const;
export type AgentApprovalStatus = (typeof AGENT_APPROVAL_STATUSES)[number];

export interface AgentApprovalFact {
  readonly label: string;
  readonly value: string;
}

interface AgentApprovalRequestBase {
  readonly id: string;
  readonly taskId: string;
  readonly provider: AgentCliKind;
  readonly kind: AgentApprovalKind;
  readonly title: string;
  readonly detail: string;
  readonly detailTruncated: boolean;
  readonly facts: readonly AgentApprovalFact[];
  readonly decisions: readonly AgentApprovalDecision[];
}

export type AgentApprovalRequest = AgentApprovalRequestBase &
  (
    | { readonly status: Exclude<AgentApprovalStatus, "approved" | "denied"> }
    | {
        readonly status: "approved" | "denied";
        readonly decision: AgentApprovalDecision;
      }
  );

export const MAX_AGENT_APPROVALS = 32;
export const MAX_AGENT_APPROVAL_TITLE_BYTES = 256;
export const MAX_AGENT_APPROVAL_DETAIL_BYTES = 16 * 1024;
export const MAX_AGENT_APPROVAL_FACTS = 8;
export const MAX_AGENT_APPROVAL_FACT_LABEL_BYTES = 64;
export const MAX_AGENT_APPROVAL_FACT_VALUE_BYTES = 2048;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const encoder = new TextEncoder();

function invalid(): never {
  throw new Error("Invalid agent approval payload.");
}

function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).length !== fields.length ||
    !fields.every((field) => Object.prototype.hasOwnProperty.call(result, field))
  )
    return invalid();
  return result;
}

function text(value: unknown, maxBytes: number, blank: boolean): string {
  if (
    typeof value !== "string" ||
    value.length > maxBytes ||
    (!blank && value.trim().length === 0) ||
    value.includes("\0") ||
    encoder.encode(value).length > maxBytes
  )
    return invalid();
  return value;
}

function member<T extends string>(value: unknown, members: readonly T[]): T {
  if (typeof value !== "string" || !(members as readonly string[]).includes(value))
    return invalid();
  return value as T;
}

export function agentApprovalId(value: unknown): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) return invalid();
  return value;
}

export function parseAgentApprovalDecision(value: unknown): AgentApprovalDecision {
  return member(value, AGENT_APPROVAL_DECISIONS);
}

function parseFact(value: unknown): AgentApprovalFact {
  const fact = record(value, ["label", "value"]);
  return {
    label: text(fact.label, MAX_AGENT_APPROVAL_FACT_LABEL_BYTES, false),
    value: text(fact.value, MAX_AGENT_APPROVAL_FACT_VALUE_BYTES, true),
  };
}

function parseDecisions(value: unknown): readonly AgentApprovalDecision[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) return invalid();
  const decisions = value.map(parseAgentApprovalDecision);
  if (new Set(decisions).size !== decisions.length || !decisions.includes("deny")) invalid();
  return decisions;
}

export function parseAgentApprovalRequest(value: unknown): AgentApprovalRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  const status = member((value as Record<string, unknown>).status, AGENT_APPROVAL_STATUSES);
  const fields = [
    "id",
    "taskId",
    "provider",
    "kind",
    "title",
    "detail",
    "detailTruncated",
    "facts",
    "decisions",
    "status",
  ];
  const settled = status === "approved" || status === "denied";
  const item = record(value, settled ? [...fields, "decision"] : fields);
  if (typeof item.detailTruncated !== "boolean") invalid();
  if (!Array.isArray(item.facts) || item.facts.length > MAX_AGENT_APPROVAL_FACTS) invalid();
  const base: AgentApprovalRequestBase = {
    id: agentApprovalId(item.id),
    taskId: agentApprovalId(item.taskId),
    provider: member(item.provider, ["codex", "claudeCode"] as const),
    kind: member(item.kind, AGENT_APPROVAL_KINDS),
    title: text(item.title, MAX_AGENT_APPROVAL_TITLE_BYTES, false),
    detail: text(item.detail, MAX_AGENT_APPROVAL_DETAIL_BYTES, true),
    detailTruncated: item.detailTruncated as boolean,
    facts: (item.facts as readonly unknown[]).map(parseFact),
    decisions: parseDecisions(item.decisions),
  };
  if (status === "approved" || status === "denied") {
    const decision = parseAgentApprovalDecision(item.decision);
    if (!base.decisions.includes(decision) || (decision === "deny") !== (status === "denied"))
      invalid();
    return { ...base, status, decision };
  }
  return { ...base, status };
}
