import type { AgentApprovalDecision } from "../domain/agentApproval";
import type { AgentQuestionAnswer } from "../domain/agentQuestion";
import type { AgentRuntimeRequest } from "../domain/agentRuntimeRequest";
import type { AgentApprovalGateway } from "./agentApprovalPorts";
import type { AgentLocalQuestionOwner, AgentQuestionGateway } from "./agentQuestionPorts";
import type { AgentThreadRequestScope } from "./agentThreadRequestPorts";
import type {
  RemoteAgentThreadRequestConfirmation,
  RemoteAgentThreadRequestRespondOutcome,
} from "./remoteAgentThreadRequestFeed";
import type { RemoteAgentThreadRequestResponse } from "./remoteAgentThreadRequestPorts";
import type { RemoteAgentThreadRequestControl } from "./unifiedAgentThreadRequestFeed";

export type AgentThreadRequestReply =
  | { readonly kind: "question"; readonly answers: readonly AgentQuestionAnswer[] }
  | { readonly kind: "approval"; readonly decision: AgentApprovalDecision };

export type AgentThreadRequestDelivery =
  RemoteAgentThreadRequestRespondOutcome | { readonly kind: "notSent"; readonly reason: "failed" };

export interface AgentThreadRequestResponder {
  respond(
    request: AgentRuntimeRequest,
    reply: AgentThreadRequestReply,
  ): Promise<AgentThreadRequestDelivery>;
  reconfirm(request: AgentRuntimeRequest): Promise<RemoteAgentThreadRequestConfirmation>;
}

const ANSWERED: AgentThreadRequestDelivery = Object.freeze({ kind: "answered" });
const FAILED: AgentThreadRequestDelivery = Object.freeze({ kind: "notSent", reason: "failed" });
const REFUSED: AgentThreadRequestDelivery = Object.freeze({ kind: "notSent", reason: "refused" });
const UNCONFIRMED: RemoteAgentThreadRequestConfirmation = "unconfirmed";

export function localAgentThreadRequestResponder(
  gateway: AgentQuestionGateway & AgentApprovalGateway,
  workspaceId: string,
): AgentThreadRequestResponder {
  return {
    reconfirm: () => Promise.resolve(UNCONFIRMED),
    respond: async (request, reply) => {
      const owner: AgentLocalQuestionOwner = { kind: "local", workspaceId, taskId: request.turnId };
      try {
        await sendLocally(gateway, owner, request.id, reply);
        return ANSWERED;
      } catch {
        return FAILED;
      }
    },
  };
}

export function remoteAgentThreadRequestResponder(
  control: RemoteAgentThreadRequestControl,
  scope: AgentThreadRequestScope,
): AgentThreadRequestResponder {
  return {
    respond: (request, reply) => {
      const response = remoteResponse(request, reply);
      if (response === null) return Promise.resolve(REFUSED);
      return control.respond(scope, request.turnId, request.id, response);
    },
    reconfirm: (request) => control.confirm(scope, request.turnId, request.id),
  };
}

function remoteResponse(
  request: AgentRuntimeRequest,
  reply: AgentThreadRequestReply,
): RemoteAgentThreadRequestResponse | null {
  const kind = reply.kind;
  switch (kind) {
    case "question":
      if (request.body.kind !== "question") return null;
      return { kind, answers: reply.answers };
    case "approval":
      if (request.body.kind !== "approval") return null;
      if (!request.body.decisions.includes(reply.decision)) return null;
      return { kind, decision: reply.decision };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

async function sendLocally(
  gateway: AgentQuestionGateway & AgentApprovalGateway,
  owner: AgentLocalQuestionOwner,
  requestId: string,
  reply: AgentThreadRequestReply,
): Promise<void> {
  const kind = reply.kind;
  switch (kind) {
    case "question":
      await gateway.answer(owner, requestId, { answers: reply.answers });
      return;
    case "approval":
      await gateway.answerApproval(owner, requestId, reply.decision);
      return;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}
