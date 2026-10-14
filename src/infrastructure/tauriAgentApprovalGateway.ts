import { invoke } from "@tauri-apps/api/core";
import type { AgentApprovalGateway, AgentApprovalOwner } from "../application/agentApprovalPorts";
import {
  agentApprovalId,
  parseAgentApprovalDecision,
  parseAgentApprovalRequest,
  type AgentApprovalDecision,
  type AgentApprovalRequest,
} from "../domain/agentApproval";
import { agentLocalQuestionAuthority } from "./agentQuestionAuthority";

type Invoke = (command: string, args: { readonly request: unknown }) => Promise<unknown>;

function owned(value: unknown, owner: AgentApprovalOwner): AgentApprovalRequest {
  const result = parseAgentApprovalRequest(value);
  if (result.taskId !== owner.taskId) throw new Error("Approval belongs to another task.");
  return result;
}

export class TauriAgentApprovalGateway implements AgentApprovalGateway {
  constructor(private readonly invokeCommand: Invoke = invoke) {}

  async answerApproval(
    owner: AgentApprovalOwner,
    requestId: string,
    decision: AgentApprovalDecision,
  ): Promise<AgentApprovalRequest> {
    const captured = agentLocalQuestionAuthority(owner);
    const id = agentApprovalId(requestId);
    const validated = parseAgentApprovalDecision(decision);
    const result = owned(
      await this.invokeCommand("answer_agent_approval", {
        request: {
          workspaceId: captured.workspaceId,
          taskId: captured.taskId,
          requestId: id,
          decision: validated,
        },
      }),
      owner,
    );
    if (
      result.id !== id ||
      (result.status !== "approved" && result.status !== "denied") ||
      result.decision !== validated
    )
      throw new Error("Approval decision was not confirmed.");
    return result;
  }
}
