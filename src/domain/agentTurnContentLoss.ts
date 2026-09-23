import type { AgentTurnLogLoss } from "./agentTurnLog";

export type AgentTurnLogHydration = "notAttempted" | "running" | "complete" | "partial" | "failed";

export interface AgentTurnLogEvidence {
  readonly loss: AgentTurnLogLoss;
  readonly sealed: boolean;
  readonly live: boolean;
  readonly hydration: AgentTurnLogHydration;
}

export type AgentTurnWindowDisplay = "complete" | "lost" | "savedNotShown";

export type AgentTurnLogEvidenceLookup = (turnId: string) => AgentTurnLogEvidence | null;

export const NO_AGENT_TURN_LOG_EVIDENCE: AgentTurnLogEvidenceLookup = () => null;

export function agentTurnLogProvablyComplete(evidence: AgentTurnLogEvidence): boolean {
  if (evidence.loss.kind !== "none") return false;
  if (evidence.sealed) return true;
  return evidence.live;
}

export function agentTurnContentLost(
  eventsTruncated: boolean,
  evidence: AgentTurnLogEvidence | null,
): boolean {
  if (evidence === null) return eventsTruncated;
  if (agentTurnLogLossVisible(evidence.loss, eventsTruncated)) return true;
  if (!eventsTruncated) return false;
  return !agentTurnLogProvablyComplete(evidence);
}

function agentTurnLogLossVisible(loss: AgentTurnLogLoss, eventsTruncated: boolean): boolean {
  switch (loss.kind) {
    case "none":
      return false;
    case "legacyWindow":
      return eventsTruncated;
    case "supervisorGap":
    case "turnCeiling":
    case "unreadable":
    case "diskBudget":
      return true;
    default:
      return unsupportedAgentTurnLogLoss(loss);
  }
}

export function agentTurnWindowDisplay(
  eventsTruncated: boolean,
  evidence: AgentTurnLogEvidence | null,
): AgentTurnWindowDisplay {
  if (agentTurnContentLost(eventsTruncated, evidence)) return "lost";
  if (!eventsTruncated) return "complete";
  if (evidence !== null && evidence.hydration === "complete") return "complete";
  return "savedNotShown";
}

function unsupportedAgentTurnLogLoss(loss: never): never {
  throw new TypeError(`Unsupported agent turn log loss: ${JSON.stringify(loss)}.`);
}
