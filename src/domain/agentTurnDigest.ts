import { observationTimestamp, type AgentContextWindow } from "./agentContextWindow";
import type { AgentTurnEvent } from "./agentThread";
import type { AgentCliKind } from "./agentTask";

export const AGENT_TURN_DIGEST_VERSION = 1;
export const MAX_AGENT_TURN_DIGEST_CAPACITIES = 16;
export const MAX_AGENT_TURN_DIGEST_MODEL_BYTES = 256;

const UTF8_ENCODER = new TextEncoder();

export interface AgentTurnDigestCapacity {
  readonly model: string;
  readonly contextWindow: number;
}

export interface AgentTurnDigestOccupancy {
  readonly observedAtEpochMs?: number;
  readonly model: string;
  readonly inputTokens: number;
}

export interface AgentTurnDigestContext {
  readonly provider: AgentCliKind;
  readonly capacities: ReadonlyArray<AgentTurnDigestCapacity>;
  readonly primary: AgentTurnDigestOccupancy | null;
  readonly current: AgentContextWindow | null;
  readonly bounded: boolean;
}

export interface AgentTurnDigestWire {
  readonly version: typeof AGENT_TURN_DIGEST_VERSION;
  readonly context: AgentTurnDigestContext;
}

interface DigestFold {
  readonly provider: AgentCliKind;
  readonly capacities: Map<string, number>;
  primary: AgentTurnDigestOccupancy | null;
  current: AgentContextWindow | null;
  bounded: boolean;
}

type ContextUsageEvent = Extract<AgentTurnEvent, { kind: "contextUsage" }>;
type ResultEvent = Extract<AgentTurnEvent, { kind: "result" }>;

export function emptyAgentTurnDigest(provider: AgentCliKind): AgentTurnDigestWire {
  return {
    version: AGENT_TURN_DIGEST_VERSION,
    context: { provider, capacities: [], primary: null, current: null, bounded: false },
  };
}

export function foldAgentTurnDigest(
  digest: AgentTurnDigestWire,
  events: ReadonlyArray<AgentTurnEvent>,
): AgentTurnDigestWire {
  if (events.length === 0) return digest;
  const fold = openFold(digest);
  for (const event of events) acceptDigestEvent(fold, event);
  return closeFold(fold);
}

export function agentTurnDigestContextWindow(
  digest: AgentTurnDigestWire | null,
): AgentContextWindow | null {
  if (digest === null) return null;
  return digest.context.current;
}

function openFold(digest: AgentTurnDigestWire): DigestFold {
  const { context } = digest;
  return {
    provider: context.provider,
    capacities: new Map(context.capacities.map((entry) => [entry.model, entry.contextWindow])),
    primary: context.primary,
    current: context.current,
    bounded: context.bounded,
  };
}

function closeFold(fold: DigestFold): AgentTurnDigestWire {
  const capacities: AgentTurnDigestCapacity[] = [];
  let bounded = fold.bounded;
  for (const [model, contextWindow] of fold.capacities) {
    if (oversizedModel(model)) {
      bounded = true;
      continue;
    }
    capacities.push({ model, contextWindow });
  }
  const primary =
    fold.primary === null || !oversizedModel(fold.primary.model) ? fold.primary : null;
  if (primary === null && fold.primary !== null) bounded = true;
  return {
    version: AGENT_TURN_DIGEST_VERSION,
    context: { provider: fold.provider, capacities, primary, current: fold.current, bounded },
  };
}

function acceptDigestEvent(fold: DigestFold, event: AgentTurnEvent): void {
  if (invalidatesContext(fold.provider, event)) {
    fold.current = null;
    fold.primary = null;
    fold.capacities.clear();
    return;
  }
  if (event.kind === "contextUsage") return acceptContextUsage(fold, event);
  if (fold.provider === "codex" && event.kind === "result") return acceptResult(fold, event);
}

function acceptContextUsage(fold: DigestFold, event: ContextUsageEvent): void {
  if (event.contextWindow !== null && positive(event.contextWindow))
    retainCapacity(fold, event.model, event.contextWindow);
  if (event.inputTokens !== null && nonnegative(event.inputTokens))
    fold.primary = {
      model: event.model,
      inputTokens: event.inputTokens,
      ...observationTimestamp(event),
    };
  const capacity = fold.primary === null ? undefined : fold.capacities.get(fold.primary.model);
  fold.current =
    fold.primary !== null && capacity !== undefined
      ? {
          usedTokens: fold.primary.inputTokens,
          contextWindow: capacity,
          ...observationTimestamp(fold.primary),
        }
      : null;
}

function acceptResult(fold: DigestFold, event: ResultEvent): void {
  const usage = event.usage?.appServerUsage;
  if (usage === undefined) return;
  fold.current =
    positive(usage.contextWindow) && nonnegative(usage.last.totalTokens)
      ? { usedTokens: usage.last.totalTokens, contextWindow: usage.contextWindow }
      : null;
}

function retainCapacity(fold: DigestFold, model: string, contextWindow: number): void {
  if (!fold.capacities.has(model) && fold.capacities.size >= MAX_AGENT_TURN_DIGEST_CAPACITIES) {
    const oldest = fold.capacities.keys().next().value;
    if (oldest !== undefined) fold.capacities.delete(oldest);
    fold.bounded = true;
  }
  fold.capacities.set(model, contextWindow);
}

function invalidatesContext(provider: DigestFold["provider"], event: AgentTurnEvent): boolean {
  return (
    event.kind === "contextCompaction" ||
    event.kind === "error" ||
    (event.kind === "result" && event.isError && provider !== "codex") ||
    (event.kind === "contextCompactionStatus" && event.status !== "idle")
  );
}

function oversizedModel(model: string): boolean {
  return UTF8_ENCODER.encode(model).byteLength > MAX_AGENT_TURN_DIGEST_MODEL_BYTES;
}

function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positive(value: unknown): value is number {
  return nonnegative(value) && value > 0;
}
