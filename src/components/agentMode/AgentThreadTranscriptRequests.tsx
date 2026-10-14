import { useContext, useLayoutEffect, type ReactNode } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentThreadRequestGaps } from "../../application/useAgentThreadRuntimeRequests";
import type { AgentTurn } from "../../domain/agentThread";
import { AgentRuntimeRequestsProvider } from "./AgentRuntimeRequestRow";
import {
  AgentThreadRequestsScopeContext,
  AgentThreadRequestTurnsReportContext,
} from "./agentThreadRequestsScopeContext";

const TURN_SEPARATOR = "\u0001";

export function AgentThreadTranscriptRequests({
  children,
  thread,
  turns,
}: {
  readonly children: ReactNode;
  readonly thread: AgentThreadView;
  readonly turns: ReadonlyArray<AgentTurn>;
}) {
  const shared = useContext(AgentThreadRequestsScopeContext);
  const report = useContext(AgentThreadRequestTurnsReportContext);
  const threadId = thread.thread.threadId;
  const signature = turns.map((turn) => turn.turnId).join(TURN_SEPARATOR);
  useLayoutEffect(() => {
    if (report === null) return undefined;
    report(threadId, signature === "" ? [] : signature.split(TURN_SEPARATOR));
    return () => report(threadId, null);
  }, [report, signature, threadId]);
  if (shared === null || shared.threadId !== threadId) return children;
  const note = agentRequestHistoryNote(shared.requests.gaps);
  return (
    <AgentRuntimeRequestsProvider requests={shared.requests.byTurn}>
      {note !== null && (
        <p className="agent-note" data-agent-request-history-note="" role="status">
          {note}
        </p>
      )}
      {children}
    </AgentRuntimeRequestsProvider>
  );
}

export const AGENT_REQUEST_HISTORY_INCOMPLETE_NOTE =
  "Some earlier questions and approvals in this thread can't be shown.";
export const AGENT_REQUEST_HISTORY_UNSAVED_NOTE =
  "Codevo couldn't save some questions or approvals from this thread. They may be missing after a restart.";

function agentRequestHistoryNote(gaps: AgentThreadRequestGaps): string | null {
  if (gaps.incomplete && gaps.unsaved)
    return `${AGENT_REQUEST_HISTORY_INCOMPLETE_NOTE} ${AGENT_REQUEST_HISTORY_UNSAVED_NOTE}`;
  if (gaps.incomplete) return AGENT_REQUEST_HISTORY_INCOMPLETE_NOTE;
  if (gaps.unsaved) return AGENT_REQUEST_HISTORY_UNSAVED_NOTE;
  return null;
}
