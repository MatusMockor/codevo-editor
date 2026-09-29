import type { AgentThread } from "../domain/agentThread";
import type { AgentTaskStatusEvent } from "../domain/agentTask";
import type { AgentResumePlan } from "../domain/agentSessionIdentity";
import { warning } from "./agentProjectAuthority";
import type { AgentSessionContinuity } from "./agentSessionContinuity";
import type { AgentTasksNotice, AgentThreadStoreSurface } from "./agentThreadPorts";
import {
  AGENT_RESUME_REJECTED_NOTICE,
  AGENT_SESSION_LOST_NOTICE,
  agentFreshSessionNotice,
} from "./agentTurnDispatchPolicy";
import {
  agentSessionLost,
  resumeRejected,
  sessionChangeNotice,
  type AgentTurnOutputStream,
} from "./agentTurnOutputStream";

export interface AgentTurnSessionReportDependencies {
  readonly store: Pick<AgentThreadStoreSurface, "currentState" | "dispatchAction">;
  readonly setNotice: (notice: AgentTasksNotice | null) => void;
}

export function noteSessionReport(
  deps: AgentTurnSessionReportDependencies,
  continuity: AgentSessionContinuity,
  stream: AgentTurnOutputStream,
  sessionId: string | null,
  warned: Set<string>,
): void {
  if (sessionId === null) return;
  const state = deps.store.currentState();
  const thread = ownedStreamThread(state.threads.get(stream.threadId), stream);
  if (thread === null) return;
  const change = continuity.noteReport(thread, {
    provider: thread.provider.kind,
    resumedSessionId: stream.resumedSessionId,
    reportedSessionId: sessionId,
  });
  if (change.kind !== "keep") return;
  const notice = sessionChangeNotice(state, stream.threadId, sessionId);
  if (notice === null || warned.has(stream.threadId)) return;
  warned.add(stream.threadId);
  deps.setNotice(notice);
}

export function noteResumeFailure(
  deps: AgentTurnSessionReportDependencies,
  continuity: AgentSessionContinuity,
  stream: AgentTurnOutputStream,
  event: AgentTaskStatusEvent,
): void {
  if (agentSessionLost(stream, event) && stream.resumedSessionId !== null) {
    const thread = ownedStreamThread(
      deps.store.currentState().threads.get(stream.threadId),
      stream,
    );
    if (thread === null) return;
    continuity.noteLoss(thread, stream.resumedSessionId);
    deps.store.dispatchAction({
      kind: "providerSessionInvalidated",
      threadId: thread.threadId,
      owner: thread.owner,
      sessionId: stream.resumedSessionId,
    });
    deps.setNotice(warning(AGENT_SESSION_LOST_NOTICE));
    return;
  }
  if (resumeRejected(stream, event)) deps.setNotice(warning(AGENT_RESUME_REJECTED_NOTICE));
}

export function followUpStartedNotice(
  resumePlan: AgentResumePlan,
  attachmentNotice: AgentTasksNotice | null,
): AgentTasksNotice | null {
  if (resumePlan.kind !== "fresh") return attachmentNotice;
  const fresh = agentFreshSessionNotice(resumePlan.reason);
  if (attachmentNotice === null) return warning(fresh);
  return warning(`${fresh} ${attachmentNotice.message}`);
}

export function ownedStreamThread(
  thread: AgentThread | undefined,
  stream: AgentTurnOutputStream,
): AgentThread | null {
  if (thread === undefined || thread.owner.ownerId !== stream.ownerId) return null;
  if (thread.owner.repositoryRoot !== stream.repositoryRoot) return null;
  return thread.turns.some((turn) => turn.turnId === stream.turnId) ? thread : null;
}
