import type { AgentRuntimeRequestStatus } from "../domain/agentRuntimeRequest";

export const MAX_REMOTE_AGENT_THREAD_REQUEST_CONFIRMATIONS = 8;
export const REMOTE_AGENT_THREAD_REQUEST_CONFIRMATION_LIFETIME_MS = 60_000;

export type RemoteAgentThreadRequestConfirmation = "pending" | "settled" | "unconfirmed";

export type RemoteAgentThreadRequestConfirmationGate = "open" | "awaitingSettlement";

interface Awaited {
  readonly key: string;
  readonly turnId: string;
  readonly resolve: (confirmation: RemoteAgentThreadRequestConfirmation) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  gate: RemoteAgentThreadRequestConfirmationGate;
  read: object | null;
}

export class RemoteAgentThreadRequestConfirmations {
  private waiting: readonly Awaited[] = [];

  await(
    key: string,
    turnId: string,
    gate: RemoteAgentThreadRequestConfirmationGate,
  ): Promise<RemoteAgentThreadRequestConfirmation> {
    if (this.waiting.length >= MAX_REMOTE_AGENT_THREAD_REQUEST_CONFIRMATIONS)
      return Promise.resolve("unconfirmed");
    return new Promise((resolve) => {
      const awaited: Awaited = { key, turnId, resolve, timer: undefined, gate, read: null };
      awaited.timer = setTimeout(
        () => this.conclude([awaited], unconfirmed),
        REMOTE_AGENT_THREAD_REQUEST_CONFIRMATION_LIFETIME_MS,
      );
      this.waiting = [...this.waiting, awaited];
    });
  }

  bind(read: object, turnIds: ReadonlySet<string>): void {
    for (const awaited of this.waiting) {
      if (awaited.gate !== "open" || awaited.read !== null) continue;
      if (turnIds.has(awaited.turnId)) awaited.read = read;
    }
  }

  open(key: string): boolean {
    const gated = this.waiting.filter((awaited) => awaited.key === key);
    for (const awaited of gated) awaited.gate = "open";
    return gated.length > 0;
  }

  settle(key: string, confirmation: RemoteAgentThreadRequestConfirmation): void {
    this.conclude(
      this.waiting.filter((awaited) => awaited.key === key),
      () => confirmation,
    );
  }

  unbind(read: object): void {
    for (const awaited of this.waiting) {
      if (awaited.read === read) awaited.read = null;
    }
  }

  confirm(read: object, statuses: ReadonlyMap<string, AgentRuntimeRequestStatus>): void {
    this.conclude(
      this.waiting.filter((awaited) => awaited.read === read),
      (awaited) => confirmationOf(statuses.get(awaited.key)),
    );
  }

  prune(turnIds: ReadonlySet<string>): void {
    this.conclude(
      this.waiting.filter((awaited) => !turnIds.has(awaited.turnId)),
      unconfirmed,
    );
  }

  abandon(): void {
    this.conclude(this.waiting, unconfirmed);
  }

  private conclude(
    concluded: readonly Awaited[],
    confirmation: (awaited: Awaited) => RemoteAgentThreadRequestConfirmation,
  ): void {
    const leaving = new Set(concluded.filter((awaited) => this.waiting.includes(awaited)));
    this.waiting = this.waiting.filter((awaited) => !leaving.has(awaited));
    for (const awaited of leaving) {
      clearTimeout(awaited.timer);
      awaited.timer = undefined;
      awaited.resolve(confirmation(awaited));
    }
  }
}

function unconfirmed(): RemoteAgentThreadRequestConfirmation {
  return "unconfirmed";
}

function confirmationOf(
  status: AgentRuntimeRequestStatus | undefined,
): RemoteAgentThreadRequestConfirmation {
  if (status === undefined) return "unconfirmed";
  return status === "pending" ? "pending" : "settled";
}
