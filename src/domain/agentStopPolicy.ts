import {
  projectAgentBackgroundState,
  resolveAgentBackgroundActivity,
} from "./agentBackgroundActivity";
import type { AgentTurn } from "./agentThread";

export const AGENT_STOP_CONFIRMATION_WINDOW_MS = 10_000;
export const AGENT_INTERRUPT_SETTLE_DEADLINE_MS = 10_000;

const MAX_AGENT_STOP_DEADLINE_MS = Math.max(
  AGENT_STOP_CONFIRMATION_WINDOW_MS,
  AGENT_INTERRUPT_SETTLE_DEADLINE_MS,
);

export interface AgentStopArm {
  readonly threadId: string;
  readonly turnId: string;
  readonly armedAtEpochMs: number;
}

export type AgentStopDecision =
  | { readonly kind: "ignore" }
  | { readonly kind: "hardStop"; readonly turnId: string }
  | { readonly kind: "interrupt"; readonly turnId: string }
  | {
      readonly kind: "confirmBackground";
      readonly turnId: string;
      readonly liveTaskCount: number;
    };

export interface AgentStopRequest {
  readonly threadId: string;
  readonly turn: AgentTurn | null;
  readonly arm: AgentStopArm | null;
  readonly nowEpochMs: number;
  readonly interruptAvailable: boolean;
  readonly interruptedTurnId: string | null;
}

export function decideAgentStop(request: AgentStopRequest): AgentStopDecision {
  const { turn } = request;
  if (turn === null) return { kind: "ignore" };
  if (agentStopArmIsLive(request.arm, request.threadId, turn.turnId, request.nowEpochMs)) {
    return { kind: "hardStop", turnId: turn.turnId };
  }
  if (request.interruptedTurnId === turn.turnId) return { kind: "hardStop", turnId: turn.turnId };
  const activity = resolveAgentBackgroundActivity(
    projectAgentBackgroundState(turn.events, true, turn.eventsTruncated),
    "pending",
  );
  if (!activity.foregroundSettled && request.interruptAvailable) {
    return { kind: "interrupt", turnId: turn.turnId };
  }
  if (!activity.foregroundSettled || activity.phase === "inactive") {
    return { kind: "hardStop", turnId: turn.turnId };
  }
  return {
    kind: "confirmBackground",
    turnId: turn.turnId,
    liveTaskCount: activity.tasks.length,
  };
}

export function agentStopArmIsLive(
  arm: AgentStopArm | null,
  threadId: string,
  turnId: string,
  nowEpochMs: number,
): boolean {
  if (arm === null) return false;
  if (arm.threadId !== threadId || arm.turnId !== turnId) return false;
  const age = nowEpochMs - arm.armedAtEpochMs;
  return age >= 0 && age < AGENT_STOP_CONFIRMATION_WINDOW_MS;
}

export function agentInterruptingDeadlineEpochMs(requestedAtEpochMs: number): number {
  return requestedAtEpochMs + AGENT_INTERRUPT_SETTLE_DEADLINE_MS;
}

export function agentStopDeadlineRemainingMs(deadlineEpochMs: number, nowEpochMs: number): number {
  const remaining = deadlineEpochMs - nowEpochMs;
  if (remaining <= 0 || remaining > MAX_AGENT_STOP_DEADLINE_MS) return 0;
  return remaining;
}
