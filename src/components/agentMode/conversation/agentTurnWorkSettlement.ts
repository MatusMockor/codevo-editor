import type { AgentTurnStatus } from "../../../domain/agentThread";
import { agentToolSettlement, type AgentToolSettlement } from "../agentTurnProjection";

export function savedToolSettlement(status: AgentTurnStatus): AgentToolSettlement {
  const settlement = agentToolSettlement(status);
  return settlement === "running" ? "settled" : settlement;
}
