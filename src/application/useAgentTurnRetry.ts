import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { agentFailedLastTurn, type AgentTurnRetryReadyPlan } from "../domain/agentTurnRetry";
import type { AgentThreadsSurface } from "./agentThreadPorts";

export const RETRY_FAILED_MESSAGE =
  "Retry failed. Try again, or send the message from the composer.";
export const RETRY_NOT_STARTED_MESSAGE =
  "Retry did not start. Try again, or send the message from the composer.";

export interface AgentTurnRetryFailure {
  readonly failedTurnId: string;
  readonly message: string;
}

export interface AgentTurnRetrySurface {
  readonly pendingTurnId: string | null;
  readonly failure: AgentTurnRetryFailure | null;
  retry(plan: AgentTurnRetryReadyPlan, dangerousLaunchConfirmed?: boolean): Promise<void>;
}

const MAX_RETRIED_TURNS = 64;
const KEY_SEPARATOR = "\u0001";

export function useAgentTurnRetry(
  agents: Pick<AgentThreadsSurface, "threads" | "sendFollowUp">,
): AgentTurnRetrySurface {
  const threadsRef = useRef(agents.threads);
  const sendRef = useRef(agents.sendFollowUp);
  useLayoutEffect(() => {
    threadsRef.current = agents.threads;
    sendRef.current = agents.sendFollowUp;
  }, [agents.sendFollowUp, agents.threads]);
  const inFlight = useRef<string | null>(null);
  const retried = useRef<ReadonlyArray<string>>([]);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [pendingTurnId, setPendingTurnId] = useState<string | null>(null);
  const [failure, setFailure] = useState<AgentTurnRetryFailure | null>(null);

  const retry = useCallback(
    async (plan: AgentTurnRetryReadyPlan, dangerousLaunchConfirmed = false) => {
      if (inFlight.current !== null) return;
      if (plan.dangerous && !dangerousLaunchConfirmed) return;
      const key = `${plan.threadId}${KEY_SEPARATOR}${plan.failedTurnId}`;
      if (retried.current.includes(key)) return;
      const current = threadsRef.current.find((view) => view.thread.threadId === plan.threadId);
      if (current === undefined || current.thread.archived) return;
      if (agentFailedLastTurn(current.thread)?.turnId !== plan.failedTurnId) return;
      inFlight.current = plan.failedTurnId;
      setPendingTurnId(plan.failedTurnId);
      setFailure(null);
      const report = (message: string): void => {
        if (mounted.current) setFailure({ failedTurnId: plan.failedTurnId, message });
      };
      try {
        const sent = await sendRef.current({
          threadId: plan.threadId,
          prompt: plan.prompt,
          launch: plan.launch,
          ...(plan.dangerous ? { dangerousLaunchConfirmed: true } : {}),
        });
        if (!sent) {
          report(RETRY_NOT_STARTED_MESSAGE);
          return;
        }
        retried.current = [...retried.current, key].slice(-MAX_RETRIED_TURNS);
      } catch {
        report(RETRY_FAILED_MESSAGE);
      } finally {
        inFlight.current = null;
        if (mounted.current) setPendingTurnId(null);
      }
    },
    [],
  );

  return useMemo(() => ({ pendingTurnId, failure, retry }), [failure, pendingTurnId, retry]);
}
