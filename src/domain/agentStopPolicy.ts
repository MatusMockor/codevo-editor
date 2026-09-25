import {
  projectAgentBackgroundState,
  resolveAgentBackgroundActivity,
} from "./agentBackgroundActivity";
import type { AgentTurn } from "./agentThread";

export const AGENT_STOP_CONFIRMATION_WINDOW_MS = 10_000;

export interface AgentStopArm {
  readonly threadId: string;
  readonly turnId: string;
  readonly armedAtEpochMs: number;
}

export type AgentStopDecision =
  | { readonly kind: "ignore" }
  | { readonly kind: "hardStop"; readonly turnId: string }
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
}

export function decideAgentStop(request: AgentStopRequest): AgentStopDecision {
  const { turn } = request;
  if (turn === null) return { kind: "ignore" };
  if (agentStopArmIsLive(request.arm, request.threadId, turn.turnId, request.nowEpochMs)) {
    return { kind: "hardStop", turnId: turn.turnId };
  }
  const activity = resolveAgentBackgroundActivity(
    projectAgentBackgroundState(turn.events, true, turn.eventsTruncated),
    "pending",
  );
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
