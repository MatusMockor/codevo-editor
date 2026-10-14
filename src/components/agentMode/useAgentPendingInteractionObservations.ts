import { useContext } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  useAgentPendingInteractionObservations as useFeedPendingInteractionObservations,
  type AgentPendingInteractionObservations,
} from "../../application/useAgentPendingInteractions";
import { AgentThreadRequestFeedContext } from "./agentThreadRequestFeedContext";

export function useAgentPendingInteractionObservations(
  views: ReadonlyArray<AgentThreadView>,
  pinnedThreadId: string | null,
): AgentPendingInteractionObservations {
  const feed = useContext(AgentThreadRequestFeedContext);
  return useFeedPendingInteractionObservations(feed, views, pinnedThreadId);
}
