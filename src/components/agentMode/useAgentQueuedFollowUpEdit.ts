import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { editedDeferredEntry } from "../../application/agentDeferredFollowUps";
import type { AgentQueuedEditSession } from "../../application/agentQueuedFollowUpEdit";
import type {
  AgentThreadsSurface,
  AgentTurnAttachmentRequest,
} from "../../application/agentThreadPorts";
import {
  queuedEditAttachmentDraft,
  queuedEditAttachmentKey,
  type AgentComposerQueuedEdit,
} from "./agentComposerQueuedEdit";

export type AgentQueuedFollowUpEditPort = Pick<
  AgentThreadsSurface,
  | "deferredFollowUps"
  | "beginDeferredFollowUpEdit"
  | "cancelDeferredFollowUpEdit"
  | "commitDeferredFollowUpEdit"
>;

export interface AgentQueuedFollowUpEditState {
  readonly edit: AgentComposerQueuedEdit | null;
  readonly supported: boolean;
  begin(threadId: string, id: string): void;
}

interface ActiveQueuedEdit {
  readonly session: AgentQueuedEditSession;
  readonly kept: ReadonlyArray<string>;
  readonly observed: boolean;
}

export function useAgentQueuedFollowUpEdit(
  port: AgentQueuedFollowUpEditPort,
  selectedThreadId: string | null,
): AgentQueuedFollowUpEditState {
  const [active, setActive] = useState<ActiveQueuedEdit | null>(null);
  const portRef = useRef(port);
  const activeRef = useRef(active);
  useEffect(() => {
    portRef.current = port;
    activeRef.current = active;
  });
  const live =
    active !== null &&
    editedDeferredEntry(
      port.deferredFollowUps,
      active.session.threadId,
      active.session.entryId,
      active.session.lease,
    ) !== null
      ? active
      : null;

  useEffect(() => {
    if (active === null) return;
    if (live !== null && !active.observed) {
      setActive((current) =>
        current?.session === active.session ? { ...current, observed: true } : current,
      );
      return;
    }
    if (live === null && active.observed) setActive(null);
  }, [active, live]);

  useEffect(() => {
    if (active === null || active.session.threadId === selectedThreadId) return;
    portRef.current.cancelDeferredFollowUpEdit?.(active.session);
    activeRef.current = null;
    setActive(null);
  }, [active, selectedThreadId]);

  useEffect(
    () => () => {
      const pending = activeRef.current;
      if (pending === null) return;
      portRef.current.cancelDeferredFollowUpEdit?.(pending.session);
    },
    [],
  );

  const begin = useCallback((threadId: string, id: string): void => {
    const current = portRef.current;
    const previous = activeRef.current;
    if (previous !== null) current.cancelDeferredFollowUpEdit?.(previous.session);
    const session = current.beginDeferredFollowUpEdit?.(threadId, id) ?? null;
    const next =
      session === null
        ? null
        : {
            session,
            kept: session.attachments.map((attachment) => attachment.key),
            observed: false,
          };
    activeRef.current = next;
    setActive(next);
  }, []);

  const edit = useMemo((): AgentComposerQueuedEdit | null => {
    if (live === null) return null;
    const { session, kept } = live;
    const keptSet = new Set(kept);
    const settle = (): void => {
      if (activeRef.current?.session !== session) return;
      activeRef.current = null;
      setActive(null);
    };
    return {
      threadId: session.threadId,
      lease: session.lease,
      prompt: session.prompt,
      attachments: session.attachments
        .filter((attachment) => keptSet.has(attachment.key))
        .map(queuedEditAttachmentDraft),
      onRemoveAttachment: (draftId: string): void => {
        const key = queuedEditAttachmentKey(draftId);
        if (key === null) return;
        setActive((current) =>
          current?.session === session
            ? { ...current, kept: current.kept.filter((candidate) => candidate !== key) }
            : current,
        );
      },
      onCancel: (): void => {
        portRef.current.cancelDeferredFollowUpEdit?.(session);
        settle();
      },
      commit: async (prompt: string, request: AgentTurnAttachmentRequest): Promise<boolean> => {
        const commit = portRef.current.commitDeferredFollowUpEdit;
        if (commit === undefined) return false;
        const committed = await commit(session, { ...request, prompt, keptAttachmentKeys: kept });
        if (committed) settle();
        return committed;
      },
    };
  }, [live]);

  return {
    edit,
    supported: port.beginDeferredFollowUpEdit !== undefined,
    begin,
  };
}
