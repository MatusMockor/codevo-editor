import { useCallback, useEffect, useMemo, useRef } from "react";
import type { AgentThreadsSurface, AgentThreadView } from "../../application/agentThreadPorts";
import {
  useAgentStopController,
  type AgentStopConfirmation,
} from "../../application/useAgentStopController";
import { runningTurn } from "../../domain/agentThread";
import type { AgentStopConfirmationView } from "./AgentStopConfirmationBanner";

export type AgentComposerStopSurface = Pick<AgentThreadsSurface, "interrupt" | "stop">;

export interface AgentComposerStopControls {
  readonly running: boolean;
  readonly stopConfirmation: AgentStopConfirmationView | null;
  onStop(): void;
  onStopNow(): void;
}

export function useAgentComposerStop(
  selectedThread: AgentThreadView | null,
  agents: AgentComposerStopSurface,
): AgentComposerStopControls {
  const runningThreadId =
    selectedThread?.lifecycle === "running" ? selectedThread.thread.threadId : null;
  const runningTurnId =
    runningThreadId === null || selectedThread === null
      ? null
      : (runningTurn(selectedThread.thread)?.turnId ?? null);
  const runningThreadIdRef = useRef(runningThreadId);
  runningThreadIdRef.current = runningThreadId;
  const selectedThreadRef = useRef(selectedThread);
  selectedThreadRef.current = selectedThread;
  const { cancelStop, confirmation, requestStop, stopNow } = useAgentStopController({
    readRunningTurn: (threadId) => {
      const view = selectedThreadRef.current;
      if (view === null || view.thread.threadId !== threadId) return null;
      return runningTurn(view.thread);
    },
    hardStop: agents.stop,
    interrupt: agents.interrupt,
  });
  useEffect(() => {
    if (runningThreadId === null) return;
    return cancelStop;
  }, [cancelStop, runningThreadId, runningTurnId]);
  const onStop = useCallback((): void => {
    const threadId = runningThreadIdRef.current;
    if (threadId === null) return;
    requestStop(threadId);
  }, [requestStop]);
  const onStopNow = useCallback((): void => {
    const threadId = runningThreadIdRef.current;
    if (threadId === null) return;
    stopNow(threadId);
  }, [stopNow]);
  const stopConfirmation = useMemo(
    () => stopConfirmationView(confirmation, runningThreadId, runningTurnId, cancelStop),
    [cancelStop, confirmation, runningThreadId, runningTurnId],
  );
  return { running: runningThreadId !== null, stopConfirmation, onStop, onStopNow };
}

function stopConfirmationView(
  confirmation: AgentStopConfirmation | null,
  runningThreadId: string | null,
  runningTurnId: string | null,
  onCancel: () => void,
): AgentStopConfirmationView | null {
  if (confirmation === null) return null;
  if (confirmation.threadId !== runningThreadId || confirmation.turnId !== runningTurnId) {
    return null;
  }
  if (confirmation.kind === "interrupting") return { kind: "interrupting", onCancel };
  return { kind: "confirmBackground", liveTaskCount: confirmation.liveTaskCount, onCancel };
}
