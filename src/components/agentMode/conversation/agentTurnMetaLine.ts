import type { AgentLaunchOptions } from "../../../domain/agentLaunch";
import type { AgentCliKind } from "../../../domain/agentTask";
import type { AgentTurn } from "../../../domain/agentThread";
import { agentCliKindLabel } from "../agentModePresentation";
import { agentTurnLaunchLabel } from "../agentTurnMetaPresentation";

const MAX_TIME_VALUE = 8_640_000_000_000_000;

export interface AgentMetaClockTime {
  readonly label: string;
  readonly iso: string;
  readonly title: string;
}

export function agentClockTime(epochMs: number | null, locale?: string): AgentMetaClockTime | null {
  if (epochMs === null) return null;
  if (!Number.isFinite(epochMs)) return null;
  if (Math.abs(epochMs) > MAX_TIME_VALUE) return null;
  const date = new Date(epochMs);
  return {
    label: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date),
    iso: date.toISOString(),
    title: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      date,
    ),
  };
}

export function agentTurnMetaAgentLabel(
  provider: AgentCliKind,
  launch: AgentLaunchOptions | null,
): string {
  return agentTurnLaunchLabel(launch) ?? agentCliKindLabel(provider);
}

export function agentTurnMetaAt(
  turn: Pick<AgentTurn, "startedAtEpochMs" | "endedAtEpochMs">,
): number {
  return turn.endedAtEpochMs ?? turn.startedAtEpochMs;
}
