import { useContext, useMemo, type ReactNode } from "react";
import type { AgentThreadRequestScope } from "../../application/agentThreadRequestPorts";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  useAgentThreadRuntimeRequests,
  type AgentThreadRequestGaps,
} from "../../application/useAgentThreadRuntimeRequests";
import { agentRootOwnerId } from "../../domain/agentProject";
import type { AgentTurn } from "../../domain/agentThread";
import { AgentRuntimeRequestsProvider } from "./AgentRuntimeRequestRow";
import { AgentThreadRequestFeedContext } from "./agentThreadRequestFeedContext";

export function AgentThreadTranscriptRequests({
  children,
  thread,
  turns,
}: {
  readonly children: ReactNode;
  readonly thread: AgentThreadView;
  readonly turns: ReadonlyArray<AgentTurn>;
}) {
  const feed = useContext(AgentThreadRequestFeedContext);
  const remote = thread.execution?.kind === "remote";
  const { rootKey, ownerId: workspaceId } = thread.thread.owner;
  const threadId = thread.thread.threadId;
  const scope = useMemo<AgentThreadRequestScope | null>(
    () => (remote ? null : { rootKey, ownerId: agentRootOwnerId(rootKey), threadId, workspaceId }),
    [remote, rootKey, threadId, workspaceId],
  );
  const turnIds = useMemo(() => turns.map((turn) => turn.turnId), [turns]);
  const requests = useAgentThreadRuntimeRequests(feed, scope, turnIds);
  const note = agentRequestHistoryNote(requests.gaps);
  if (feed === null || scope === null) return children;
  return (
    <AgentRuntimeRequestsProvider requests={requests.byTurn}>
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
