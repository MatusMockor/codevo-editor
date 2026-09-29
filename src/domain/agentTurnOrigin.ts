import type { AgentLaunchOptions } from "./agentLaunch";

export type AgentTurnOrigin = "background";

export type AgentBackgroundTurnCause = "taskNotification" | "unprompted";

export const AGENT_BACKGROUND_TURN_LABEL = "Claude continued after background work finished";
export const AGENT_UNPROMPTED_TURN_LABEL = "Claude replied without a new message";

export interface AgentTurnOriginShape {
  readonly origin?: AgentTurnOrigin;
  readonly prompt: string;
  readonly launch: AgentLaunchOptions | null;
  readonly cliVersion: string | null;
}

export function isAgentBackgroundTurn(turn: Pick<AgentTurnOriginShape, "origin">): boolean {
  return turn.origin === "background";
}

export function agentBackgroundTurnLabel(cause: AgentBackgroundTurnCause): string {
  switch (cause) {
    case "taskNotification":
      return AGENT_BACKGROUND_TURN_LABEL;
    case "unprompted":
      return AGENT_UNPROMPTED_TURN_LABEL;
    default:
      return unsupportedCause(cause);
  }
}

export function agentBackgroundTurnCause(
  turn: Pick<AgentTurnOriginShape, "prompt">,
): AgentBackgroundTurnCause {
  if (turn.prompt === AGENT_BACKGROUND_TURN_LABEL) return "taskNotification";
  return "unprompted";
}

export function derivedAgentTurnOrigin(
  turn: Omit<AgentTurnOriginShape, "origin">,
): AgentTurnOrigin | undefined {
  if (!isBackgroundTurnMarker(turn.prompt)) return undefined;
  if (turn.launch !== null) return undefined;
  if (turn.cliVersion !== null) return undefined;
  return "background";
}

export function latestPromptedAgentLaunch(
  turns: ReadonlyArray<AgentTurnOriginShape>,
): AgentLaunchOptions | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (isAgentBackgroundTurn(turn) || turn.launch === null) continue;
    return turn.launch;
  }
  return null;
}

function isBackgroundTurnMarker(prompt: string): boolean {
  return prompt === AGENT_BACKGROUND_TURN_LABEL || prompt === AGENT_UNPROMPTED_TURN_LABEL;
}

function unsupportedCause(cause: never): never {
  throw new TypeError(`Unsupported background turn cause: ${String(cause)}.`);
}
