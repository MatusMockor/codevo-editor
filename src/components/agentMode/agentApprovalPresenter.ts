import type {
  AgentApprovalDecision,
  AgentApprovalFact,
  AgentApprovalKind,
  AgentApprovalRequest,
} from "../../domain/agentApproval";

export type AgentApprovalActionTone = "primary" | "secondary" | "danger";

export interface AgentApprovalAction {
  readonly decision: AgentApprovalDecision;
  readonly label: string;
  readonly tone: AgentApprovalActionTone;
}

export interface AgentApprovalView {
  readonly id: string;
  readonly pending: boolean;
  readonly title: string;
  readonly providerLabel: string;
  readonly detailLabel: string;
  readonly detail: string;
  readonly truncatedNote: string | null;
  readonly facts: readonly AgentApprovalFact[];
  readonly actions: readonly AgentApprovalAction[];
  readonly statusText: string;
}

const DETAIL_LABEL: Record<AgentApprovalKind, string> = {
  command: "Command",
  fileChange: "Change",
  tool: "Tool input",
  plan: "Plan",
  mcpElicitation: "Message",
};

function actionLabel(kind: AgentApprovalKind, decision: AgentApprovalDecision): string {
  if (kind === "plan") return decision === "deny" ? "Keep planning" : "Approve plan";
  if (kind === "mcpElicitation") return decision === "deny" ? "Decline" : "Accept";
  switch (decision) {
    case "allowOnce":
      return "Allow once";
    case "allowForSession":
      return "Allow for this session";
    case "deny":
      return "Deny";
    default: {
      const unreachable: never = decision;
      return unreachable;
    }
  }
}

function tone(decision: AgentApprovalDecision): AgentApprovalActionTone {
  switch (decision) {
    case "allowOnce":
      return "primary";
    case "allowForSession":
      return "secondary";
    case "deny":
      return "danger";
    default: {
      const unreachable: never = decision;
      return unreachable;
    }
  }
}

function statusText(request: AgentApprovalRequest): string {
  const plan = request.kind === "plan";
  switch (request.status) {
    case "pending":
      return plan ? "Waiting for you to review the plan" : "Waiting for your approval";
    case "approved":
      if (plan) return "Plan approved";
      return request.decision === "allowForSession" ? "Allowed for this session" : "Allowed once";
    case "denied":
      return plan ? "Kept planning" : "Denied";
    case "cancelled":
      return "The agent withdrew this request.";
    case "expired":
      return "This request expired. The run is no longer waiting for it.";
    case "timedOut":
      return "No decision was made in time, so the agent was told no.";
    default: {
      const unreachable: never = request;
      return unreachable;
    }
  }
}

export function presentAgentApproval(request: AgentApprovalRequest): AgentApprovalView {
  const pending = request.status === "pending";
  return {
    id: request.id,
    pending,
    title: request.title,
    providerLabel: request.provider === "codex" ? "Codex" : "Claude Code",
    detailLabel:
      request.kind === "fileChange" && request.provider === "codex"
        ? "Files"
        : DETAIL_LABEL[request.kind],
    detail: request.detail,
    truncatedNote: request.detailTruncated ? "Shortened for display." : null,
    facts: request.facts,
    actions: pending
      ? request.decisions.map((decision) => ({
          decision,
          label: actionLabel(request.kind, decision),
          tone: tone(decision),
        }))
      : [],
    statusText: statusText(request),
  };
}

export function visibleAgentApprovals(
  requests: readonly AgentApprovalRequest[],
): readonly AgentApprovalRequest[] {
  const pending = requests.filter((request) => request.status === "pending");
  if (pending.length > 0) return pending;
  const last = requests[requests.length - 1];
  if (!last || last.status === "approved" || last.status === "denied") return [];
  return [last];
}
