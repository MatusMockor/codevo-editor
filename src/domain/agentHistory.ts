import type { AgentTurn } from "./agentThread";
import { AGENT_TASK_ID_PATTERN, type AgentCliKind } from "./agentTask";
import { parseAgentHistoryTurn } from "./agentThreadWire";

export const MAX_AGENT_HISTORY_PAGE_TURNS = 64;
export interface FindAgentHistoryImportRequest {
  readonly rootKey: string;
  readonly ownerId: string;
  readonly provider: AgentCliKind;
  readonly sessionId: string;
  readonly repositoryRoot: string;
}

export interface ReadAgentHistoryTurnsRequest {
  readonly rootKey: string;
  readonly ownerId: string;
  readonly threadId: string;
  readonly beforeTurnId: string | null;
}
export interface AgentHistoryTurnPage {
  readonly revision: number;
  readonly turns: ReadonlyArray<AgentTurn>;
  readonly hasEarlier: boolean;
  readonly beforeTurnId: string | null;
}

export function parseAgentHistoryTurnPage(value: unknown): AgentHistoryTurnPage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const page = value as Record<string, unknown>;
  const keys = ["turns", "hasEarlier", "beforeTurnId", "revision"];
  if (
    Object.keys(page).length !== keys.length ||
    Object.keys(page).some((key) => !keys.includes(key))
  )
    invalid();
  if (!Array.isArray(page.turns) || page.turns.length > MAX_AGENT_HISTORY_PAGE_TURNS) invalid();
  if (typeof page.hasEarlier !== "boolean") invalid();
  if (!Number.isSafeInteger(page.revision) || (page.revision as number) < 0) invalid();
  const turns = page.turns.map((turn, index) =>
    parseAgentHistoryTurn(turn, `page.turns[${index}]`),
  );
  if (new Set(turns.map((turn) => turn.turnId)).size !== turns.length) invalid();
  const beforeTurnId = page.beforeTurnId;
  if (
    beforeTurnId !== null &&
    (typeof beforeTurnId !== "string" || !AGENT_TASK_ID_PATTERN.test(beforeTurnId))
  )
    invalid();
  if (beforeTurnId !== (turns[0]?.turnId ?? null)) invalid();
  if (page.hasEarlier && turns.length === 0) invalid();
  return { turns, hasEarlier: page.hasEarlier, beforeTurnId, revision: page.revision as number };
}
function invalid(): never {
  throw new TypeError("Invalid agent history page.");
}
