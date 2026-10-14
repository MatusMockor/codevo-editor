import type { AgentRuntimeRequest } from "../domain/agentRuntimeRequest";
import type { MonotonicClock } from "./boundedRetry";
import {
  MAX_REMOTE_AGENT_THREAD_REQUEST_GUARDED_RESPONSES,
  MAX_REMOTE_AGENT_THREAD_REQUEST_LIVE_RESPONSES,
  REMOTE_AGENT_THREAD_REQUEST_RESPOND_SETTLEMENT_MS,
} from "./remoteAgentThreadRequestPolicy";
import { remoteAgentThreadRequestKey } from "./remoteAgentThreadRequestWatch";

export type RemoteAgentThreadRequestSendAdmission =
  | { readonly kind: "admitted"; readonly release: () => void }
  | { readonly kind: "alreadySending" }
  | { readonly kind: "busy" };

interface Guard {
  readonly since: number;
}

const ALREADY_SENDING: RemoteAgentThreadRequestSendAdmission = Object.freeze({
  kind: "alreadySending",
});
const BUSY: RemoteAgentThreadRequestSendAdmission = Object.freeze({ kind: "busy" });

export class RemoteAgentThreadRequestSendGuards {
  private readonly sends = new Map<string, Guard>();

  constructor(private readonly clock: MonotonicClock) {}

  admit(scopeId: string, key: string): RemoteAgentThreadRequestSendAdmission {
    const send = guardKey(scopeId, key);
    if (this.sends.has(send)) return ALREADY_SENDING;
    if (this.sends.size >= MAX_REMOTE_AGENT_THREAD_REQUEST_GUARDED_RESPONSES) return BUSY;
    if (this.live() >= MAX_REMOTE_AGENT_THREAD_REQUEST_LIVE_RESPONSES) return BUSY;
    const guard: Guard = { since: this.clock() };
    this.sends.set(send, guard);
    return { kind: "admitted", release: () => this.release(send, guard) };
  }

  mayStillSend(scopeId: string, key: string): boolean {
    const send = guardKey(scopeId, key);
    const guard = this.sends.get(send);
    if (guard === undefined) return false;
    if (this.clock() - guard.since < REMOTE_AGENT_THREAD_REQUEST_RESPOND_SETTLEMENT_MS) return true;
    this.sends.delete(send);
    return false;
  }

  forgetClosed(scopeId: string, requests: readonly AgentRuntimeRequest[]): void {
    for (const request of requests) {
      if (request.status === "pending" || request.status === "submitting") continue;
      this.sends.delete(guardKey(scopeId, remoteAgentThreadRequestKey(request.turnId, request.id)));
    }
  }

  private live(): number {
    const now = this.clock();
    return [...this.sends.values()].filter(
      (guard) => now - guard.since < REMOTE_AGENT_THREAD_REQUEST_RESPOND_SETTLEMENT_MS,
    ).length;
  }

  private release(send: string, guard: Guard): void {
    if (this.sends.get(send) === guard) this.sends.delete(send);
  }
}

function guardKey(scopeId: string, key: string): string {
  return JSON.stringify([scopeId, key]);
}
