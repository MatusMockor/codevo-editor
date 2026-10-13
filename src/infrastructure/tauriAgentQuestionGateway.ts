import { invoke } from "@tauri-apps/api/core";
import type { AgentApprovalGateway } from "../application/agentApprovalPorts";
import type {
  AgentInteractionFeed,
  AgentInteractionOwner,
} from "../application/agentInteractionPorts";
import type {
  AgentQuestionGateway,
  AgentQuestionOwner,
  AgentRemoteQuestionOwner,
} from "../application/agentQuestionPorts";
import type { AgentApprovalDecision, AgentApprovalRequest } from "../domain/agentApproval";
import type { AgentInteractionSnapshot } from "../domain/agentInteractionSnapshot";
import {
  parseAgentQuestionRequest,
  type AgentQuestionRequest,
  type AgentQuestionResponse,
} from "../domain/agentQuestion";
import {
  agentQuestionAuthority,
  agentQuestionIdentifier as identifier,
  agentRemoteQuestionAuthority,
} from "./agentQuestionAuthority";
import { TauriAgentApprovalGateway } from "./tauriAgentApprovalGateway";
import {
  TauriAgentInteractionFeed,
  type AgentInteractionRuntimeDetector,
  type ListenToAgentInteractionEvent,
} from "./tauriAgentInteractionFeed";

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
export class TauriAgentQuestionGateway
  implements AgentQuestionGateway, AgentApprovalGateway, AgentInteractionFeed
{
  private readonly approvals: TauriAgentApprovalGateway;
  private readonly interactions: TauriAgentInteractionFeed;
  constructor(
    private readonly invokeCommand: Invoke = invoke,
    listenToEvent?: ListenToAgentInteractionEvent,
    isRuntimeAvailable?: AgentInteractionRuntimeDetector,
  ) {
    this.approvals = new TauriAgentApprovalGateway(invokeCommand);
    this.interactions = new TauriAgentInteractionFeed(
      invokeCommand,
      listenToEvent,
      isRuntimeAvailable,
    );
  }
  currentInteractions(owner: AgentInteractionOwner): Promise<AgentInteractionSnapshot> {
    return this.interactions.currentInteractions(owner);
  }
  subscribeInteractions(
    handler: (snapshot: AgentInteractionSnapshot) => void,
  ): Promise<() => void> {
    return this.interactions.subscribeInteractions(handler);
  }
  answerApproval(
    owner: AgentQuestionOwner,
    requestId: string,
    decision: AgentApprovalDecision,
  ): Promise<AgentApprovalRequest> {
    return this.approvals.answerApproval(owner, requestId, decision);
  }
  async list(owner: AgentRemoteQuestionOwner): Promise<readonly AgentQuestionRequest[]> {
    const result = await this.invokeCommand("list_remote_agent_questions", {
      request: agentRemoteQuestionAuthority(owner),
    });
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
