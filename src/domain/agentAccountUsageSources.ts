import type { AgentAccountUsageSnapshot } from "./agentAccountUsage";
import type { AgentCliKind } from "./agentTask";

/** Account sources are private exact-environment keys, never display identities. */
export interface AgentAccountUsageSourcesPort {
  revision(): number;
  observe(source: string, snapshot: AgentAccountUsageSnapshot, queryRevision?: number): boolean;
  invalidate(source: string, provider: AgentCliKind): void;
  read(source: string, provider: AgentCliKind): AgentAccountUsageSnapshot | null;
  subscribe(listener: () => void): () => void;
}
