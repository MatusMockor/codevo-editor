import type { AgentSessionRestartPolicy } from "../domain/agentTask";
import { AGENT_TASKS_SOURCE, attempt, failure } from "./agentProjectAuthority";
import type { DeferredRestartRefusals } from "./agentSessionRestartConsent";
import type { AgentFollowUpRequest, AgentTasksNotice } from "./agentThreadPorts";
import type { ClaimedTurnAttachments } from "./agentTurnAttachments";

export const DEFERRED_SEND_FAILED_NOTICE =
  "Queued messages could not be sent. The queue is paused; review the thread before resuming.";

export type DeferredSendOutcome = "sent" | "failed" | "stale";

export type DeferredFollowUpSender = (
  request: AgentFollowUpRequest,
  isCurrent?: () => boolean,
  prepared?: ClaimedTurnAttachments,
) => Promise<boolean>;

export interface DeferredFollowUpNoticePorts {
  readonly reportError: (source: string, error: unknown) => void;
  readonly setNotice: (notice: AgentTasksNotice | null) => void;
}

export interface DeferredFollowUpSend {
  readonly send: DeferredFollowUpSender;
  readonly needsSessionRestart: (threadId: string) => boolean;
  readonly refusals: DeferredRestartRefusals;
  readonly entryId: string;
  readonly request: AgentFollowUpRequest;
  readonly sessionRestart: AgentSessionRestartPolicy | undefined;
  readonly isCurrent: () => boolean;
  readonly prepared: ClaimedTurnAttachments | undefined;
}

export async function sendDeferredFollowUp(
  ports: DeferredFollowUpNoticePorts,
  attemptSend: DeferredFollowUpSend,
): Promise<DeferredSendOutcome> {
  const { request, sessionRestart, isCurrent } = attemptSend;
  const sending = sessionRestart === undefined ? request : { ...request, sessionRestart };
  const sent = await attempt(() => attemptSend.send(sending, isCurrent, attemptSend.prepared));
  if (!isCurrent()) return "stale";
  if (sent.ok && sent.value) return "sent";
  if (!sent.ok) ports.reportError(AGENT_TASKS_SOURCE, sent.error);
  const restartRefused = sent.ok && attemptSend.needsSessionRestart(request.threadId);
  ports.setNotice(
    restartRefused
      ? attemptSend.refusals.refuse(request.threadId, attemptSend.entryId)
      : failure(DEFERRED_SEND_FAILED_NOTICE),
  );
  return "failed";
}
