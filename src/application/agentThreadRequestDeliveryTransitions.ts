import type { AgentRuntimeRequest } from "../domain/agentRuntimeRequest";
import type { AgentThreadRequestDeliveryRecord } from "./agentThreadRequestDeliveryLedger";
import type { AgentThreadRequestDelivery } from "./agentThreadRequestResponders";
import type { RemoteAgentThreadRequestConfirmation } from "./remoteAgentThreadRequestFeed";

export const AGENT_REQUEST_NOT_ANSWERABLE = "This request can no longer be answered.";
export const AGENT_REQUEST_NOT_DELIVERED = "Your answer was not delivered. Send it again.";
export const AGENT_REQUEST_NOT_SENT = "Your answer was not sent. Send it again.";

export type AgentThreadRequestCardRelease =
  | { readonly kind: "hold" }
  | { readonly kind: "resolve" }
  | { readonly kind: "reject"; readonly error: string };

export interface AgentThreadRequestDeliveryStep {
  readonly next: AgentThreadRequestDeliveryRecord | null;
  readonly release: AgentThreadRequestCardRelease;
  readonly confirmation: Promise<RemoteAgentThreadRequestConfirmation> | null;
}

export type AgentThreadRequestProjection =
  | { readonly kind: "open"; readonly request: AgentRuntimeRequest }
  | { readonly kind: "closed" }
  | { readonly kind: "unknown" };

const HOLD: AgentThreadRequestCardRelease = Object.freeze({ kind: "hold" });
const RESOLVE: AgentThreadRequestCardRelease = Object.freeze({ kind: "resolve" });
const CLOSED: AgentThreadRequestProjection = Object.freeze({ kind: "closed" });
const UNKNOWN: AgentThreadRequestProjection = Object.freeze({ kind: "unknown" });

export function deliveryAfterOutcome(
  outcome: AgentThreadRequestDelivery,
  version: number,
  attempt: object,
): AgentThreadRequestDeliveryStep {
  switch (outcome.kind) {
    case "answered":
      return step({ kind: "awaiting", version, attempt }, HOLD);
    case "notAnswerable":
      return step({ kind: "closed", version, attempt }, rejected(AGENT_REQUEST_NOT_ANSWERABLE));
    case "deliveryUncertain":
      return {
        next: { kind: "checking", version, attempt, abandoned: false },
        release: HOLD,
        confirmation: outcome.confirmation,
      };
    case "notSent":
      return notSent(outcome.reason, version, attempt);
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

export function deliveryAfterConfirmation(
  result: RemoteAgentThreadRequestConfirmation,
  version: number,
  attempt: object,
): AgentThreadRequestDeliveryStep {
  switch (result) {
    case "pending":
      return step(
        { kind: "refused", version, attempt, error: AGENT_REQUEST_NOT_DELIVERED },
        rejected(AGENT_REQUEST_NOT_DELIVERED),
      );
    case "settled":
      return step({ kind: "awaiting", version, attempt }, HOLD);
    case "unconfirmed":
      return step({ kind: "checking", version, attempt, abandoned: true }, HOLD);
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}

export function deliveryAfterReconfirmation(
  result: RemoteAgentThreadRequestConfirmation,
  record: AgentThreadRequestDeliveryRecord,
): AgentThreadRequestDeliveryStep | null {
  if (result === "unconfirmed") return null;
  return deliveryAfterConfirmation(result, record.version, record.attempt);
}

export function deliveryAfterProjection(
  record: AgentThreadRequestDeliveryRecord,
  projection: AgentThreadRequestProjection,
): AgentThreadRequestDeliveryStep | null {
  switch (projection.kind) {
    case "open":
      return deliveryAfterOpenRequest(record, projection.request);
    case "closed":
      return record.kind === "sending" ? null : step(null, RESOLVE);
    case "unknown":
      return null;
    default: {
      const exhaustive: never = projection;
      return exhaustive;
    }
  }
}

export function agentThreadRequestProjection(
  request: AgentRuntimeRequest | undefined,
  closed: boolean,
): AgentThreadRequestProjection {
  if (request !== undefined) return { kind: "open", request };
  return closed ? CLOSED : UNKNOWN;
}

function deliveryAfterOpenRequest(
  record: AgentThreadRequestDeliveryRecord,
  request: AgentRuntimeRequest,
): AgentThreadRequestDeliveryStep | null {
  if (!superseded(record, request)) return null;
  return step(
    {
      kind: "refused",
      version: request.version,
      attempt: record.attempt,
      error: AGENT_REQUEST_NOT_DELIVERED,
    },
    rejected(AGENT_REQUEST_NOT_DELIVERED),
  );
}

function notSent(
  reason: Extract<AgentThreadRequestDelivery, { kind: "notSent" }>["reason"],
  version: number,
  attempt: object,
): AgentThreadRequestDeliveryStep {
  switch (reason) {
    case "alreadySending":
      return step({ kind: "checking", version, attempt, abandoned: true }, HOLD);
    case "unreachable":
    case "failed":
      return step(
        { kind: "refused", version, attempt, error: null },
        rejected(AGENT_REQUEST_NOT_SENT),
      );
    case "notDescribed":
    case "busy":
    case "refused":
      return step(
        { kind: "refused", version, attempt, error: AGENT_REQUEST_NOT_SENT },
        rejected(AGENT_REQUEST_NOT_SENT),
      );
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

function superseded(
  record: AgentThreadRequestDeliveryRecord,
  request: AgentRuntimeRequest,
): boolean {
  if (request.status !== "pending" || request.version <= record.version) return false;
  if (record.kind === "awaiting") return true;
  return record.kind === "checking" && record.abandoned;
}

function step(
  next: AgentThreadRequestDeliveryRecord | null,
  release: AgentThreadRequestCardRelease,
): AgentThreadRequestDeliveryStep {
  return { next, release, confirmation: null };
}

function rejected(error: string): AgentThreadRequestCardRelease {
  return { kind: "reject", error };
}
