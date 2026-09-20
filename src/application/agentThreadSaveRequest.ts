import { agentRootOwnerId } from "../domain/agentProject";
import type { AgentSubagentLifecycle } from "../domain/agentSubagentLifecycle";
import type { AgentThread } from "../domain/agentThread";
import type { SaveAgentThreadRequest } from "./agentThreadPorts";
import type { AgentTurnLogFactsSource } from "./agentTurnLogStatusStore";

/** Exact acknowledged snapshots are internal evidence, never extra wire fields. */
export function persistentAgentThreadSaveRequest(
  thread: AgentThread,
  facts: AgentTurnLogFactsSource | undefined,
): SaveAgentThreadRequest {
  const ownerId = agentRootOwnerId(thread.owner.rootKey);
  const loggedLifecycles = new Map<string, AgentSubagentLifecycle>();
  for (const turn of thread.turns) {
    if (facts?.threadIdOf(turn.turnId) !== thread.threadId) continue;
    const lifecycle = facts.factsOf(turn.turnId)?.lifecycleInLog;
    if (lifecycle != null) loggedLifecycles.set(turn.turnId, lifecycle);
  }
  return {
    rootKey: thread.owner.rootKey,
    ownerId,
    thread: { ...thread, owner: { ...thread.owner, ownerId } },
    loggedPromptTurnIds: [...(facts?.promptLoggedTurnIds(thread.threadId) ?? [])],
    ...(loggedLifecycles.size === 0 ? {} : { loggedLifecycles }),
  };
}
