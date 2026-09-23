import {
  agentResumePlan,
  agentSessionDirectiveAfterLoss,
  agentSessionDirectiveAfterReport,
  type AgentResumePlan,
  type AgentSessionDirective,
  type AgentSessionDirectiveChange,
  type AgentSessionReport,
} from "../domain/agentSessionIdentity";
import type { AgentThread } from "../domain/agentThread";

export const MAX_AGENT_SESSION_DIRECTIVES = 256;

export interface AgentSessionContinuity {
  resumePlan(thread: AgentThread): AgentResumePlan;
  noteReport(thread: AgentThread, report: AgentSessionReport): AgentSessionDirectiveChange;
  noteLoss(thread: AgentThread, lostSessionId: string): AgentSessionDirectiveChange;
}

export function createAgentSessionContinuity(
  capacity: number = MAX_AGENT_SESSION_DIRECTIVES,
): AgentSessionContinuity {
  const directives = new Map<string, AgentSessionDirective>();

  const directiveOf = (thread: AgentThread): AgentSessionDirective | null =>
    directives.get(thread.threadId) ?? null;

  const apply = (
    thread: AgentThread,
    change: AgentSessionDirectiveChange,
  ): AgentSessionDirectiveChange => {
    switch (change.kind) {
      case "keep":
        return change;
      case "clear":
        directives.delete(thread.threadId);
        return change;
      case "set":
        directives.delete(thread.threadId);
        directives.set(thread.threadId, change.directive);
        evictOldest(directives, capacity);
        return change;
      default:
        return unsupportedDirectiveChange(change);
    }
  };

  return {
    resumePlan: (thread) => {
      const directive = directiveOf(thread);
      if (thread.provider.sessionId === null && directive?.kind === "fresh")
        return { kind: "fresh", reason: "sessionLost" };
      return agentResumePlan(thread.provider.sessionId, directive);
    },
    noteReport: (thread, report) =>
      apply(
        thread,
        agentSessionDirectiveAfterReport(thread.provider.sessionId, directiveOf(thread), report),
      ),
    noteLoss: (thread, lostSessionId) =>
      apply(
        thread,
        agentSessionDirectiveAfterLoss(
          thread.provider.sessionId,
          directiveOf(thread),
          lostSessionId,
        ),
      ),
  };
}

function evictOldest(directives: Map<string, AgentSessionDirective>, capacity: number): void {
  for (const threadId of directives.keys()) {
    if (directives.size <= capacity) return;
    directives.delete(threadId);
  }
}

function unsupportedDirectiveChange(change: never): never {
  throw new TypeError(`Unsupported session directive change: ${JSON.stringify(change)}.`);
}
