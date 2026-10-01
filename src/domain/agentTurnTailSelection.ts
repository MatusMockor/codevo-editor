import {
  MAX_SUBAGENT_THREADS_PER_TURN,
  coalesceAgentTextEvents,
  type AgentTurnEvent,
} from "./agentThread";

export interface AgentTurnTailBudget {
  readonly maxEvents: number;
  readonly maxBytes: number;
  readonly eventBytes: (event: AgentTurnEvent) => number;
}

export function isAgentMainReply(event: AgentTurnEvent): boolean {
  return event.kind === "assistantText" && event.parentToolId === undefined;
}

export function agentTurnTailFits(
  events: ReadonlyArray<AgentTurnEvent>,
  budget: AgentTurnTailBudget,
): boolean {
  if (events.length > budget.maxEvents) return false;
  if (distinctSubagentThreads(events) > MAX_SUBAGENT_THREADS_PER_TURN) return false;
  return events.reduce((total, event) => total + budget.eventBytes(event), 0) <= budget.maxBytes;
}

export function selectAgentTurnTail(
  events: ReadonlyArray<AgentTurnEvent>,
  budget: AgentTurnTailBudget,
): ReadonlySet<number> {
  const selection = new TailSelection(events, budget);
  const closing = lastIndexWhere(events, (event) => event.kind === "result");
  if (closing !== null) selection.take([closing]);
  const answer = lastIndexWhere(events, isAgentMainReply);
  if (answer !== null) selection.take([answer]);
  takeNewestFirst(events, selection, (event) => event.kind === "userMessage");
  takeRepliesNewestFirst(events, selection);
  takeNewestFirst(events, selection, () => true);
  keepTextBoundaries(events, selection);
  return selection.indices();
}

class TailSelection {
  private readonly kept = new Set<number>();
  private readonly threads = new Map<string, number>();
  private bytes = 0;

  constructor(
    private readonly events: ReadonlyArray<AgentTurnEvent>,
    private readonly budget: AgentTurnTailBudget,
  ) {}

  has(index: number): boolean {
    return this.kept.has(index);
  }

  full(): boolean {
    return this.kept.size >= this.budget.maxEvents;
  }

  indices(): ReadonlySet<number> {
    return this.kept;
  }

  take(indices: ReadonlyArray<number>): boolean {
    const added = [...new Set(indices)].filter((index) => !this.kept.has(index));
    if (this.kept.size + added.length > this.budget.maxEvents) return false;
    const size = added.reduce(
      (total, index) => total + this.budget.eventBytes(this.events[index]!),
      0,
    );
    if (this.bytes + size > this.budget.maxBytes) return false;
    if (!this.threadsFit(added)) return false;
    for (const index of added) this.adopt(index);
    this.bytes += size;
    return true;
  }

  release(index: number): void {
    if (!this.kept.delete(index)) return;
    const event = this.events[index]!;
    this.bytes -= this.budget.eventBytes(event);
    const thread = subagentThreadOf(event);
    if (thread === null) return;
    const remaining = (this.threads.get(thread) ?? 0) - 1;
    if (remaining > 0) this.threads.set(thread, remaining);
    if (remaining <= 0) this.threads.delete(thread);
  }

  private threadsFit(added: ReadonlyArray<number>): boolean {
    const fresh = new Set<string>();
    for (const index of added) {
      const thread = subagentThreadOf(this.events[index]!);
      if (thread !== null && !this.threads.has(thread)) fresh.add(thread);
    }
    return this.threads.size + fresh.size <= MAX_SUBAGENT_THREADS_PER_TURN;
  }

  private adopt(index: number): void {
    this.kept.add(index);
    const thread = subagentThreadOf(this.events[index]!);
    if (thread === null) return;
    this.threads.set(thread, (this.threads.get(thread) ?? 0) + 1);
  }
}

function takeNewestFirst(
  events: ReadonlyArray<AgentTurnEvent>,
  selection: TailSelection,
  selected: (event: AgentTurnEvent) => boolean,
): void {
  for (let index = events.length - 1; index >= 0 && !selection.full(); index -= 1) {
    if (selected(events[index]!)) selection.take([index]);
  }
}

function takeRepliesNewestFirst(
  events: ReadonlyArray<AgentTurnEvent>,
  selection: TailSelection,
): void {
  let nearest: number | null = null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (selection.has(index)) {
      nearest = index;
      continue;
    }
    if (!isAgentMainReply(events[index]!)) continue;
    const unit =
      nearest !== null && wouldFuse(events, index, nearest) ? [index, nearest - 1] : [index];
    if (!selection.take(unit)) return;
    nearest = index;
  }
}

function keepTextBoundaries(events: ReadonlyArray<AgentTurnEvent>, selection: TailSelection): void {
  const retained: number[] = [];
  for (const index of [...selection.indices()].sort((left, right) => left - right)) {
    while (retained.length > 0) {
      const previous = retained[retained.length - 1]!;
      if (!wouldFuse(events, previous, index)) break;
      if (!wouldFuse(events, previous, index - 1) && selection.take([index - 1])) {
        retained.push(index - 1);
        break;
      }
      selection.release(previous);
      retained.pop();
    }
    retained.push(index);
  }
}

function wouldFuse(events: ReadonlyArray<AgentTurnEvent>, previous: number, next: number): boolean {
  if (next <= previous + 1) return false;
  return coalesceAgentTextEvents(events[previous], events[next]!) !== null;
}

function lastIndexWhere(
  events: ReadonlyArray<AgentTurnEvent>,
  matches: (event: AgentTurnEvent) => boolean,
): number | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (matches(events[index]!)) return index;
  }
  return null;
}

function subagentThreadOf(event: AgentTurnEvent): string | null {
  return "agentThreadId" in event ? event.agentThreadId : null;
}

function distinctSubagentThreads(events: ReadonlyArray<AgentTurnEvent>): number {
  const threads = new Set<string>();
  for (const event of events) {
    const thread = subagentThreadOf(event);
    if (thread !== null) threads.add(thread);
  }
  return threads.size;
}
