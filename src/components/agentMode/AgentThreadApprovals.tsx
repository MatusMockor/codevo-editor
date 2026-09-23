import type {
  AgentApprovalGateway,
  AgentApprovalOwner,
} from "../../application/agentApprovalPorts";
import { useAgentApprovals } from "../../application/useAgentApprovals";
import { AgentApprovalCard } from "./AgentApprovalCard";
import { presentAgentApproval, visibleAgentApprovals } from "./agentApprovalPresenter";

export function AgentThreadApprovals({
  gateway,
  owner,
  running,
}: {
  readonly gateway: AgentApprovalGateway | null;
  readonly owner: AgentApprovalOwner | null;
  readonly running: boolean;
}) {
  const approvals = useAgentApprovals(gateway, owner, running);
  const visible = visibleAgentApprovals(approvals.requests);
  if (visible.length === 0) return null;
  return (
    <div className="agent-thread-approvals" aria-label="Agent approvals">
      {visible.map((request) => (
        <AgentApprovalCard
          key={`${request.taskId}:${request.id}:${request.status}`}
          view={presentAgentApproval(request)}
          pending={approvals.answering === request.id}
          error={request.status === "pending" ? approvals.error : null}
          onDecide={(decision) => approvals.answer(request.id, decision)}
        />
      ))}
    </div>
  );
}
