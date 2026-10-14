import type { AgentQuestionRequest, AgentQuestionResponse } from "../domain/agentQuestion";

export interface AgentLocalQuestionOwner {
  readonly kind: "local";
  readonly workspaceId: string;
  readonly taskId: string;
}

export interface AgentRemoteQuestionOwner {
  readonly kind: "remote";
  readonly serverId: string;
  readonly runnerId: string;
  readonly taskId: string;
}

/** Authority belongs to the coordinator; question cards receive only display data. */
export type AgentQuestionOwner = AgentLocalQuestionOwner | AgentRemoteQuestionOwner;

export interface AgentQuestionGateway {
  answer(
    owner: AgentQuestionOwner,
    requestId: string,
    response: AgentQuestionResponse,
  ): Promise<AgentQuestionRequest>;
}
