import { runningTurn, type AgentThread } from "../domain/agentThread";
import { isAgentInteractionFeed } from "./agentInteractionPorts";
import type { AgentQuestionGateway } from "./agentQuestionPorts";

export async function agentThreadHasPendingInput(
  gateway: AgentQuestionGateway | undefined,
  thread: AgentThread | undefined,
): Promise<boolean> {
  if (!gateway || !isAgentInteractionFeed(gateway)) return false;
  const turn = thread && runningTurn(thread);
  if (!thread || !turn) return true;
  const snapshot = await gateway.currentInteractions({
    workspaceId: thread.owner.ownerId,
    taskId: turn.turnId,
  });
  return snapshot.questions.some((question) => question.status === "pending");
}
