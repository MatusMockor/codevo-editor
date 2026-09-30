import type { ReactNode } from "react";
import type { AgentTranscriptPositionMemory } from "../../application/agentTranscriptPositionMemory";
import { AgentTranscriptPositionMemoryContext } from "./agentTranscriptPositionMemoryContext";

export interface AgentTranscriptPositionProviderProps {
  readonly value: AgentTranscriptPositionMemory | null;
  readonly children?: ReactNode;
}

export function AgentTranscriptPositionProvider({
  value,
  children,
}: AgentTranscriptPositionProviderProps) {
  return (
    <AgentTranscriptPositionMemoryContext.Provider value={value}>
      {children}
    </AgentTranscriptPositionMemoryContext.Provider>
  );
}
