import type { AgentArtifactLoader } from "../application/agentArtifactPorts";
import { isTerminalAgentTurnStatus, type AgentThread } from "../domain/agentThread";
import { agentTurnArtifactReferences } from "../domain/agentTurnArtifactReferences";

/** Save immutable output snapshots before persistence settles and continuation is admitted. */
export async function captureLocalAgentArtifacts(
  loader: AgentArtifactLoader,
  thread: AgentThread,
): Promise<void> {
  const turn = thread.turns[thread.turns.length - 1];
  if (turn === undefined || !isTerminalAgentTurnStatus(turn.status)) return;
  const owner = {
    kind: "local" as const,
    ...thread.owner,
    threadId: thread.threadId,
    turnId: turn.turnId,
  };
  // Sequential native reads bound memory and disk pressure. Missing/invalid files stay
  // unavailable in the artifact UI; they must not prevent continuing a conversation.
  for (const reference of agentTurnArtifactReferences(turn)) {
    try {
      await loader.resolve(owner, reference.path);
    } catch {
      // The native resolver never maps an older missing snapshot to a newer file.
    }
  }
}
