import type { AgentSubagentLifecycle } from "../domain/agentSubagentLifecycle";
import { NO_AGENT_TURN_LOG_LOSS, type AgentTurnLogScope } from "../domain/agentTurnLog";
import { attempt } from "./agentProjectAuthority";
import type { AgentTurnLogGateway } from "./agentTurnLogPorts";

export interface StoreSettledAgentTurnLifecycleRequest {
  readonly scope: AgentTurnLogScope;
  readonly lifecycle: AgentSubagentLifecycle;
  readonly missingLog?: boolean;
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
      priorLoss: request.missingLog === true ? { kind: "legacyWindow" } : NO_AGENT_TURN_LOG_LOSS,
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
      seal: request.missingLog === true,
      loss: NO_AGENT_TURN_LOG_LOSS,
      lifecycle: request.lifecycle,
    }),
  );
  return stored.ok && ports.owned();
}
