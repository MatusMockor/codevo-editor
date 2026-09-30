import { useEffect, useState } from "react";
import {
  MAX_AGENT_TRANSCRIPT_POSITION_THREADS,
  agentTranscriptTurnPosition,
  boundAgentTranscriptPositionEntries,
  sameAgentTranscriptPosition,
  validAgentTranscriptThreadId,
  type AgentTranscriptPosition,
  type AgentTranscriptPositionEntry,
} from "../domain/agentTranscriptPosition";
import {
  useDebouncedSessionWriter,
  type UseDebouncedSessionWriterOptions,
} from "./useDebouncedSessionWriter";

export interface AgentTranscriptPositionMemory {
  read(threadId: string): AgentTranscriptPosition | null;
  remember(threadId: string, position: AgentTranscriptPosition | null): void;
  snapshot(): ReadonlyArray<AgentTranscriptPositionEntry>;
  hydrate(entries: ReadonlyArray<AgentTranscriptPositionEntry>): void;
  subscribe(listener: () => void): () => void;
}

export interface AgentTranscriptPositionPreferencePort {
  load(): ReadonlyArray<AgentTranscriptPositionEntry>;
  save(entries: ReadonlyArray<AgentTranscriptPositionEntry>): void;
}

export function createAgentTranscriptPositionMemory(
  capacity: number = MAX_AGENT_TRANSCRIPT_POSITION_THREADS,
): AgentTranscriptPositionMemory {
  const limit = Math.max(1, Math.min(MAX_AGENT_TRANSCRIPT_POSITION_THREADS, Math.floor(capacity)));
  const positions = new Map<string, AgentTranscriptPosition>();
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const evictOverflow = (): void => {
    for (const threadId of positions.keys()) {
      if (positions.size <= limit) return;
      positions.delete(threadId);
    }
  };
  const forget = (threadId: string): void => {
    if (!positions.delete(threadId)) return;
    notify();
  };
  return {
    read: (threadId) => positions.get(threadId) ?? null,
    remember(threadId, position) {
      if (!validAgentTranscriptThreadId(threadId)) return;
      if (position === null) return forget(threadId);
      const next = agentTranscriptTurnPosition(position.turnId, position.offsetPx);
      if (next === null) return;
      if (sameAgentTranscriptPosition(positions.get(threadId) ?? null, next)) return;
      positions.delete(threadId);
      positions.set(threadId, next);
      evictOverflow();
      notify();
    },
    snapshot: () => [...positions].map(([threadId, position]) => ({ threadId, position })),
    hydrate(entries) {
      positions.clear();
      for (const entry of boundAgentTranscriptPositionEntries(entries)) {
        positions.set(entry.threadId, entry.position);
      }
      evictOverflow();
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useAgentTranscriptPositionMemory(
  port: AgentTranscriptPositionPreferencePort | null,
  options: UseDebouncedSessionWriterOptions = {},
): AgentTranscriptPositionMemory {
  const [memory] = useState(() => {
    const created = createAgentTranscriptPositionMemory();
    if (port !== null) created.hydrate(port.load());
    return created;
  });
  const writer = useDebouncedSessionWriter(() => {
    if (port === null) return;
    port.save(memory.snapshot());
  }, options);
  useEffect(() => memory.subscribe(writer.schedule), [memory, writer]);
  return memory;
}
