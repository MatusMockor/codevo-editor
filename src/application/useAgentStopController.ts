import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentTurn } from "../domain/agentThread";
import {
  agentTurnUiHalt,
  type AgentTurnHaltSource,
  type AgentTurnHaltTrigger,
} from "../domain/agentTurnHaltRecord";
import {
  AGENT_STOP_CONFIRMATION_WINDOW_MS,
  agentInterruptingDeadlineEpochMs,
  agentStopDeadlineRemainingMs,
  decideAgentStop,
  type AgentStopArm,
  type AgentStopDecision,
} from "../domain/agentStopPolicy";

export interface AgentStopControllerOptions {
  readonly readRunningTurn: (threadId: string) => AgentTurn | null;
  readonly hardStop: (threadId: string, trigger: AgentTurnHaltTrigger) => Promise<void>;
  readonly interrupt?: (threadId: string, source: AgentTurnHaltSource) => Promise<boolean>;
  readonly readSessionBackgroundTaskCount?: (threadId: string) => number;
  readonly stopSessionBackground?: (threadId: string) => void;
  readonly now?: () => number;
}

export type AgentStopConfirmation =
  | {
      readonly kind: "confirmBackground";
      readonly threadId: string;
      readonly turnId: string;
      readonly liveTaskCount: number;
    }
  | { readonly kind: "interrupting"; readonly threadId: string; readonly turnId: string }
  | {
      readonly kind: "confirmSessionBackground";
      readonly threadId: string;
      readonly liveTaskCount: number;
    };

export interface AgentStopController {
  readonly confirmation: AgentStopConfirmation | null;
  requestStop(threadId: string, source: AgentTurnHaltSource): void;
  stopNow(threadId: string, source: AgentTurnHaltSource): void;
  cancelStop(): void;
}

interface AgentInterruptedTurn {
  readonly threadId: string;
  readonly turnId: string;
  readonly requestedAtEpochMs: number;
  readonly source: AgentTurnHaltSource;
}

interface PendingStopConfirmation {
  readonly confirmation: AgentStopConfirmation;
  readonly deadlineEpochMs: number;
}

const MAX_REMEMBERED_INTERRUPTS = 64;

export function useAgentStopController(options: AgentStopControllerOptions): AgentStopController {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const armRef = useRef<AgentStopArm | null>(null);
  const interruptedRef = useRef<Map<string, string>>(new Map());
  const pendingInterruptRef = useRef<AgentInterruptedTurn | null>(null);
  const [pending, setPending] = useState<PendingStopConfirmation | null>(null);

  const cancelStop = useCallback((): void => {
    armRef.current = null;
    setPending(null);
  }, []);

  useEffect(() => {
    if (pending === null) return;
    const { now = Date.now } = optionsRef.current;
    const remaining = agentStopDeadlineRemainingMs(pending.deadlineEpochMs, now());
    const timer = setTimeout(cancelStop, remaining);
    return () => clearTimeout(timer);
  }, [cancelStop, pending]);

  const hardStop = useCallback(
    (threadId: string, trigger: AgentTurnHaltTrigger): void => {
      pendingInterruptRef.current = null;
      cancelStop();
      void optionsRef.current.hardStop(threadId, trigger);
    },
    [cancelStop],
  );

  const stopNow = useCallback(
    (threadId: string, source: AgentTurnHaltSource): void =>
      hardStop(threadId, agentTurnUiHalt(source)),
    [hardStop],
  );

  const settleInterrupt = useCallback(
    (attempt: AgentInterruptedTurn, accepted: boolean): void => {
      if (pendingInterruptRef.current !== attempt) return;
      pendingInterruptRef.current = null;
      if (optionsRef.current.readRunningTurn(attempt.threadId)?.turnId !== attempt.turnId) {
        forgetInterrupt(interruptedRef.current, attempt);
        return;
      }
      if (!accepted) {
        forgetInterrupt(interruptedRef.current, attempt);
        hardStop(attempt.threadId, { kind: "interruptRefused", source: attempt.source });
        return;
      }
      const { now = Date.now } = optionsRef.current;
      const deadlineEpochMs = agentInterruptingDeadlineEpochMs(attempt.requestedAtEpochMs);
      if (agentStopDeadlineRemainingMs(deadlineEpochMs, now()) === 0) return;
      setPending({
        confirmation: { kind: "interrupting", threadId: attempt.threadId, turnId: attempt.turnId },
        deadlineEpochMs,
      });
    },
    [hardStop],
  );

  const startInterrupt = useCallback(
    (attempt: AgentInterruptedTurn): void => {
      const interrupt = optionsRef.current.interrupt;
      if (interrupt === undefined) {
        stopNow(attempt.threadId, attempt.source);
        return;
      }
      rememberInterrupt(interruptedRef.current, attempt);
      pendingInterruptRef.current = attempt;
      cancelStop();
      void interrupt(attempt.threadId, attempt.source).then(
        (accepted) => settleInterrupt(attempt, accepted),
        () => settleInterrupt(attempt, false),
      );
    },
    [cancelStop, settleInterrupt, stopNow],
  );

  const requestStop = useCallback(
    (threadId: string, source: AgentTurnHaltSource): void => {
      const { readRunningTurn, now = Date.now, interrupt } = optionsRef.current;
      const { readSessionBackgroundTaskCount } = optionsRef.current;
      const nowEpochMs = now();
      const decision: AgentStopDecision = decideAgentStop({
        threadId,
        turn: readRunningTurn(threadId),
        arm: armRef.current,
        nowEpochMs,
        interruptAvailable: interrupt !== undefined,
        interruptedTurnId: interruptedRef.current.get(threadId) ?? null,
        sessionBackgroundTaskCount: readSessionBackgroundTaskCount?.(threadId) ?? 0,
      });
      switch (decision.kind) {
        case "ignore":
          cancelStop();
          return;
        case "hardStop":
          stopNow(threadId, source);
          return;
        case "interrupt":
          startInterrupt({
            threadId,
            turnId: decision.turnId,
            requestedAtEpochMs: nowEpochMs,
            source,
          });
          return;
        case "confirmBackground":
          armRef.current = { threadId, turnId: decision.turnId, armedAtEpochMs: nowEpochMs };
          setPending({
            confirmation: {
              kind: "confirmBackground",
              threadId,
              turnId: decision.turnId,
              liveTaskCount: decision.liveTaskCount,
            },
            deadlineEpochMs: nowEpochMs + AGENT_STOP_CONFIRMATION_WINDOW_MS,
          });
          return;
        case "confirmSessionBackground":
          armRef.current = { threadId, turnId: null, armedAtEpochMs: nowEpochMs };
          setPending({
            confirmation: {
              kind: "confirmSessionBackground",
              threadId,
              liveTaskCount: decision.liveTaskCount,
            },
            deadlineEpochMs: nowEpochMs + AGENT_STOP_CONFIRMATION_WINDOW_MS,
          });
          return;
        case "stopSessionBackground":
          cancelStop();
          optionsRef.current.stopSessionBackground?.(threadId);
          return;
        default:
          unsupportedDecision(decision);
      }
    },
    [cancelStop, startInterrupt, stopNow],
  );

  return { confirmation: pending?.confirmation ?? null, requestStop, stopNow, cancelStop };
}

function rememberInterrupt(remembered: Map<string, string>, attempt: AgentInterruptedTurn): void {
  remembered.delete(attempt.threadId);
  remembered.set(attempt.threadId, attempt.turnId);
  if (remembered.size <= MAX_REMEMBERED_INTERRUPTS) return;
  const oldest = remembered.keys().next();
  if (oldest.done === true) return;
  remembered.delete(oldest.value);
}

function forgetInterrupt(remembered: Map<string, string>, attempt: AgentInterruptedTurn): void {
  if (remembered.get(attempt.threadId) !== attempt.turnId) return;
  remembered.delete(attempt.threadId);
}

function unsupportedDecision(decision: never): never {
  throw new Error(`Unsupported stop decision: ${JSON.stringify(decision)}`);
}
