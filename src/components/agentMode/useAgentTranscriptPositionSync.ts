import { useCallback, useMemo, useRef } from "react";
import type { AgentTranscriptPositionMemory } from "../../application/agentTranscriptPositionMemory";
import type { AgentTranscriptFollowController } from "./agentTranscriptFollowController";

export const AGENT_TRANSCRIPT_RESTORE_SETTLE_MS = 3_000;

export type AgentTranscriptRestoreOutcome = "none" | "restored" | "missing" | "deferred";

export interface AgentTranscriptPositionSync {
  readonly settle: (
    controller: AgentTranscriptFollowController,
    threadId: string,
  ) => AgentTranscriptRestoreOutcome;
  readonly retry: (controller: AgentTranscriptFollowController) => AgentTranscriptRestoreOutcome;
  readonly record: (controller: AgentTranscriptFollowController) => void;
  readonly cancel: () => void;
}

type PendingRestore = "none" | "hidden" | "short";

interface TranscriptOwner {
  readonly threadId: string;
  readonly pending: PendingRestore;
  readonly sinceMs: number;
}

export function useAgentTranscriptPositionSync(
  memory: AgentTranscriptPositionMemory | null,
  now: () => number,
): AgentTranscriptPositionSync {
  const ownerRef = useRef<TranscriptOwner | null>(null);

  const settle = useCallback(
    (controller: AgentTranscriptFollowController, threadId: string) => {
      const owner = ownerRef.current;
      const nowMs = now();
      const sameThread = owner !== null && owner.threadId === threadId;
      if (sameThread && owner.pending === "none") return "none";
      if (sameThread && owner.pending === "short" && expired(owner, nowMs)) {
        ownerRef.current = { threadId, pending: "none", sinceMs: owner.sinceMs };
        return "none";
      }
      const sinceMs = sameThread ? owner.sinceMs : nowMs;
      const outcome = restoreThreadPosition(memory, controller, threadId);
      ownerRef.current = { threadId, pending: pendingFor(outcome), sinceMs };
      return outcome === "hidden" || outcome === "short" ? "deferred" : outcome;
    },
    [memory, now],
  );

  const retry = useCallback(
    (controller: AgentTranscriptFollowController) => {
      const owner = ownerRef.current;
      if (owner === null || owner.pending === "none") return "none";
      return settle(controller, owner.threadId);
    },
    [settle],
  );

  const record = useCallback(
    (controller: AgentTranscriptFollowController) => {
      const owner = ownerRef.current;
      if (memory === null || owner === null || owner.pending !== "none") return;
      const reading = controller.readPosition();
      if (reading.kind === "unmeasured") return;
      memory.remember(owner.threadId, reading.kind === "latest" ? null : reading.position);
    },
    [memory],
  );

  const cancel = useCallback(() => {
    const owner = ownerRef.current;
    if (owner === null || owner.pending === "none") return;
    ownerRef.current = { ...owner, pending: "none" };
  }, []);

  return useMemo(() => ({ settle, retry, record, cancel }), [cancel, record, retry, settle]);
}

type ThreadRestoreOutcome = "none" | "restored" | "missing" | "hidden" | "short";

function restoreThreadPosition(
  memory: AgentTranscriptPositionMemory | null,
  controller: AgentTranscriptFollowController,
  threadId: string,
): ThreadRestoreOutcome {
  if (memory === null) return "none";
  const position = memory.read(threadId);
  if (position === null) return "none";
  const restore = controller.restorePosition(position);
  if (restore === "unmeasured") return "hidden";
  if (restore === "missing") memory.remember(threadId, null);
  return restore;
}

function pendingFor(outcome: ThreadRestoreOutcome): PendingRestore {
  if (outcome === "hidden" || outcome === "short") return outcome;
  return "none";
}

function expired(owner: TranscriptOwner, nowMs: number): boolean {
  return nowMs - owner.sinceMs > AGENT_TRANSCRIPT_RESTORE_SETTLE_MS;
}
