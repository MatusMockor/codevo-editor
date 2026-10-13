import { useMemo } from "react";
import type { AgentApprovalGateway, AgentApprovalOwner } from "./agentApprovalPorts";
import { isAgentInteractionFeed } from "./agentInteractionPorts";
import { agentInteractionStore } from "./agentInteractionStore";
import {
  sameAgentPendingRequestItems,
  type AgentPendingRequestAvailability,
} from "./agentPendingRequestPolling";
import { pushedAgentPendingRequestSource } from "./agentPendingRequestSource";
import {
  useAgentPendingRequests,
  type AgentPendingRequestBinding,
} from "./useAgentPendingRequests";
import type {
  AgentApprovalDecision,
  AgentApprovalFact,
  AgentApprovalRequest,
} from "../domain/agentApproval";

type ApprovalBinding = AgentPendingRequestBinding<AgentApprovalRequest, AgentApprovalDecision>;

const APPROVALS_UNAVAILABLE_NOTICE = "Approvals from this agent can't be shown right now.";
const DECISION_FAILURE_NOTICE =
  "The decision could not be confirmed. It may have expired; retry to check.";

export interface AgentApprovalsSurface {
  readonly requests: readonly AgentApprovalRequest[];
  readonly answering: string | null;
  readonly error: string | null;
  answer(requestId: string, decision: AgentApprovalDecision): Promise<void>;
}

export function useAgentApprovals(
  gateway: AgentApprovalGateway | null,
  owner: AgentApprovalOwner | null,
  _running: boolean,
  availability: AgentPendingRequestAvailability = "available",
): AgentApprovalsSurface {
  const binding = useMemo(() => approvalBinding(gateway, owner), [gateway, owner]);
  return useAgentPendingRequests(binding, availability);
}

function approvalBinding(
  gateway: AgentApprovalGateway | null,
  owner: AgentApprovalOwner | null,
): ApprovalBinding | null {
  if (!gateway || !owner || owner.kind === "remote" || !isAgentInteractionFeed(gateway))
    return null;
  return {
    source: pushedAgentPendingRequestSource({
      store: agentInteractionStore(gateway),
      owner: { workspaceId: owner.workspaceId, taskId: owner.taskId },
      unreachableNotice: APPROVALS_UNAVAILABLE_NOTICE,
      select: (snapshot) => snapshot.approvals,
    }),
    answerFailureNotice: DECISION_FAILURE_NOTICE,
    sameRequest: sameApprovalRequest,
    admit: (request, decision) => (request.decisions.includes(decision) ? decision : null),
    send: (requestId, decision) => gateway.answerApproval(owner, requestId, decision),
  };
}

function sameApprovalRequest(left: AgentApprovalRequest, right: AgentApprovalRequest): boolean {
  return (
    left.id === right.id &&
    left.status === right.status &&
    left.taskId === right.taskId &&
    left.provider === right.provider &&
    left.kind === right.kind &&
    approvalDecision(left) === approvalDecision(right) &&
    left.detailTruncated === right.detailTruncated &&
    left.title === right.title &&
    left.detail === right.detail &&
    sameAgentPendingRequestItems(left.decisions, right.decisions, Object.is) &&
    sameAgentPendingRequestItems(left.facts, right.facts, sameApprovalFact)
  );
}

function approvalDecision(request: AgentApprovalRequest): AgentApprovalDecision | null {
  if (request.status !== "approved" && request.status !== "denied") return null;
  return request.decision;
}

function sameApprovalFact(left: AgentApprovalFact, right: AgentApprovalFact): boolean {
  return left.label === right.label && left.value === right.value;
}
