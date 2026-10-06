import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { AgentTurnAttachmentRequest } from "../../application/agentThreadPorts";
import type {
  AgentComposerAttachmentDraft,
  AgentComposerAttachmentsSurface,
} from "../../application/useAgentComposerAttachments";
import { normalizeAgentCliKind } from "../../domain/agentSettings";
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
  isCurrent(): boolean;
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
    isCurrent: () =>
      attachments.sendHoldIsCurrent === undefined ||
      (drafts.length === draftIds.length && attachments.sendHoldIsCurrent(drafts)),
    settle: (delivered) => {
      if (settled) return;
      settled = true;
      if (attachments.settleSendHold !== undefined) {
        attachments.settleSendHold(drafts, delivered);
        return;
      }
      if (delivered) {
        attachments.markSent(draftIds);
        return;
      }
      attachments.returnToComposer?.(draftIds);
    },
  };
}

const NO_SEND_HOLD: AgentComposerSendHold = {
  drafts: [],
  isCurrent: () => true,
  settle: () => undefined,
};

export function prepareComposerAttachmentSend(
  attachments: AgentComposerAttachmentsSurface,
  projectRootKey: string | null,
  isCurrent: () => boolean,
): {
  readonly hold: AgentComposerSendHold;
  readonly prepared: Promise<AgentTurnAttachmentRequest | null>;
} {
  const draftIds = attachments.drafts
    .filter((draft) => draft.state === "ready")
    .map((draft) => draft.draftId);
  // Preparation captures its drafts synchronously, before holding removes them from the composer.
  const preparation =
    projectRootKey === null ? Promise.resolve(null) : attachments.prepareTurn(projectRootKey);
  const hold = holdComposerAttachments(attachments, draftIds);
  const prepared = (async (): Promise<AgentTurnAttachmentRequest | null> => {
    try {
      const result = await preparation;
      if (
        result === null ||
        !isCurrent() ||
        !hold.isCurrent() ||
        result.draftIds.length !== draftIds.length ||
        result.draftIds.some((id, index) => id !== draftIds[index]) ||
        result.intents.length === 0
      ) {
        hold.settle(false);
        return null;
      }
      return { attachments: result.intents, attachmentOwner: result.owner };
    } catch (error: unknown) {
      hold.settle(false);
      throw error;
    }
  })();
  return { hold, prepared };
}

export type ComposerSendRoute =
  | { readonly kind: "followUp"; readonly threadId: string; readonly steer: boolean }
  | { readonly kind: "new"; readonly projectRootKey: string };

export interface ComposerSendContext {
  readonly queuedEditThreadId: string | null;
  readonly baseTurnId: string | null;
  readonly provider: unknown;
}

export function composerPendingSendTarget(
  route: ComposerSendRoute,
  context: ComposerSendContext,
): AgentPendingSendTarget | null {
  if (route.kind === "new") {
    return {
      kind: "new",
      projectRootKey: route.projectRootKey,
      provider: normalizeAgentCliKind(context.provider),
    };
  }
  if (route.steer) return null;
  if (context.queuedEditThreadId === route.threadId) return null;
  return { kind: "followUp", threadId: route.threadId, baseTurnId: context.baseTurnId };
}

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
