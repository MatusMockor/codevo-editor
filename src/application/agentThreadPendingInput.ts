import { pendingAgentRuntimeRequests } from "../domain/agentRuntimeRequest";
import { runningTurn, type AgentThread } from "../domain/agentThread";
import type { AgentThreadRequestFeed } from "./agentThreadRequestPorts";
import {
  AGENT_THREAD_REQUEST_OPERATION_DEADLINE_MS,
  agentThreadRequestStore,
  type AgentThreadRequestObservation,
} from "./agentThreadRequestStore";
import {
  localAgentThreadRequestIdentity,
  localAgentThreadRequestScope,
} from "./agentThreadRequestViewScope";

type PendingInputAnswer = boolean | "waiting" | "unavailable";

export async function agentThreadHasPendingInput(
  feed: AgentThreadRequestFeed | undefined,
  thread: AgentThread | undefined,
): Promise<boolean> {
  if (!feed) return false;
  const turn = thread && runningTurn(thread);
  if (!thread || !turn) return true;
  const scope = localAgentThreadRequestScope(localAgentThreadRequestIdentity(thread));
  return new Promise<boolean>((resolve, reject) => {
    let done = false;
    let release: (() => void) | null = null;
    const finish = (answer: boolean | "unavailable"): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      queueMicrotask(() => release?.());
      if (answer === "unavailable") {
        reject(new Error("Pending requests are unavailable."));
        return;
      }
      resolve(answer);
    };
    const timer = setTimeout(
      () => finish("unavailable"),
      AGENT_THREAD_REQUEST_OPERATION_DEADLINE_MS,
    );
    release = agentThreadRequestStore(feed).watch(scope, [turn.turnId], (observation) => {
      const answer = pendingInputOf(observation, turn.turnId);
      if (answer !== "waiting") finish(answer);
    });
  });
}

function pendingInputOf(
  observation: AgentThreadRequestObservation,
  turnId: string,
): PendingInputAnswer {
  const kind = observation.kind;
  switch (kind) {
    case "pending":
      return "waiting";
    case "unavailable":
      return "unavailable";
    case "observed": {
      const pending = pendingAgentRuntimeRequests(observation.state);
      if (pending.some((request) => request.turnId === turnId && request.body.kind === "question"))
        return true;
      return observation.pendingTurnIds.includes(turnId) ? "waiting" : false;
    }
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}
