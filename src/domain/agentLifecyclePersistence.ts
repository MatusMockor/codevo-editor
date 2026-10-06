import type { AgentSubagentLifecycle } from "@codevo/agent-events";
import { persistedAgentSubagentLifecycle } from "./agentSubagentLifecycleLegacy";

export function compactPersistedAgentSubagentLifecycle(
  lifecycle: AgentSubagentLifecycle,
): AgentSubagentLifecycle | undefined {
  const legacy = persistedAgentSubagentLifecycle(lifecycle);
  if (legacy === undefined) return undefined;
  if (legacy.entries.length === 0) return undefined;
  return { entries: legacy.entries.slice(-1), truncated: true };
}
