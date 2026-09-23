import { invoke } from "@tauri-apps/api/core";
import type { AgentApprovalDecision, AgentApprovalRequest } from "../domain/agentApproval";
import { TauriAgentApprovalGateway } from "./tauriAgentApprovalGateway";
import {
  agentQuestionAuthority,
  agentQuestionIdentifier as identifier,
} from "./agentQuestionAuthority";
import type { AgentQuestionGateway, AgentQuestionOwner } from "../application/agentQuestionPorts";
import {
  parseAgentQuestionRequest,
  type AgentQuestionRequest,
  type AgentQuestionResponse,
} from "../domain/agentQuestion";

type Invoke = (command: string, args: { readonly request: unknown }) => Promise<unknown>;
function request(value: unknown, owner: AgentQuestionOwner): AgentQuestionRequest {
  const result = parseAgentQuestionRequest(value);
  if (result.taskId !== owner.taskId) throw new Error("Question belongs to another task.");
  return result;
}
function outbound(response: AgentQuestionResponse): AgentQuestionResponse {
  if (
    !response ||
    Object.keys(response).join() !== "answers" ||
    !Array.isArray(response.answers) ||
    response.answers.length < 1 ||
    response.answers.length > 4
  )
    throw new Error("Invalid question response.");
  const ids = new Set<string>();
  for (const answer of response.answers) {
    if (
      !answer ||
      Object.keys(answer).length !== 3 ||
      !["questionId", "optionIds", "text"].every((key) =>
        Object.prototype.hasOwnProperty.call(answer, key),
      )
    )
      throw new Error("Invalid question response.");
    identifier(answer.questionId);
    if (ids.has(answer.questionId)) throw new Error("Duplicate question answer.");
    ids.add(answer.questionId);
    if (
      !Array.isArray(answer.optionIds) ||
      answer.optionIds.length > 12 ||
      new Set(answer.optionIds).size !== answer.optionIds.length ||
      typeof answer.text !== "string" ||
      answer.text.length > 8192 ||
      answer.text.includes("\0") ||
      new TextEncoder().encode(answer.text).length > 8192 ||
      (!answer.optionIds.length && !answer.text.trim())
    )
      throw new Error("Invalid question response.");
    answer.optionIds.forEach(identifier);
  }
  if (new TextEncoder().encode(JSON.stringify(response)).length > 256 * 1024)
    throw new Error("Invalid question response.");
  return response;
}
export class TauriAgentQuestionGateway implements AgentQuestionGateway {
  private readonly approvals: TauriAgentApprovalGateway;
  constructor(private readonly invokeCommand: Invoke = invoke) {
    this.approvals = new TauriAgentApprovalGateway(invokeCommand);
  }
  listApprovals(owner: AgentQuestionOwner): Promise<readonly AgentApprovalRequest[]> {
    return this.approvals.listApprovals(owner);
  }
  answerApproval(
    owner: AgentQuestionOwner,
    requestId: string,
    decision: AgentApprovalDecision,
  ): Promise<AgentApprovalRequest> {
    return this.approvals.answerApproval(owner, requestId, decision);
  }
  async list(owner: AgentQuestionOwner): Promise<readonly AgentQuestionRequest[]> {
    const result = await this.invokeCommand(
      owner.kind === "local" ? "list_agent_questions" : "list_remote_agent_questions",
      { request: agentQuestionAuthority(owner) },
    );
    if (!Array.isArray(result) || result.length > 32) throw new Error("Invalid question list.");
    const requests = result.map((item) => request(item, owner));
    if (new Set(requests.map((item) => item.id)).size !== requests.length)
      throw new Error("Duplicate question.");
    return requests;
  }
  async answer(
    owner: AgentQuestionOwner,
    requestId: string,
    response: AgentQuestionResponse,
  ): Promise<AgentQuestionRequest> {
    const captured = agentQuestionAuthority(owner);
    identifier(requestId);
    const validated = outbound(response);
    const result = request(
      await this.invokeCommand(
        owner.kind === "local" ? "answer_agent_question" : "answer_remote_agent_question",
        { request: { ...captured, requestId, response: validated } },
      ),
      owner,
    );
    if (result.id !== requestId || result.status !== "answered")
      throw new Error("Question answer was not confirmed.");
    return result;
  }
}
