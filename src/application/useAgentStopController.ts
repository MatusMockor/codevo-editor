import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentTurn } from "../domain/agentThread";
import {
  AGENT_STOP_CONFIRMATION_WINDOW_MS,
  decideAgentStop,
  type AgentStopArm,
  type AgentStopDecision,
} from "../domain/agentStopPolicy";

export interface AgentStopControllerOptions {
  readonly readRunningTurn: (threadId: string) => AgentTurn | null;
  readonly hardStop: (threadId: string) => Promise<void>;
  readonly now?: () => number;
}

export interface AgentStopConfirmation {
  readonly threadId: string;
  readonly liveTaskCount: number;
}

export interface AgentStopController {
  readonly confirmation: AgentStopConfirmation | null;
  requestStop(threadId: string): void;
  stopNow(threadId: string): void;
  cancelStop(): void;
}

export function useAgentStopController(options: AgentStopControllerOptions): AgentStopController {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const armRef = useRef<AgentStopArm | null>(null);
  const [confirmation, setConfirmation] = useState<AgentStopConfirmation | null>(null);

  const cancelStop = useCallback((): void => {
    armRef.current = null;
    setConfirmation(null);
  }, []);

  useEffect(() => {
    if (confirmation === null) return;
    const timer = setTimeout(cancelStop, AGENT_STOP_CONFIRMATION_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [cancelStop, confirmation]);

  const stopNow = useCallback(
    (threadId: string): void => {
      cancelStop();
      void optionsRef.current.hardStop(threadId);
    },
    [cancelStop],
  );

  const requestStop = useCallback(
    (threadId: string): void => {
      const { readRunningTurn, now = Date.now } = optionsRef.current;
      const nowEpochMs = now();
      const decision: AgentStopDecision = decideAgentStop({
        threadId,
        turn: readRunningTurn(threadId),
        arm: armRef.current,
        nowEpochMs,
      });
      switch (decision.kind) {
        case "ignore":
          cancelStop();
          return;
        case "hardStop":
          stopNow(threadId);
          return;
        case "confirmBackground":
          armRef.current = { threadId, turnId: decision.turnId, armedAtEpochMs: nowEpochMs };
          setConfirmation({ threadId, liveTaskCount: decision.liveTaskCount });
          return;
        default:
          unsupportedDecision(decision);
      }
    },
    [cancelStop, stopNow],
  );

  return { confirmation, requestStop, stopNow, cancelStop };
}

function unsupportedDecision(decision: never): never {
  throw new Error(`Unsupported stop decision: ${JSON.stringify(decision)}`);
}
