import {
  agentTurnLogEvidence,
  type AgentTurnLogFacts,
} from "../../application/agentTurnLogStatusStore";
import { agentTurnWindowDisplay } from "../../domain/agentTurnContentLoss";
import type { AgentTurnLogLoss } from "../../domain/agentTurnLog";

export const AGENT_TURN_WINDOW_NOTICE = "Some activity from this turn is not shown.";
export const AGENT_TURN_LOG_SAVED_NOT_SHOWN_NOTICE =
  "Earlier activity of this turn is saved but not shown here yet.";
export const AGENT_TURN_LOG_UNSAVED_PREFIX = "Activity is not being saved to disk";

export interface AgentTurnLogNoticeModel {
  readonly loss: string | null;
  readonly unsaved: string | null;
}

export function agentTurnLogNoticeModel(
  facts: AgentTurnLogFacts | null,
  eventsTruncated: boolean,
): AgentTurnLogNoticeModel {
  return {
    loss: agentTurnLossNotice(facts, eventsTruncated),
    unsaved: agentTurnUnsavedNotice(facts),
  };
}

export function agentTurnLossNotice(
  facts: AgentTurnLogFacts | null,
  eventsTruncated: boolean,
): string | null {
  const evidence = agentTurnLogEvidence(facts);
  if (evidence === null) return eventsTruncated ? AGENT_TURN_WINDOW_NOTICE : null;
  const display = agentTurnWindowDisplay(eventsTruncated, evidence);
  if (display === "complete") return null;
  if (display === "savedNotShown") return AGENT_TURN_LOG_SAVED_NOT_SHOWN_NOTICE;
  return (
    agentTurnLogLossNotice(evidence.loss) ?? (eventsTruncated ? AGENT_TURN_WINDOW_NOTICE : null)
  );
}

export function agentTurnLogLossNotice(loss: AgentTurnLogLoss): string | null {
  switch (loss.kind) {
    case "none":
      return null;
    case "legacyWindow":
      return "Part of this turn ran before full transcripts were kept, so some activity is gone.";
    case "supervisorGap":
      return "Some activity from this turn was too large to record and is not shown.";
    case "turnCeiling":
      return "This turn reached its recording limit, so later activity was not saved.";
    case "unreadable":
      return "The saved activity for this turn could not be read, so some of it is not shown.";
    case "diskBudget":
      return "Older activity from this turn was removed to free disk space.";
    default:
      return unsupportedAgentTurnLogLoss(loss);
  }
}

export function agentTurnUnsavedNotice(facts: AgentTurnLogFacts | null): string | null {
  if (facts === null) return null;
  if (facts.health.kind !== "degraded") return null;
  return `${AGENT_TURN_LOG_UNSAVED_PREFIX}: ${facts.health.reason}.`;
}

function unsupportedAgentTurnLogLoss(loss: never): never {
  throw new TypeError(`Unsupported agent turn log loss: ${JSON.stringify(loss)}.`);
}
