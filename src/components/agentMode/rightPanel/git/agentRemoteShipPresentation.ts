import type { AgentThreadView } from "../../../../application/agentThreadPorts";
import {
  agentShipStatus,
  type AgentShipAvailability,
  type AgentShipFailure,
} from "../../../../domain/agentShip";
import {
  AGENT_SHIP_BLOCKED_COMMIT_FIRST,
  agentShipAvailability,
  agentShipFailureLabel,
} from "../../agentModePresentation";

export const REMOTE_SHIP_NOTHING_TO_PUSH = "Everything is already on origin.";
export const REMOTE_SHIP_LOADING = "Reading the server branch…";
export const REMOTE_SHIP_DIVERGED =
  "This branch and origin have diverged. Ask the agent to merge or rebase the commits from origin on the server, then push.";
export const REMOTE_SHIP_REJECTED_IN_PLACE =
  "Origin has newer commits on this branch. Ask the agent to merge or rebase them in the server checkout, then retry.";
export const REMOTE_SHIP_REJECTED_IN_PLACE_BEHIND =
  "Origin has newer commits on this branch. Use Update from origin on the server checkout, then retry.";
export const REMOTE_SHIP_REJECTED_WORKTREE =
  "Origin has newer commits on this branch, so it has diverged from the server branch. Ask the agent to merge or rebase them on the server, then retry.";

export const remoteShipNothingAheadOfBase = (branch: string, base: string): string =>
  `${branch} has no commits beyond ${base} to push yet.`;

export interface AgentRemoteShipView {
  readonly branch: string | null;
  readonly base: string | null;
  readonly counts: string | null;
  readonly countsTitle: string | null;
  readonly changes: string | null;
  readonly published: string | null;
  readonly commit: AgentShipAvailability;
  readonly push: AgentShipAvailability;
  readonly compareUrl: string | null;
}

interface PushFacts {
  readonly branch: string;
  readonly base: string | null;
  readonly aheadOfBase: number;
  readonly upstream: { readonly ahead: number; readonly behind: number } | null;
  readonly dirty: boolean;
}

const AVAILABLE: AgentShipAvailability = Object.freeze({ kind: "available" });

export function agentRemoteShipView(view: AgentThreadView): AgentRemoteShipView {
  const ship = view.ship;
  const status = agentShipStatus(ship);
  const availability = agentShipAvailability(view);
  if (status === null) {
    return {
      branch: ship.kind === "pushed" ? ship.receipt.branch : null,
      base: null,
      counts: null,
      countsTitle: null,
      changes: null,
      published: null,
      commit: availability.commit,
      push: availability.push,
      compareUrl: ship.kind === "pushed" ? ship.receipt.compareUrl : null,
    };
  }
  const base = status.primary.branch;
  const { aheadOfPrimary, behindPrimary } = status.relation;
  const upstream = status.remote?.upstream ?? null;
  const changeCount = status.worktree.changeCount;
  return {
    branch: status.worktree.branch,
    base,
    counts: base === null ? null : `↑${aheadOfPrimary} ↓${behindPrimary}`,
    countsTitle: base === null ? null : `${aheadOfPrimary} ahead, ${behindPrimary} behind ${base}`,
    changes:
      changeCount === 0
        ? "No uncommitted changes"
        : changeCount === 1
          ? "1 uncommitted change"
          : `${changeCount} uncommitted changes`,
    published: publishedLabel(upstream, status.worktree.branch),
    commit: availability.commit,
    push: pushAvailability(availability.push, {
      branch: status.worktree.branch,
      base,
      aheadOfBase: aheadOfPrimary,
      upstream,
      dirty: status.worktree.dirty,
    }),
    compareUrl:
      ship.kind === "pushed"
        ? (ship.receipt.compareUrl ?? status.remote?.compareUrl ?? null)
        : null,
  };
}

export function agentRemoteShipFailureLabel(
  view: AgentThreadView,
  failure: AgentShipFailure,
): string {
  if (failure.step !== "push" || failure.reason !== "rejected") {
    return agentShipFailureLabel(failure);
  }
  if (view.thread.target.isolation !== "in-place") return REMOTE_SHIP_REJECTED_WORKTREE;
  const upstream = agentShipStatus(view.ship)?.remote?.upstream ?? null;
  const justBehind = upstream !== null && upstream.ahead === 0 && upstream.behind > 0;
  return justBehind ? REMOTE_SHIP_REJECTED_IN_PLACE_BEHIND : REMOTE_SHIP_REJECTED_IN_PLACE;
}

function publishedLabel(
  upstream: { readonly ahead: number; readonly behind: number } | null,
  branch: string,
): string {
  if (upstream === null) return `${branch} is not on origin yet`;
  if (upstream.ahead === 0 && upstream.behind === 0) return `${branch} is up to date on origin`;
  const parts: string[] = [];
  if (upstream.ahead > 0) parts.push(`${upstream.ahead} not pushed`);
  if (upstream.behind > 0) parts.push(`${upstream.behind} newer on origin`);
  return `${branch}: ${parts.join(", ")}`;
}

function pushAvailability(gate: AgentShipAvailability, facts: PushFacts): AgentShipAvailability {
  if (gate.kind === "blocked") return gate;
  const { upstream } = facts;
  if (upstream === null) return unpublishedPushAvailability(facts);
  if (upstream.ahead > 0 && upstream.behind > 0) {
    return { kind: "blocked", reason: REMOTE_SHIP_DIVERGED };
  }
  if (upstream.ahead > 0) return AVAILABLE;
  if (facts.dirty) return { kind: "blocked", reason: AGENT_SHIP_BLOCKED_COMMIT_FIRST };
  return { kind: "blocked", reason: REMOTE_SHIP_NOTHING_TO_PUSH };
}

function unpublishedPushAvailability(facts: PushFacts): AgentShipAvailability {
  if (facts.base === null || facts.aheadOfBase > 0) return AVAILABLE;
  if (facts.dirty) return { kind: "blocked", reason: AGENT_SHIP_BLOCKED_COMMIT_FIRST };
  return { kind: "blocked", reason: remoteShipNothingAheadOfBase(facts.branch, facts.base) };
}
