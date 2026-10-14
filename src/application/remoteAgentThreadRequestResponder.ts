import { attemptWithinDeadline } from "./boundedRetry";
import type { RemoteAgentThreadRequestBroadcast } from "./remoteAgentThreadRequestBroadcast";
import type { RemoteAgentThreadRequestConfirmation } from "./remoteAgentThreadRequestConfirmations";
import { REMOTE_AGENT_THREAD_REQUEST_RESPOND_DEADLINE_MS } from "./remoteAgentThreadRequestPolicy";
import {
  RemoteAgentThreadRequestNotSentError,
  type RemoteAgentThreadRequestGateway,
  type RemoteAgentThreadRequestResponse,
  type RemoteAgentThreadRespondRequest,
  type RemoteAgentThreadRespondResult,
} from "./remoteAgentThreadRequestPorts";
import type { RemoteAgentThreadRequestRegistry } from "./remoteAgentThreadRequestRegistry";
import type { RemoteAgentThreadRequestSendGuards } from "./remoteAgentThreadRequestSendGuards";
import {
  resumeThread,
  type RemoteAgentThreadRequestLane as Lane,
  type RemoteAgentThreadRequestTracked as Tracked,
} from "./remoteAgentThreadRequestTracking";
import { remoteAgentThreadRequestKey } from "./remoteAgentThreadRequestWatch";

export type RemoteAgentThreadRequestRespondOutcome =
  | { readonly kind: "answered" }
  | { readonly kind: "notAnswerable" }
  | {
      readonly kind: "deliveryUncertain";
      readonly confirmation: Promise<RemoteAgentThreadRequestConfirmation>;
    }
  | {
      readonly kind: "notSent";
      readonly reason: "notDescribed" | "unreachable" | "alreadySending" | "busy" | "refused";
    };

type Sent =
  | { readonly kind: "responded"; readonly result: RemoteAgentThreadRespondResult }
  | { readonly kind: "refused" }
  | { readonly kind: "unknown" };

const ANSWERED: RemoteAgentThreadRequestRespondOutcome = Object.freeze({ kind: "answered" });
const NOT_ANSWERABLE: RemoteAgentThreadRequestRespondOutcome = Object.freeze({
  kind: "notAnswerable",
});
const BUSY: RemoteAgentThreadRequestRespondOutcome = Object.freeze({
  kind: "notSent",
  reason: "busy",
});
const REFUSED: RemoteAgentThreadRequestRespondOutcome = Object.freeze({
  kind: "notSent",
  reason: "refused",
});
const NOT_DESCRIBED: RemoteAgentThreadRequestRespondOutcome = Object.freeze({
  kind: "notSent",
  reason: "notDescribed",
});
const UNREACHABLE: RemoteAgentThreadRequestRespondOutcome = Object.freeze({
  kind: "notSent",
  reason: "unreachable",
});
const ALREADY_SENDING: RemoteAgentThreadRequestRespondOutcome = Object.freeze({
  kind: "notSent",
  reason: "alreadySending",
});
const SEND_REFUSED: Sent = Object.freeze({ kind: "refused" });
const SEND_UNKNOWN: Sent = Object.freeze({ kind: "unknown" });

export class RemoteAgentThreadRequestResponder {
  constructor(
    private readonly gateway: RemoteAgentThreadRequestGateway,
    private readonly guards: RemoteAgentThreadRequestSendGuards,
    private readonly registry: RemoteAgentThreadRequestRegistry,
    private readonly broadcast: RemoteAgentThreadRequestBroadcast,
    private readonly pump: (lane: Lane) => void,
  ) {}

  async respond(
    thread: Tracked | undefined,
    turnId: string,
    requestId: string,
    response: RemoteAgentThreadRequestResponse,
  ): Promise<RemoteAgentThreadRequestRespondOutcome> {
    const turn = thread?.watch.turn(turnId) ?? null;
    if (thread === undefined || turn === null) return NOT_DESCRIBED;
    if (!thread.reachable) return UNREACHABLE;
    const key = remoteAgentThreadRequestKey(turnId, requestId);
    const admission = this.guards.admit(thread.key, key);
    if (admission.kind === "alreadySending") return ALREADY_SENDING;
    if (admission.kind === "busy") return BUSY;
    const { serverId, runnerId, conversationId: threadId } = thread.identity;
    const sent = this.send({ serverId, runnerId, threadId, turn, requestId, response });
    void sent.then(admission.release);
    const attempt = await attemptWithinDeadline(
      () => sent,
      REMOTE_AGENT_THREAD_REQUEST_RESPOND_DEADLINE_MS,
    );
    if (attempt.kind === "settled") return this.concluded(thread, turnId, key, attempt.value);
    return { kind: "deliveryUncertain", confirmation: this.overdue(thread, turnId, key, sent) };
  }

  confirm(
    thread: Tracked | undefined,
    turnId: string,
    requestId: string,
  ): Promise<RemoteAgentThreadRequestConfirmation> {
    if (thread === undefined || thread.watch.turn(turnId) === null)
      return Promise.resolve("unconfirmed");
    const key = remoteAgentThreadRequestKey(turnId, requestId);
    if (this.guards.mayStillSend(thread.key, key)) return Promise.resolve("unconfirmed");
    return this.confirmation(thread, turnId, key);
  }

  private async send(request: RemoteAgentThreadRespondRequest): Promise<Sent> {
    try {
      return { kind: "responded", result: await this.gateway.respond(request) };
    } catch (error) {
      return error instanceof RemoteAgentThreadRequestNotSentError ? SEND_REFUSED : SEND_UNKNOWN;
    }
  }

  private overdue(
    thread: Tracked,
    turnId: string,
    key: string,
    sent: Promise<Sent>,
  ): Promise<RemoteAgentThreadRequestConfirmation> {
    const watched =
      this.registry.owns(thread) && thread.reachable && thread.watch.turn(turnId) !== null;
    const confirmation = watched
      ? thread.confirmations.await(key, turnId, "awaitingSettlement")
      : Promise.resolve<RemoteAgentThreadRequestConfirmation>("unconfirmed");
    void sent.then((late) => this.settledLate(thread, turnId, key, late));
    return confirmation;
  }

  private settledLate(thread: Tracked, turnId: string, key: string, sent: Sent): void {
    if (sent.kind === "responded" && sent.result.outcome !== "deliveryUncertain") {
      thread.confirmations.settle(key, "settled");
      this.learned(thread, turnId, sent);
      return;
    }
    if (sent.kind === "responded") this.broadcast.announce(thread, sent.result.message);
    thread.confirmations.open(key);
    this.reread(thread, turnId);
  }

  private learned(thread: Tracked, turnId: string, sent: Sent): void {
    if (sent.kind === "responded" && this.broadcast.announce(thread, sent.result.message)) return;
    this.reread(thread, turnId);
  }

  private concluded(
    thread: Tracked,
    turnId: string,
    key: string,
    sent: Sent,
  ): RemoteAgentThreadRequestRespondOutcome {
    const kind = sent.kind;
    switch (kind) {
      case "responded":
        return this.answered(thread, turnId, key, sent.result);
      case "refused":
        return REFUSED;
      case "unknown":
        return this.uncertain(thread, turnId, key);
      default: {
        const exhaustive: never = kind;
        return exhaustive;
      }
    }
  }

  private answered(
    thread: Tracked,
    turnId: string,
    key: string,
    result: RemoteAgentThreadRespondResult,
  ): RemoteAgentThreadRequestRespondOutcome {
    const outcome = result.outcome;
    switch (outcome) {
      case "answered":
        if (!this.broadcast.announce(thread, result.message)) this.reread(thread, turnId);
        return ANSWERED;
      case "notAnswerable":
        if (!this.broadcast.announce(thread, result.message)) this.reread(thread, turnId);
        return NOT_ANSWERABLE;
      case "deliveryUncertain":
        this.broadcast.announce(thread, result.message);
        return this.uncertain(thread, turnId, key);
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  }

  private uncertain(
    thread: Tracked,
    turnId: string,
    key: string,
  ): RemoteAgentThreadRequestRespondOutcome {
    return { kind: "deliveryUncertain", confirmation: this.confirmation(thread, turnId, key) };
  }

  private confirmation(
    thread: Tracked,
    turnId: string,
    key: string,
  ): Promise<RemoteAgentThreadRequestConfirmation> {
    if (!this.registry.owns(thread) || !thread.reachable || !thread.watch.force(turnId))
      return Promise.resolve("unconfirmed");
    const confirmation = thread.confirmations.await(key, turnId, "open");
    resumeThread(thread);
    this.pump(thread.lane);
    return confirmation;
  }

  private reread(thread: Tracked, turnId: string): void {
    if (!this.registry.owns(thread) || !thread.watch.force(turnId)) return;
    resumeThread(thread);
    this.pump(thread.lane);
  }
}
