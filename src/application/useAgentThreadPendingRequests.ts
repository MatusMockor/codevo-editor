import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { AgentRuntimeRequest } from "../domain/agentRuntimeRequest";
import {
  agentThreadRequestDeliveryInFlight,
  type AgentThreadRequestDeliveries,
  type AgentThreadRequestDeliveryLedger,
  type AgentThreadRequestDeliveryRecord,
} from "./agentThreadRequestDeliveryLedger";
import {
  AGENT_REQUEST_NOT_ANSWERABLE,
  agentThreadRequestProjection,
  deliveryAfterConfirmation,
  deliveryAfterOutcome,
  deliveryAfterProjection,
  type AgentThreadRequestCardRelease,
  type AgentThreadRequestDeliveryStep,
} from "./agentThreadRequestDeliveryTransitions";
import { useAgentThreadRequestReconfirmation } from "./useAgentThreadRequestReconfirmation";
import type {
  AgentThreadRequestDelivery,
  AgentThreadRequestReply,
  AgentThreadRequestResponder,
} from "./agentThreadRequestResponders";
import type { AgentThreadRequestClosure } from "./useAgentThreadRuntimeRequests";

export const AGENT_REQUEST_NOT_LIVE = "This request can no longer be answered here.";

export type AgentThreadPendingRequestState =
  | { readonly kind: "answerable" }
  | { readonly kind: "sending" }
  | { readonly kind: "checking" }
  | { readonly kind: "disabled" }
  | { readonly kind: "readOnly"; readonly reason: string };

export interface AgentThreadPendingRequest {
  readonly key: string;
  readonly request: AgentRuntimeRequest;
  readonly state: AgentThreadPendingRequestState;
  readonly error: string | null;
}

export interface AgentThreadPendingRequests {
  readonly items: readonly AgentThreadPendingRequest[];
  respond(key: string, reply: AgentThreadRequestReply): Promise<void>;
}

export interface AgentThreadPendingRequestsInput {
  readonly ledger: AgentThreadRequestDeliveryLedger;
  readonly ownerKey: string | null;
  readonly open: readonly AgentRuntimeRequest[];
  readonly closure: AgentThreadRequestClosure;
  readonly responder: AgentThreadRequestResponder | null;
  readonly reachable: boolean;
}

interface Settler {
  readonly attempt: object;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

const ANSWERABLE: AgentThreadPendingRequestState = Object.freeze({ kind: "answerable" });
const SENDING: AgentThreadPendingRequestState = Object.freeze({ kind: "sending" });
const CHECKING: AgentThreadPendingRequestState = Object.freeze({ kind: "checking" });
const DISABLED: AgentThreadPendingRequestState = Object.freeze({ kind: "disabled" });
const NOT_LIVE: AgentThreadPendingRequestState = Object.freeze({
  kind: "readOnly",
  reason: AGENT_REQUEST_NOT_LIVE,
});
const NOT_ANSWERABLE: AgentThreadPendingRequestState = Object.freeze({
  kind: "readOnly",
  reason: AGENT_REQUEST_NOT_ANSWERABLE,
});
const NO_ITEMS: readonly AgentThreadPendingRequest[] = Object.freeze([]);
const FAILED: AgentThreadRequestDelivery = Object.freeze({ kind: "notSent", reason: "failed" });

export function agentThreadPendingRequestKey(request: AgentRuntimeRequest): string {
  return `${request.turnId}/${request.id}`;
}

function turnIdOf(key: string): string {
  return key.slice(0, key.indexOf("/"));
}

export function useAgentThreadPendingRequests({
  ledger,
  ownerKey,
  open,
  closure,
  responder,
  reachable,
}: AgentThreadPendingRequestsInput): AgentThreadPendingRequests {
  const deliveries = useSyncExternalStore(ledger.subscribe, () => ledger.deliveriesOf(ownerKey));
  const settlers = useRef(new Map<string, Settler>());
  const latest = useRef({ ownerKey, open, responder });
  const shown = useRef<readonly AgentThreadPendingRequest[]>(NO_ITEMS);

  const answerable = responder !== null && reachable;
  const items = useMemo(
    () => stable(shown.current, present(open, deliveries, answerable)),
    [answerable, deliveries, open],
  );

  useEffect(() => {
    latest.current = { ownerKey, open, responder };
    shown.current = items;
  });

  useEffect(() => {
    const pending = settlers.current;
    return () => {
      for (const settler of pending.values()) settler.resolve();
      pending.clear();
    };
  }, [ownerKey]);

  const settle = useCallback(
    (key: string, attempt: object, outcome: AgentThreadRequestCardRelease) =>
      release(settlers.current, key, attempt, outcome),
    [],
  );

  useEffect(() => {
    if (ownerKey === null) return;
    const byKey = new Map(open.map((request) => [agentThreadPendingRequestKey(request), request]));
    const closed = new Set(closure.closed.map(agentThreadPendingRequestKey));
    for (const [key, record] of deliveries) {
      const evidence = closed.has(key) || closure.listedTurnIds.has(turnIdOf(key));
      const projection = agentThreadRequestProjection(byKey.get(key), evidence);
      const decided = deliveryAfterProjection(record, projection);
      if (decided === null) continue;
      if (!ledger.write(ownerKey, key, decided.next, record.attempt)) continue;
      settle(key, record.attempt, decided.release);
    }
  }, [closure, deliveries, ledger, open, ownerKey, settle]);

  useAgentThreadRequestReconfirmation({
    ledger,
    ownerKey,
    deliveries,
    open,
    responder,
    reachable,
    keyOf: agentThreadPendingRequestKey,
    settle,
  });

  const respond = useCallback(
    (key: string, reply: AgentThreadRequestReply): Promise<void> => {
      const { ownerKey: owner, open: current, responder: target } = latest.current;
      const request = current.find((candidate) => agentThreadPendingRequestKey(candidate) === key);
      if (owner === null || target === null || request === undefined)
        return Promise.reject(new Error("This request can't be answered now."));
      if (agentThreadRequestDeliveryInFlight(ledger.record(owner, key)))
        return Promise.reject(new Error("An answer to this request is already on its way."));
      const attempt = {};
      const version = request.version;
      ledger.write(owner, key, { kind: "sending", version, attempt });
      const sent = new Promise<void>((resolve, reject) => {
        settlers.current.set(key, { attempt, resolve, reject });
      });
      const apply = (step: AgentThreadRequestDeliveryStep): void => {
        if (!ledger.write(owner, key, step.next, attempt)) return;
        if (latest.current.ownerKey === owner)
          release(settlers.current, key, attempt, step.release);
        void step.confirmation?.then((result) =>
          apply(deliveryAfterConfirmation(result, version, attempt)),
        );
      };
      void target.respond(request, reply).then(
        (outcome) => apply(deliveryAfterOutcome(outcome, version, attempt)),
        () => apply(deliveryAfterOutcome(FAILED, version, attempt)),
      );
      return sent;
    },
    [ledger],
  );

  return useMemo(() => ({ items, respond }), [items, respond]);
}

function release(
  settlers: Map<string, Settler>,
  key: string,
  attempt: object,
  outcome: AgentThreadRequestCardRelease,
): void {
  const settler = settlers.get(key);
  if (settler === undefined || settler.attempt !== attempt) return;
  switch (outcome.kind) {
    case "hold":
      return;
    case "resolve":
      settlers.delete(key);
      settler.resolve();
      return;
    case "reject":
      settlers.delete(key);
      settler.reject(new Error(outcome.error));
      return;
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

function present(
  open: readonly AgentRuntimeRequest[],
  deliveries: AgentThreadRequestDeliveries,
  sendable: boolean,
): readonly AgentThreadPendingRequest[] {
  if (open.length === 0) return NO_ITEMS;
  return open.map((request) => {
    const key = agentThreadPendingRequestKey(request);
    const delivery = deliveries.get(key);
    return {
      key,
      request,
      state: stateOf(request, delivery, sendable),
      error: delivery?.kind === "refused" ? delivery.error : null,
    };
  });
}

function stateOf(
  request: AgentRuntimeRequest,
  delivery: AgentThreadRequestDeliveryRecord | undefined,
  sendable: boolean,
): AgentThreadPendingRequestState {
  const sending = sendingState(delivery);
  if (sending !== null) return sending;
  if (request.status !== "pending") return NOT_LIVE;
  if (delivery?.kind === "closed" && delivery.version === request.version) return NOT_ANSWERABLE;
  if (!sendable) return DISABLED;
  return ANSWERABLE;
}

function sendingState(
  delivery: AgentThreadRequestDeliveryRecord | undefined,
): AgentThreadPendingRequestState | null {
  if (delivery === undefined) return null;
  const kind = delivery.kind;
  switch (kind) {
    case "sending":
    case "awaiting":
      return SENDING;
    case "checking":
      return CHECKING;
    case "closed":
    case "refused":
      return null;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function stable(
  previous: readonly AgentThreadPendingRequest[],
  next: readonly AgentThreadPendingRequest[],
): readonly AgentThreadPendingRequest[] {
  if (next.length === 0) return NO_ITEMS;
  const known = new Map(previous.map((item) => [item.key, item]));
  const kept = next.map((item) => {
    const prior = known.get(item.key);
    if (prior === undefined) return item;
    const same =
      prior.request === item.request &&
      prior.error === item.error &&
      sameState(prior.state, item.state);
    return same ? prior : item;
  });
  const unchanged =
    kept.length === previous.length && kept.every((item, index) => item === previous[index]);
  return unchanged ? previous : kept;
}

function sameState(
  left: AgentThreadPendingRequestState,
  right: AgentThreadPendingRequestState,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "readOnly" && right.kind === "readOnly") return left.reason === right.reason;
  return true;
}
