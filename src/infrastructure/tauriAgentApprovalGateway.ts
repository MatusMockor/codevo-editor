import { invoke } from "@tauri-apps/api/core";
import type { AgentApprovalGateway, AgentApprovalOwner } from "../application/agentApprovalPorts";
import {
  MAX_AGENT_APPROVALS,
  agentApprovalId,
  parseAgentApprovalDecision,
  parseAgentApprovalRequest,
  type AgentApprovalDecision,
  type AgentApprovalRequest,
} from "../domain/agentApproval";
import { agentQuestionAuthority } from "./agentQuestionAuthority";

type Invoke = (command: string, args: { readonly request: unknown }) => Promise<unknown>;

function owned(value: unknown, owner: AgentApprovalOwner): AgentApprovalRequest {
  const result = parseAgentApprovalRequest(value);
  if (result.taskId !== owner.taskId) throw new Error("Approval belongs to another task.");
  return result;
}

export class TauriAgentApprovalGateway implements AgentApprovalGateway {
  constructor(private readonly invokeCommand: Invoke = invoke) {}

  async listApprovals(owner: AgentApprovalOwner): Promise<readonly AgentApprovalRequest[]> {
    if (owner.kind === "remote") return [];
    const result = await this.invokeCommand("list_agent_approvals", {
      request: agentQuestionAuthority(owner),
    });
    if (!Array.isArray(result) || result.length > MAX_AGENT_APPROVALS)
      throw new Error("Invalid approval list.");
    const requests = result.map((item) => owned(item, owner));
    if (new Set(requests.map((item) => item.id)).size !== requests.length)
      throw new Error("Duplicate approval.");
    return requests;
  }

  async answerApproval(
    owner: AgentApprovalOwner,
    requestId: string,
    decision: AgentApprovalDecision,
  ): Promise<AgentApprovalRequest> {
    if (owner.kind === "remote") throw new Error("Remote approvals are unavailable.");
    const captured = agentQuestionAuthority(owner);
    const id = agentApprovalId(requestId);
    const validated = parseAgentApprovalDecision(decision);
    const result = owned(
      await this.invokeCommand("answer_agent_approval", {
        request: { ...captured, requestId: id, decision: validated },
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
