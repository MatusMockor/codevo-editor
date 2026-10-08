import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentFollowUpRequest, AgentThreadsSurface } from "../../application/agentThreadPorts";
import { agentLaunchOptionsEqual, type AgentLaunchOptions } from "../../domain/agentLaunch";
import { storedClaudeContext } from "../../domain/agentStoredLaunch";
import type { ClaudeModelManifest } from "../../domain/claudeModelCatalog";
import type { AgentComposerSubmission, AgentComposerSubmitSource } from "./AgentComposer";
import type { AgentSessionRestartConfirmationView } from "./AgentSessionRestartBanner";
import { useAgentClaudeModelCatalog } from "./useAgentClaudeModelCatalog";

export type AgentSessionRestartSurface = Pick<AgentThreadsSurface, "followUpNeedsSessionRestart">;

export type AgentSessionRestartResend =
  | { readonly kind: "draft" }
  | { readonly kind: "compaction"; readonly submission: AgentComposerSubmission };

export interface AgentSessionRestartConfirmation extends AgentSessionRestartConfirmationView {
  readonly resend: AgentSessionRestartResend;
}

export interface AgentSessionRestartRequest {
  readonly threadId: string;
  readonly submission: AgentComposerSubmission;
  readonly source: AgentComposerSubmitSource;
}

export interface AgentSessionRestartGate {
  readonly confirmation: AgentSessionRestartConfirmation | null;
  followUpRestart(
    submission: AgentComposerSubmission,
  ): Pick<AgentFollowUpRequest, "sessionRestart">;
  settleFollowUp(
    request: AgentSessionRestartRequest,
    sent: boolean,
    isCurrent: () => boolean,
  ): void;
  clear(): void;
}

interface PendingRestart {
  readonly threadId: string;
  readonly launch: AgentLaunchOptions;
  readonly resend: AgentSessionRestartResend;
}

const DRAFT_RESEND: AgentSessionRestartResend = { kind: "draft" };

const NO_SESSION_RESTART: Pick<AgentFollowUpRequest, "sessionRestart"> = {};
const STOP_BACKGROUND_RESTART: Pick<AgentFollowUpRequest, "sessionRestart"> = {
  sessionRestart: "stopBackground",
};

export function useAgentSessionRestartGate(
  agents: AgentSessionRestartSurface,
  selectedThreadId: string | null,
  launch: AgentLaunchOptions,
): AgentSessionRestartGate {
  const catalog = useAgentClaudeModelCatalog();
  const [pending, setPending] = useState<PendingRestart | null>(null);
  const current = pending !== null && pendingMatches(pending, selectedThreadId, launch, catalog);
  if (pending !== null && !current) setPending(null);
  const clear = useCallback((): void => setPending(null), []);
  const resend = current ? pending.resend : null;
  const confirmation = useMemo(
    (): AgentSessionRestartConfirmation | null =>
      resend === null ? null : { onCancel: clear, resend },
    [clear, resend],
  );
  const { followUpNeedsSessionRestart } = agents;
  const settleFollowUp = useCallback(
    (request: AgentSessionRestartRequest, sent: boolean, isCurrent: () => boolean): void => {
      if (sent) return;
      if (followUpNeedsSessionRestart?.(request.threadId) !== true) return;
      if (!isCurrent()) return;
      setPending(pendingRestart(request, launch));
    },
    [followUpNeedsSessionRestart, launch],
  );
  return useMemo(
    () => ({ confirmation, followUpRestart, settleFollowUp, clear }),
    [clear, confirmation, settleFollowUp],
  );
}

export function useAgentSessionRestartDismissal(
  confirmation: AgentSessionRestartConfirmationView | null,
): () => void {
  const confirmationRef = useRef(confirmation);
  useLayoutEffect(() => {
    confirmationRef.current = confirmation;
  }, [confirmation]);
  return useCallback((): void => confirmationRef.current?.onCancel(), []);
}

function followUpRestart(
  submission: AgentComposerSubmission,
): Pick<AgentFollowUpRequest, "sessionRestart"> {
  if (submission.sessionRestartConfirmed === true) return STOP_BACKGROUND_RESTART;
  return NO_SESSION_RESTART;
}

function pendingRestart(
  request: AgentSessionRestartRequest,
  launch: AgentLaunchOptions,
): PendingRestart {
  const resend: AgentSessionRestartResend =
    request.source === "compaction"
      ? { kind: "compaction", submission: request.submission }
      : DRAFT_RESEND;
  return { threadId: request.threadId, launch, resend };
}

function pendingMatches(
  pending: PendingRestart,
  selectedThreadId: string | null,
  launch: AgentLaunchOptions,
  catalog: ClaudeModelManifest,
): boolean {
  if (pending.threadId !== selectedThreadId) return false;
  return agentLaunchOptionsEqual(
    withLaunchedContext(pending.launch, catalog),
    withLaunchedContext(launch, catalog),
  );
}

function withLaunchedContext(
  launch: AgentLaunchOptions,
  catalog: ClaudeModelManifest,
): AgentLaunchOptions {
  if (launch.provider !== "claudeCode") return launch;
  return { ...launch, context: storedClaudeContext(launch, catalog) };
}
