import { createContext, useContext } from "react";
import type { AgentTranscriptPositionMemory } from "../../application/agentTranscriptPositionMemory";

export const AgentTranscriptPositionMemoryContext =
  createContext<AgentTranscriptPositionMemory | null>(null);

export function useAgentTranscriptPositionMemoryContext(): AgentTranscriptPositionMemory | null {
  return useContext(AgentTranscriptPositionMemoryContext);
}
