export type AgentComposerDraftIdentity =
  | { readonly kind: "none"; readonly requested: string | null }
  | { readonly kind: "thread"; readonly key: string }
  | { readonly kind: "new"; readonly key: string; readonly machine: string | null };

export type AgentComposerDraftHold = "released" | "carriable" | "anchored";

export type AgentComposerDraftRetargetCause = "environment" | "navigation";

export interface AgentComposerDraftCarry {
  readonly from: string;
  readonly to: string;
}

export interface AgentComposerDraftLineage {
  readonly presented: AgentComposerDraftIdentity;
  readonly hold: AgentComposerDraftHold;
  readonly awaiting: string | null;
  readonly carriedFrom: string | null;
}

export const NO_AGENT_COMPOSER_DRAFT: AgentComposerDraftIdentity = Object.freeze({
  kind: "none",
  requested: null,
});

const CARRIED_DRAFT_SEPARATOR = "\n\n";
const TRAILING_WHITESPACE = /\s+$/u;

export function openAgentComposerDraftLineage(
  identity: AgentComposerDraftIdentity,
): AgentComposerDraftLineage {
  return { presented: identity, hold: "released", awaiting: null, carriedFrom: null };
}

export function advanceAgentComposerDraftLineage(
  lineage: AgentComposerDraftLineage,
  next: AgentComposerDraftIdentity,
  cause: AgentComposerDraftRetargetCause,
): AgentComposerDraftLineage {
  switch (next.kind) {
    case "none":
      return withoutTarget(lineage, next, cause);
    case "thread":
      return agentComposerDraftIdentityEqual(lineage.presented, next)
        ? lineage
        : openAgentComposerDraftLineage(next);
    case "new":
      return retargeted(lineage, next, cause);
    default:
      return unsupportedIdentity(next);
  }
}

export function agentComposerDraftIdentityEqual(
  left: AgentComposerDraftIdentity,
  right: AgentComposerDraftIdentity,
): boolean {
  if (left.kind === "none" && right.kind === "none") return left.requested === right.requested;
  if (left.kind === "none" || right.kind === "none") return false;
  if (left.kind !== right.kind || left.key !== right.key) return false;
  if (left.kind === "new" && right.kind === "new") return left.machine === right.machine;
  return true;
}

export function agentComposerDraftIdentityKey(identity: AgentComposerDraftIdentity): string | null {
  return identity.kind === "none" ? null : identity.key;
}

export function carriedAgentComposerDraftText(carried: string, stored: string): string {
  if (stored.trim() === "") return carried;
  if (carried.trim() === "") return stored;
  if (carried === stored) return carried;
  return `${carried.replace(TRAILING_WHITESPACE, "")}${CARRIED_DRAFT_SEPARATOR}${stored}`;
}

function withoutTarget(
  lineage: AgentComposerDraftLineage,
  next: Extract<AgentComposerDraftIdentity, { kind: "none" }>,
  cause: AgentComposerDraftRetargetCause,
): AgentComposerDraftLineage {
  if (lineage.presented.kind !== "new") {
    return agentComposerDraftIdentityEqual(lineage.presented, next)
      ? lineage
      : openAgentComposerDraftLineage(next);
  }
  if (lineage.hold === "released") {
    return {
      ...lineage,
      hold: cause === "navigation" ? "anchored" : "carriable",
      awaiting: next.requested,
    };
  }
  if (lineage.awaiting === next.requested) return lineage;
  if (lineage.hold === "carriable" && cause === "navigation") {
    return { ...lineage, hold: "anchored", awaiting: next.requested };
  }
  return { ...lineage, awaiting: next.requested };
}

function retargeted(
  lineage: AgentComposerDraftLineage,
  next: Extract<AgentComposerDraftIdentity, { kind: "new" }>,
  cause: AgentComposerDraftRetargetCause,
): AgentComposerDraftLineage {
  const presented = lineage.presented;
  if (presented.kind !== "new") return openAgentComposerDraftLineage(next);
  if (presented.key === next.key) {
    return lineage.hold === "released" ? lineage : { ...lineage, hold: "released", awaiting: null };
  }
  if (presented.machine === next.machine || !carryAllowed(lineage.hold, cause)) {
    return openAgentComposerDraftLineage(next);
  }
  return { presented: next, hold: "released", awaiting: null, carriedFrom: presented.key };
}

function carryAllowed(
  hold: AgentComposerDraftHold,
  cause: AgentComposerDraftRetargetCause,
): boolean {
  switch (hold) {
    case "carriable":
      return true;
    case "anchored":
      return false;
    case "released":
      return cause === "environment";
    default:
      return unsupportedHold(hold);
  }
}

function unsupportedIdentity(identity: never): never {
  throw new TypeError(`Unsupported composer draft identity: ${String(identity)}.`);
}

function unsupportedHold(hold: never): never {
  throw new TypeError(`Unsupported composer draft hold: ${String(hold)}.`);
}
