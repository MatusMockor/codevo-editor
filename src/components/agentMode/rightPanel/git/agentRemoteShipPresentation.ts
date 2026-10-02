import type { AgentThreadView } from "../../../../application/agentThreadPorts";
import { agentShipStatus, type AgentShipAvailability } from "../../../../domain/agentShip";
import {
  AGENT_SHIP_BLOCKED_COMMIT_FIRST,
  agentShipAvailability,
} from "../../agentModePresentation";

export const REMOTE_SHIP_NOTHING_TO_PUSH = "Everything is already on origin.";
export const REMOTE_SHIP_LOADING = "Reading the server branch…";

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
    push: pushAvailability(availability.push, upstream, status.worktree.dirty),
    compareUrl:
      ship.kind === "pushed"
        ? (ship.receipt.compareUrl ?? status.remote?.compareUrl ?? null)
        : null,
  };
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

function pushAvailability(
  gate: AgentShipAvailability,
  upstream: { readonly ahead: number; readonly behind: number } | null,
  dirty: boolean,
): AgentShipAvailability {
  if (gate.kind === "blocked") return gate;
  if (upstream === null) return AVAILABLE;
  if (upstream.ahead > 0) return AVAILABLE;
  if (dirty) return { kind: "blocked", reason: AGENT_SHIP_BLOCKED_COMMIT_FIRST };
  return { kind: "blocked", reason: REMOTE_SHIP_NOTHING_TO_PUSH };
}
