import type { AgentQuestionRequest, AgentQuestionResponse } from "../domain/agentQuestion";

/** Authority belongs to the coordinator; question cards receive only display data. */
export type AgentQuestionOwner =
  | {
      readonly kind: "local";
      readonly workspaceId: string;
      readonly repositoryRoot: string;
      readonly taskId: string;
    }
  | {
      readonly kind: "remote";
      readonly serverId: string;
      readonly runnerId: string;
      readonly taskId: string;
    };

export interface AgentQuestionGateway {
  list(owner: AgentQuestionOwner): Promise<readonly AgentQuestionRequest[]>;
  answer(
    owner: AgentQuestionOwner,
    requestId: string,
    response: AgentQuestionResponse,
  ): Promise<AgentQuestionRequest>;
}
