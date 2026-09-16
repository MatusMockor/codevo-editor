import type { AgentThreadView } from "./agentThreadPorts";
import type { AgentQuestionOwner } from "./agentQuestionPorts";
import { runningTurn } from "../domain/agentThread";

export function agentQuestionOwner(view: AgentThreadView | null): AgentQuestionOwner | null {
  if (!view) return null;
  if (view.execution?.kind === "remote") {
    if (!view.execution.interactiveQuestions) return null;
    const { serverId, runnerId, latestTaskId } = view.execution;
    return { kind: "remote", serverId, runnerId, taskId: latestTaskId };
  }
  const turn = runningTurn(view.thread) ?? view.thread.turns[view.thread.turns.length - 1];
  if (!turn || (view.thread.provider.kind === "codex" && turn.codexTransport !== "appServer"))
    return null;
  return {
    kind: "local",
    workspaceId: view.thread.owner.ownerId,
    repositoryRoot: view.thread.owner.repositoryRoot,
    taskId: turn.turnId,
  };
}
