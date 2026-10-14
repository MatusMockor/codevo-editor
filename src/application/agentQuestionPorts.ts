import type { AgentQuestionRequest, AgentQuestionResponse } from "../domain/agentQuestion";

export interface AgentLocalQuestionOwner {
  readonly kind: "local";
  readonly workspaceId: string;
  readonly taskId: string;
}

export interface AgentQuestionGateway {
  answer(
    owner: AgentLocalQuestionOwner,
    requestId: string,
    response: AgentQuestionResponse,
  ): Promise<AgentQuestionRequest>;
}
