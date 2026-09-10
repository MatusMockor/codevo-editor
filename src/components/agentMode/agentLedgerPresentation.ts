import type { AgentThread } from "../../domain/agentThread";
import type { AgentThreadFindHit } from "../../domain/agentThreadSearch";
import type { ExternalSessionExchange } from "../../domain/externalAgentSession";

export type AgentLedgerOrdinals =
  { readonly kind: "hidden" } | { readonly kind: "shown"; readonly importedPrompts: number };

export interface AgentImportedResponse {
  readonly exchangeIndex: number;
  readonly text: string;
}

export interface AgentImportedPrompt {
  readonly exchangeIndex: number;
  readonly promptIndex: number;
  readonly text: string;
}

export interface AgentImportedTurn {
  readonly key: string;
  readonly prompt: AgentImportedPrompt | null;
  readonly responses: ReadonlyArray<AgentImportedResponse>;
}

export interface AgentImportedHighlight {
  readonly query: string;
  readonly current: number | null;
}

const HIDDEN: AgentLedgerOrdinals = { kind: "hidden" };
const NO_HIGHLIGHTS: ReadonlyMap<number, AgentImportedHighlight> = new Map();

export function agentLedgerOrdinals(thread: AgentThread): AgentLedgerOrdinals {
  if (thread.turnsTruncated) return HIDDEN;

  const origin = thread.externalOrigin;
  if (origin === null) return { kind: "shown", importedPrompts: 0 };

  const history = origin.history;
  if (history === undefined) return HIDDEN;
  if (history.exchangesTruncated) return HIDDEN;

  return {
    kind: "shown",
    importedPrompts: history.exchanges.filter((exchange) => exchange.role === "user").length,
  };
}

export function agentLedgerTurnOrdinal(
  ordinals: AgentLedgerOrdinals,
  turnIndex: number,
): number | null {
  if (ordinals.kind === "hidden") return null;

  return ordinals.importedPrompts + turnIndex + 1;
}

export function agentLedgerImportedOrdinal(
  ordinals: AgentLedgerOrdinals,
  promptIndex: number,
): number | null {
  if (ordinals.kind === "hidden") return null;
  if (promptIndex >= ordinals.importedPrompts) return null;

  return promptIndex + 1;
}

export function agentImportedTurns(
  exchanges: ReadonlyArray<ExternalSessionExchange>,
): ReadonlyArray<AgentImportedTurn> {
  const turns: AgentImportedTurn[] = [];
  let responses: AgentImportedResponse[] = [];
  let prompt: AgentImportedPrompt | null = null;
  let started = false;
  let promptIndex = 0;

  const flush = (): void => {
    if (!started) return;
    turns.push({ key: `x${turns.length}`, prompt, responses });
  };

  exchanges.forEach((exchange, exchangeIndex) => {
    if (exchange.role === "assistant") {
      started = true;
      responses.push({ exchangeIndex, text: exchange.text });
      return;
    }
    flush();
    responses = [];
    prompt = { exchangeIndex, promptIndex, text: exchange.text };
    promptIndex += 1;
    started = true;
  });
  flush();

  return turns;
}

export function agentImportedHighlights(
  hits: ReadonlyArray<AgentThreadFindHit>,
  hitIndex: number | undefined,
  query: string,
): ReadonlyMap<number, AgentImportedHighlight> {
  if (query === "") return NO_HIGHLIGHTS;

  const highlights = new Map<number, AgentImportedHighlight>();
  const occurrences = new Map<number, number>();
  hits.forEach((hit, index) => {
    if (hit.scope !== "imported") return;
    const seen = occurrences.get(hit.exchangeIndex) ?? 0;
    occurrences.set(hit.exchangeIndex, seen + 1);
    if (index === hitIndex) {
      highlights.set(hit.exchangeIndex, { query, current: seen });
      return;
    }
    if (highlights.has(hit.exchangeIndex)) return;
    highlights.set(hit.exchangeIndex, { query, current: null });
  });
  return highlights;
}
