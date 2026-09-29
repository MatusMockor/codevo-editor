import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type {
  AgentComposerAttachmentDraft,
  AgentComposerAttachmentsSurface,
} from "../../application/useAgentComposerAttachments";
import {
  agentPendingSendAttachments,
  agentPendingSendFor,
  reduceAgentPendingSends,
  type AgentPendingSend,
  type AgentPendingSendOutcome,
  type AgentPendingSendSelection,
  type AgentPendingSendTarget,
} from "./agentPendingSend";

export interface AgentPendingSendsCoordinator {
  readonly visible: AgentPendingSend | null;
  begin(
    target: AgentPendingSendTarget,
    prompt: string,
    drafts: ReadonlyArray<AgentComposerAttachmentDraft>,
  ): number;
  settle(id: number, outcome: AgentPendingSendOutcome): void;
  dismiss(): void;
}

export function useAgentPendingSends(
  selection: AgentPendingSendSelection | null,
  now: () => number = Date.now,
): AgentPendingSendsCoordinator {
  const [state, dispatch] = useReducer(reduceAgentPendingSends, []);
  const sequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const visible = useMemo(() => agentPendingSendFor(state, selection), [selection, state]);
  const begin = useCallback(
    (
      target: AgentPendingSendTarget,
      prompt: string,
      drafts: ReadonlyArray<AgentComposerAttachmentDraft>,
    ): number => {
      sequence.current += 1;
      const id = sequence.current;
      dispatch({
        kind: "begin",
        send: {
          id,
          target,
          prompt,
          attachments: agentPendingSendAttachments(drafts),
          sentAtEpochMs: now(),
          status: "sending",
        },
      });
      return id;
    },
    [now],
  );
  const settle = useCallback((id: number, outcome: AgentPendingSendOutcome): void => {
    if (mounted.current) dispatch({ kind: "settle", id, outcome });
  }, []);
  const visibleId = visible?.id ?? null;
  const dismiss = useCallback((): void => {
    if (visibleId !== null) dispatch({ kind: "dismiss", id: visibleId });
  }, [visibleId]);
  return useMemo(() => ({ visible, begin, settle, dismiss }), [begin, dismiss, settle, visible]);
}

export interface AgentComposerSendHold {
  readonly drafts: ReadonlyArray<AgentComposerAttachmentDraft>;
  settle(delivered: boolean): void;
}

export function holdComposerAttachments(
  attachments: AgentComposerAttachmentsSurface | null,
  draftIds: ReadonlyArray<string>,
): AgentComposerSendHold {
  if (attachments === null || draftIds.length === 0) return NO_SEND_HOLD;
  const drafts = attachments.holdForSend?.(draftIds) ?? [];
  let settled = false;
  return {
    drafts,
    settle: (delivered) => {
      if (settled) return;
      settled = true;
      if (delivered) {
        attachments.markSent(draftIds);
        return;
      }
      attachments.returnToComposer?.(draftIds);
    },
  };
}

const NO_SEND_HOLD: AgentComposerSendHold = { drafts: [], settle: () => undefined };

export function pendingSendOutcome(
  delivered: boolean,
  awaitingConfirmation: boolean,
): AgentPendingSendOutcome {
  if (delivered) return "sent";
  return awaitingConfirmation ? "withdrawn" : "failed";
}

export function agentPendingSendSelection(
  threadId: string | null,
  lastTurnId: string | null,
  projectRootKey: string | null,
): AgentPendingSendSelection | null {
  if (threadId !== null) return { kind: "thread", threadId, lastTurnId };
  if (projectRootKey === null) return null;
  return { kind: "new", projectRootKey };
}
