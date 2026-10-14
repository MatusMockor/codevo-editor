import type { AgentApprovalDecision } from "../domain/agentApproval";
import type { AgentQuestionAnswer } from "../domain/agentQuestion";
import type { AgentThreadRequests } from "../domain/agentRuntimeRequest";

export const MAX_REMOTE_AGENT_THREAD_REQUEST_TURNS = 32;

export const REMOTE_AGENT_THREAD_RESPOND_OUTCOMES = [
  "answered",
  "notAnswerable",
  "deliveryUncertain",
] as const;
export type RemoteAgentThreadRespondOutcome = (typeof REMOTE_AGENT_THREAD_RESPOND_OUTCOMES)[number];

export interface RemoteAgentThreadRequestTurn {
  readonly turnId: string;
  readonly startedAtEpochMs: number;
  readonly interactionSequence: number | null;
  readonly terminal: boolean;
}

export interface RemoteAgentThreadRequestsRequest {
  readonly serverId: string;
  readonly runnerId: string;
  readonly threadId: string;
  readonly turns: readonly RemoteAgentThreadRequestTurn[];
  readonly cursor: string | null;
}

export interface RemoteAgentThreadRequestsPage {
  readonly message: AgentThreadRequests;
  readonly nextCursor: string | null;
}

export interface RemoteAgentThreadQuestionResponse {
  readonly kind: "question";
  readonly answers: readonly AgentQuestionAnswer[];
}

export interface RemoteAgentThreadApprovalResponse {
  readonly kind: "approval";
  readonly decision: AgentApprovalDecision;
}

export type RemoteAgentThreadRequestResponse =
  RemoteAgentThreadQuestionResponse | RemoteAgentThreadApprovalResponse;

export interface RemoteAgentThreadRespondRequest {
  readonly serverId: string;
  readonly runnerId: string;
  readonly threadId: string;
  readonly turn: RemoteAgentThreadRequestTurn;
  readonly requestId: string;
  readonly response: RemoteAgentThreadRequestResponse;
}

export type RemoteAgentThreadRespondResult =
  | {
      readonly outcome: "answered";
      readonly message: AgentThreadRequests;
    }
  | {
      readonly outcome: Exclude<RemoteAgentThreadRespondOutcome, "answered">;
      readonly message: AgentThreadRequests | null;
    };

export class RemoteAgentThreadRequestNotSentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteAgentThreadRequestNotSentError";
  }
}

export function isRemoteAgentThreadRequestNotSentError(
  error: unknown,
): error is RemoteAgentThreadRequestNotSentError {
  return error instanceof RemoteAgentThreadRequestNotSentError;
}

export interface RemoteAgentThreadRequestGateway {
  threadRequests(request: RemoteAgentThreadRequestsRequest): Promise<RemoteAgentThreadRequestsPage>;
  respond(request: RemoteAgentThreadRespondRequest): Promise<RemoteAgentThreadRespondResult>;
}
