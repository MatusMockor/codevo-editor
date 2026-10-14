import type {
  AgentRuntimeRequest,
  AgentRuntimeRequestStatus,
  AgentThreadRequests,
  AgentThreadRequestsJournal,
} from "../domain/agentRuntimeRequest";
import {
  isRemoteAgentThreadRequestWireId,
  type RemoteAgentThreadRequestIdentity,
} from "../domain/remoteAgentThreadRequestScope";
import {
  MAX_REMOTE_AGENT_THREAD_REQUEST_TURNS,
  type RemoteAgentThreadRequestTurn,
} from "./remoteAgentThreadRequestPorts";

export const REMOTE_AGENT_THREAD_REQUEST_SOURCES = ["snapshot", "legacy"] as const;
export type RemoteAgentThreadRequestSource = (typeof REMOTE_AGENT_THREAD_REQUEST_SOURCES)[number];

export const MAX_REMOTE_AGENT_THREAD_REQUEST_DESCRIBED_TURNS = 64;
export const MAX_REMOTE_AGENT_THREAD_REQUEST_DELIVERED_RECORDS = 512;
export const MAX_REMOTE_AGENT_THREAD_REQUEST_READ_PAGES = 64;
export const REMOTE_AGENT_THREAD_REQUEST_LEGACY_TICK_MS = 1_000;
export const REMOTE_AGENT_THREAD_REQUEST_OPEN_RECHECK_BASE_MS = 1_000;
export const REMOTE_AGENT_THREAD_REQUEST_OPEN_RECHECK_CAP_MS = 16_000;
export const MAX_REMOTE_AGENT_THREAD_REQUEST_OPEN_RECHECKS = 40;

export interface RemoteAgentThreadRequestDescription {
  readonly source: RemoteAgentThreadRequestSource;
  readonly reachable: boolean;
  readonly turns: readonly RemoteAgentThreadRequestTurn[];
  readonly awaiting: readonly string[];
}

export interface RemoteAgentThreadRequestDescriptionChange {
  readonly added: boolean;
  readonly moved: boolean;
}

export interface RemoteAgentThreadRequestReadStep {
  readonly chain: object;
  readonly fresh: boolean;
  readonly turns: readonly RemoteAgentThreadRequestTurn[];
  readonly cursor: string | null;
}

export type RemoteAgentThreadRequestReadSettlement =
  | { readonly kind: "continues"; readonly push: AgentThreadRequests | null }
  | { readonly kind: "overflowed"; readonly push: AgentThreadRequests | null }
  | {
      readonly kind: "complete";
      readonly push: AgentThreadRequests | null;
      readonly statuses: ReadonlyMap<string, AgentRuntimeRequestStatus>;
    };

interface WatchedTurn {
  descriptor: RemoteAgentThreadRequestTurn;
  awaiting: boolean;
  read: string | null;
  open: boolean;
  forced: boolean;
}

interface ReadChain {
  readonly turns: readonly RemoteAgentThreadRequestTurn[];
  readonly signatures: ReadonlyMap<string, string>;
  readonly forced: ReadonlySet<string>;
  readonly recheck: boolean;
  readonly statuses: Map<string, AgentRuntimeRequestStatus>;
  readonly open: Set<string>;
  announce: boolean;
  cursor: string | null;
  pages: number;
}

interface Envelope {
  readonly epoch: string;
  readonly journal: AgentThreadRequestsJournal;
  readonly unreadable: number;
  readonly truncated: boolean;
}

const UNCHANGED: RemoteAgentThreadRequestDescriptionChange = Object.freeze({
  added: false,
  moved: false,
});

export function isRemoteAgentThreadRequestDescription(
  description: RemoteAgentThreadRequestDescription,
): boolean {
  if (!REMOTE_AGENT_THREAD_REQUEST_SOURCES.includes(description.source)) return false;
  if (typeof description.reachable !== "boolean" || !Array.isArray(description.turns)) return false;
  if (description.turns.length > MAX_REMOTE_AGENT_THREAD_REQUEST_DESCRIBED_TURNS) return false;
  if (!description.turns.every(isTurn) || !Array.isArray(description.awaiting)) return false;
  if (description.awaiting.length > MAX_REMOTE_AGENT_THREAD_REQUEST_DESCRIBED_TURNS) return false;
  if (!description.awaiting.every(isRemoteAgentThreadRequestWireId)) return false;
  return new Set(description.turns.map(turnIdOf)).size === description.turns.length;
}

export function remoteAgentThreadRequestKey(turnId: string, requestId: string): string {
  return `${turnId}/${requestId}`;
}

export class RemoteAgentThreadRequestWatch {
  private turns = new Map<string, WatchedTurn>();
  private latest: string | null = null;
  private chain: ReadChain | null = null;
  private envelope: Envelope | null = null;
  private readonly delivered = new Map<string, number>();
  private lingering = 0;
  private primed = false;
  private recheckDue = false;

  constructor(
    private readonly identity: RemoteAgentThreadRequestIdentity,
    readonly source: RemoteAgentThreadRequestSource,
  ) {}

  describe(
    turns: readonly RemoteAgentThreadRequestTurn[],
    awaiting: readonly string[],
  ): RemoteAgentThreadRequestDescriptionChange {
    const next = new Map<string, WatchedTurn>();
    const flagged = new Set(awaiting);
    let change = UNCHANGED;
    for (const turn of turns) {
      const known = this.turns.get(turn.turnId);
      const described = { descriptor: descriptorOf(turn), awaiting: flagged.has(turn.turnId) };
      if (known === undefined) change = { added: true, moved: true };
      if (known !== undefined && signatureOf(known) !== signatureOf(described))
        change = { ...change, moved: true };
      next.set(turn.turnId, {
        ...described,
        read: known?.read ?? null,
        open: known?.open ?? false,
        forced: known?.forced ?? false,
      });
    }
    this.turns = next;
    this.latest = turns[turns.length - 1]?.turnId ?? null;
    if (change.moved) this.lingering = 0;
    if (this.recheckDelay() === null) this.recheckDue = false;
    return change;
  }

  turn(turnId: string): RemoteAgentThreadRequestTurn | null {
    return this.turns.get(turnId)?.descriptor ?? null;
  }

  owns(message: AgentThreadRequests): boolean {
    if (message.threadId !== this.identity.conversationId) return false;
    return message.workspaceId === null || message.workspaceId === this.identity.serverId;
  }

  force(turnId: string): boolean {
    const turn = this.turns.get(turnId);
    if (turn === undefined) return false;
    turn.forced = true;
    return true;
  }

  prime(): void {
    this.primed = true;
  }

  recheck(): void {
    this.recheckDue = this.recheckDelay() !== null;
  }

  revive(): void {
    this.lingering = 0;
    this.recheck();
  }

  get rechecking(): boolean {
    return this.recheckDue;
  }

  pending(): boolean {
    return this.chain !== null || this.primed || this.due().length > 0;
  }

  begin(): RemoteAgentThreadRequestReadStep {
    const known = this.chain;
    if (known !== null)
      return { chain: known, fresh: false, turns: known.turns, cursor: known.cursor };
    const due = this.due();
    const chain: ReadChain = {
      turns: due.map((turn) => turn.descriptor),
      signatures: new Map(due.map((turn) => [turn.descriptor.turnId, signatureOf(turn)])),
      forced: new Set(due.filter(isForced).map((turn) => turn.descriptor.turnId)),
      recheck: this.recheckDue,
      statuses: new Map(),
      open: new Set(),
      announce: this.primed,
      cursor: null,
      pages: 0,
    };
    for (const turn of due) turn.forced = false;
    this.primed = false;
    this.recheckDue = false;
    this.chain = chain;
    return { chain, fresh: true, turns: chain.turns, cursor: null };
  }

  settle(
    message: AgentThreadRequests,
    nextCursor: string | null,
  ): RemoteAgentThreadRequestReadSettlement {
    const chain = this.chain;
    if (chain === null) return { kind: "overflowed", push: null };
    for (const request of message.requests) {
      chain.statuses.set(remoteAgentThreadRequestKey(request.turnId, request.id), request.status);
      if (isOpen(request)) chain.open.add(request.turnId);
    }
    const push = this.delivery(message, chain.announce);
    if (push !== null) chain.announce = false;
    if (nextCursor !== null && chain.pages + 1 >= MAX_REMOTE_AGENT_THREAD_REQUEST_READ_PAGES) {
      this.abandon();
      return { kind: "overflowed", push };
    }
    if (nextCursor !== null) {
      chain.cursor = nextCursor;
      chain.pages += 1;
      return { kind: "continues", push };
    }
    for (const descriptor of chain.turns) {
      const turn = this.turns.get(descriptor.turnId);
      if (turn === undefined) continue;
      turn.read = chain.signatures.get(descriptor.turnId) ?? null;
      turn.open = chain.open.has(descriptor.turnId);
    }
    this.lingering = this.lingers() ? this.lingering + 1 : 0;
    this.chain = null;
    return { kind: "complete", push, statuses: chain.statuses };
  }

  abandon(): void {
    const chain = this.chain;
    if (chain === null) return;
    for (const turnId of chain.forced) this.force(turnId);
    if (chain.announce) this.primed = true;
    if (chain.recheck) this.recheckDue = true;
    if (this.lingers()) this.lingering += 1;
    this.chain = null;
  }

  deliver(message: AgentThreadRequests): AgentThreadRequests | null {
    return this.delivery(message, false);
  }

  adopt(message: AgentThreadRequests): void {
    const known = this.envelope;
    const continued = known !== null && known.epoch === message.epoch;
    if (!continued) this.delivered.clear();
    this.envelope = {
      epoch: message.epoch,
      journal: message.journal,
      unreadable: message.unreadable,
      truncated: (continued && known.truncated) || message.truncated,
    };
  }

  kick(): AgentThreadRequests | null {
    const envelope = this.envelope;
    if (envelope === null) return null;
    return {
      workspaceId: this.identity.serverId,
      threadId: this.identity.conversationId,
      epoch: envelope.epoch,
      journal: envelope.journal,
      requests: [],
      truncated: false,
      unreadable: envelope.unreadable,
      reset: false,
    };
  }

  recheckDelay(): number | null {
    const turns = [...this.turns.values()];
    const delays: number[] = [];
    if (turns.some((turn) => this.ticks(turn)))
      delays.push(REMOTE_AGENT_THREAD_REQUEST_LEGACY_TICK_MS);
    const rechecksLeft = this.lingering <= MAX_REMOTE_AGENT_THREAD_REQUEST_OPEN_RECHECKS;
    if (rechecksLeft && turns.some((turn) => this.lingersOn(turn))) delays.push(this.lingerDelay());
    if (delays.length === 0) return null;
    return Math.min(...delays);
  }

  private delivery(message: AgentThreadRequests, announce: boolean): AgentThreadRequests | null {
    const changed = this.changes(message);
    this.adopt(message);
    const requests = this.fresh(message.requests);
    if (!changed && requests.length === 0 && !announce) return null;
    return { ...message, requests, workspaceId: this.identity.serverId, reset: false };
  }

  private changes(message: AgentThreadRequests): boolean {
    const known = this.envelope;
    if (known === null || known.epoch !== message.epoch) return true;
    if (known.journal !== message.journal || known.unreadable !== message.unreadable) return true;
    return message.truncated && !known.truncated;
  }

  private fresh(requests: readonly AgentRuntimeRequest[]): readonly AgentRuntimeRequest[] {
    const fresh: AgentRuntimeRequest[] = [];
    for (const request of requests) {
      const key = remoteAgentThreadRequestKey(request.turnId, request.id);
      const version = this.delivered.get(key);
      if (version !== undefined && version >= request.version) continue;
      this.delivered.delete(key);
      this.delivered.set(key, request.version);
      fresh.push(request);
    }
    const excess = this.delivered.size - MAX_REMOTE_AGENT_THREAD_REQUEST_DELIVERED_RECORDS;
    for (const key of [...this.delivered.keys()].slice(0, Math.max(0, excess)))
      this.delivered.delete(key);
    return fresh;
  }

  private due(): readonly WatchedTurn[] {
    const due = [...this.turns.values()].filter(
      (turn) => this.moved(turn) || (this.recheckDue && this.rechecks(turn)),
    );
    if (due.length <= MAX_REMOTE_AGENT_THREAD_REQUEST_TURNS) return due;
    const forced = due.filter(isForced).slice(0, MAX_REMOTE_AGENT_THREAD_REQUEST_TURNS);
    const room = MAX_REMOTE_AGENT_THREAD_REQUEST_TURNS - forced.length;
    const newest = room === 0 ? [] : due.filter((turn) => !turn.forced).slice(-room);
    const picked = new Set([...forced, ...newest]);
    return due.filter((turn) => picked.has(turn));
  }

  private moved(turn: WatchedTurn): boolean {
    if (turn.forced) return true;
    if (!this.eligible(turn)) return false;
    if (turn.descriptor.interactionSequence === 0 && !turn.awaiting) return false;
    return turn.read !== signatureOf(turn);
  }

  private rechecks(turn: WatchedTurn): boolean {
    return this.ticks(turn) || this.lingersOn(turn);
  }

  private eligible(turn: WatchedTurn): boolean {
    const source = this.source;
    switch (source) {
      case "snapshot":
        return true;
      case "legacy":
        return !turn.descriptor.terminal || turn.descriptor.turnId === this.latest;
      default: {
        const exhaustive: never = source;
        return exhaustive;
      }
    }
  }

  private ticks(turn: WatchedTurn): boolean {
    return this.source === "legacy" && !turn.descriptor.terminal;
  }

  private lingersOn(turn: WatchedTurn): boolean {
    return this.eligible(turn) && turn.descriptor.terminal && turn.open;
  }

  private lingers(): boolean {
    return [...this.turns.values()].some((turn) => this.lingersOn(turn));
  }

  private lingerDelay(): number {
    const doubling = 2 ** Math.max(0, this.lingering - 1);
    return Math.min(
      REMOTE_AGENT_THREAD_REQUEST_OPEN_RECHECK_BASE_MS * doubling,
      REMOTE_AGENT_THREAD_REQUEST_OPEN_RECHECK_CAP_MS,
    );
  }
}

function isTurn(turn: RemoteAgentThreadRequestTurn): boolean {
  if (turn === null || typeof turn !== "object") return false;
  if (!isRemoteAgentThreadRequestWireId(turn.turnId)) return false;
  if (!isCount(turn.startedAtEpochMs) || typeof turn.terminal !== "boolean") return false;
  return turn.interactionSequence === null || isCount(turn.interactionSequence);
}

function isCount(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function turnIdOf(turn: RemoteAgentThreadRequestTurn): string {
  return turn.turnId;
}

function descriptorOf(turn: RemoteAgentThreadRequestTurn): RemoteAgentThreadRequestTurn {
  return {
    turnId: turn.turnId,
    startedAtEpochMs: turn.startedAtEpochMs,
    interactionSequence: turn.interactionSequence,
    terminal: turn.terminal,
  };
}

function signatureOf(turn: Pick<WatchedTurn, "descriptor" | "awaiting">): string {
  const awaiting = turn.awaiting ? "+awaiting" : "";
  const { interactionSequence, terminal } = turn.descriptor;
  if (interactionSequence !== null) return `sequence:${interactionSequence}${awaiting}`;
  return `${terminal ? "ended" : "running"}${awaiting}`;
}

function isForced(turn: WatchedTurn): boolean {
  return turn.forced;
}

function isOpen(request: AgentRuntimeRequest): boolean {
  return request.status === "pending" || request.status === "submitting";
}
