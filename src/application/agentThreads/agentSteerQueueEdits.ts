import { agentReferenceEntriesInPrompt } from "../../domain/agentReferenceEntry";
import {
  beginDeferredEdit,
  editedDeferredEntry,
  endDeferredEdit,
  removeDeferred,
} from "../agentDeferredFollowUps";
import {
  AGENT_QUEUED_EDIT_UNAVAILABLE_NOTICE,
  admitQueuedEdit,
  editedFollowUpRequest,
  keptQueuedEditAttachments,
  mergeQueuedEditClaim,
  queuedEditAttachments,
  type AgentQueuedEditCommit,
  type AgentQueuedEditSession,
} from "../agentQueuedFollowUpEdit";
import {
  isCurrentThreadLaunchAuthority,
  sameLaunchAuthority,
  warning,
} from "../agentProjectAuthority";
import {
  AGENT_ATTACHMENT_PROMPT_TOO_LONG_NOTICE,
  prepareTurnAttachments,
  turnAttachmentsWithinPromptCap,
} from "../agentTurnAttachments";
import type { AgentSteerQueueContext } from "./agentSteerQueueState";
import { releaseQueuedEditClaim, steerAttachmentAuthority } from "./agentSteerPolicy";

export interface AgentSteerQueueEdits {
  removeDeferredFollowUp(threadId: string, id: string): void;
  beginDeferredFollowUpEdit(threadId: string, id: string): AgentQueuedEditSession | null;
  cancelDeferredFollowUpEdit(session: AgentQueuedEditSession): void;
  commitDeferredFollowUpEdit(
    session: AgentQueuedEditSession,
    commit: AgentQueuedEditCommit,
  ): Promise<boolean>;
}

export function createAgentSteerQueueEdits(context: AgentSteerQueueContext): AgentSteerQueueEdits {
  const { state, dependenciesRef, mountedRef, commitDeferred, armDrain } = context;

  const removeDeferredFollowUp = (threadId: string, id: string): void => {
    if (state.sendingQueued.get(threadId) === id) {
      const lease = state.steerLeases.get(threadId);
      if (lease !== undefined) lease.cancelled = true;
    }
    const drain = state.drainLeases.get(threadId);
    if (drain?.entryId === id) drain.cancelled = true;
    const next = removeDeferred(state.deferred, threadId, id);
    if (next === state.deferred) return;
    commitDeferred(next);
  };

  const beginDeferredFollowUpEdit = (
    threadId: string,
    id: string,
  ): AgentQueuedEditSession | null => {
    const authority = state.deferredAuthorities.get(threadId);
    if (authority === undefined) return null;
    if (!isCurrentThreadLaunchAuthority(dependenciesRef, mountedRef, authority)) return null;
    if (state.sendingQueued.get(threadId) === id) return null;
    if (state.drainLeases.get(threadId)?.entryId === id) return null;
    state.editLease += 1;
    const lease = state.editLease;
    const next = beginDeferredEdit(state.deferred, threadId, id, lease);
    const entry = editedDeferredEntry(next, threadId, id, lease);
    if (entry === null) return null;
    commitDeferred(next);
    return {
      threadId,
      entryId: id,
      lease,
      prompt: entry.request.prompt,
      attachments: queuedEditAttachments(state.preparedDeferred.get(entry.request)),
    };
  };

  const cancelDeferredFollowUpEdit = (session: AgentQueuedEditSession): void => {
    const { threadId, entryId, lease } = session;
    const next = endDeferredEdit(state.deferred, threadId, entryId, lease, null);
    if (next === state.deferred) return;
    commitDeferred(next);
    armDrain(threadId);
  };

  const commitDeferredFollowUpEdit = async (
    session: AgentQueuedEditSession,
    commit: AgentQueuedEditCommit,
  ): Promise<boolean> => {
    const { threadId, entryId, lease } = session;
    const deps = dependenciesRef.current;
    const authority = state.deferredAuthorities.get(threadId);
    const editIsCurrent = (): boolean => {
      const latest = state.deferredAuthorities.get(threadId);
      return (
        authority !== undefined &&
        latest !== undefined &&
        sameLaunchAuthority(latest, authority) &&
        isCurrentThreadLaunchAuthority(dependenciesRef, mountedRef, authority) &&
        editedDeferredEntry(state.deferred, threadId, entryId, lease) !== null
      );
    };
    if (authority === undefined || !editIsCurrent()) {
      deps.setNotice(warning(AGENT_QUEUED_EDIT_UNAVAILABLE_NOTICE));
      return false;
    }
    const kept = keptQueuedEditAttachments(session, commit.keptAttachmentKeys);
    const admission = admitQueuedEdit(commit.prompt, kept, commit.attachments ?? []);
    if (admission.kind === "refused") {
      deps.setNotice(warning(admission.reason));
      return false;
    }
    const added = await prepareTurnAttachments(
      {
        ...deps,
        setNotice: (notice) => {
          if (editIsCurrent()) dependenciesRef.current.setNotice(notice);
        },
      },
      commit,
      steerAttachmentAuthority(authority),
      threadId,
      "",
    );
    if (added === null) return false;
    const releaseAdded = (): Promise<void> =>
      releaseQueuedEditClaim(deps, authority.workspaceId, commit);
    if (added.notice !== null || !editIsCurrent()) {
      await releaseAdded();
      return false;
    }
    const prepared = mergeQueuedEditClaim(admission.prompt, kept, added);
    const entryOf = agentReferenceEntriesInPrompt(prepared.prompt);
    if (!turnAttachmentsWithinPromptCap(admission.prompt, prepared.attachments, entryOf)) {
      dependenciesRef.current.setNotice(warning(AGENT_ATTACHMENT_PROMPT_TOO_LONG_NOTICE));
      await releaseAdded();
      return false;
    }
    const entry = editedDeferredEntry(state.deferred, threadId, entryId, lease);
    if (entry === null) {
      await releaseAdded();
      return false;
    }
    const request = editedFollowUpRequest(entry.request, admission.prompt, kept, commit);
    state.preparedDeferred.set(request, prepared);
    commitDeferred(endDeferredEdit(state.deferred, threadId, entryId, lease, request));
    dependenciesRef.current.setNotice(null);
    armDrain(threadId);
    return true;
  };

  return {
    removeDeferredFollowUp,
    beginDeferredFollowUpEdit,
    cancelDeferredFollowUpEdit,
    commitDeferredFollowUpEdit,
  };
}
