import type { AgentSubagentLifecycle } from "../domain/agentSubagentLifecycle";
import {
  NO_AGENT_TURN_LOG_LOSS,
  type AgentTurnLogLoss,
  type AgentTurnLogScope,
} from "../domain/agentTurnLog";
import { attempt } from "./agentProjectAuthority";
import type { AgentTurnLogGateway } from "./agentTurnLogPorts";

export type SettledAgentTurnHistory = "recorded" | "preLog";

export interface StoreSettledAgentTurnLifecycleRequest {
  readonly scope: AgentTurnLogScope;
  readonly lifecycle: AgentSubagentLifecycle;
  readonly history: SettledAgentTurnHistory;
}

export interface SettledAgentTurnLifecyclePorts {
  readonly gateway: AgentTurnLogGateway;
  readonly owned: () => boolean;
}

export async function storeSettledAgentTurnLifecycle(
  ports: SettledAgentTurnLifecyclePorts,
  request: StoreSettledAgentTurnLifecycleRequest,
): Promise<boolean> {
  if (!ports.owned()) return false;
  const opened = await attempt(() =>
    ports.gateway.openTurnLog({
      scope: request.scope,
      priorLoss: settledAgentTurnPriorLoss(request.history),
      prompt: null,
    }),
  );
  if (!opened.ok) return false;
  if (!ports.owned()) return false;
  const stored = await attempt(() =>
    ports.gateway.appendTurnLog({
      scope: request.scope,
      writerEpoch: opened.value.writerEpoch,
      expectedNextSeq: opened.value.nextSeq,
      ops: [],
      digest: null,
      seal: request.history === "preLog",
      loss: NO_AGENT_TURN_LOG_LOSS,
      lifecycle: request.lifecycle,
    }),
  );
  return stored.ok && ports.owned();
}

export function settledAgentTurnPriorLoss(history: SettledAgentTurnHistory): AgentTurnLogLoss {
  switch (history) {
    case "recorded":
      return NO_AGENT_TURN_LOG_LOSS;
    case "preLog":
      return { kind: "legacyWindow" };
    default:
      return unsupportedSettledAgentTurnHistory(history);
  }
}

function unsupportedSettledAgentTurnHistory(history: never): never {
  throw new TypeError(`Unsupported settled agent turn history: ${JSON.stringify(history)}.`);
}
