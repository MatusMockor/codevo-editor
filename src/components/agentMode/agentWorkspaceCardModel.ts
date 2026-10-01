import type { AgentThreadView } from "../../application/agentThreadPorts";
import { agentShipStatus } from "../../domain/agentShip";
import type { AgentTaskIsolation } from "../../domain/agentTask";
import {
  THIS_COMPUTER,
  agentCheckoutLabel,
  agentDraftLocation,
  agentMachineLabel,
  type AgentWorkspaceLocation,
} from "../../domain/agentWorkspaceLocation";
import type { AgentComposerPreviousWorktree } from "./agentComposerPreviousWorktree";
import {
  agentComposerThreadLocation,
  type AgentComposerServerName,
} from "./agentComposerThreadLocation";
import { agentLiveCheckoutBranch, type AgentLiveCheckoutBranches } from "./agentLiveCheckoutBranch";
import { agentShipRelationLabel } from "./agentModePresentation";
import { agentProjectMonogram } from "./agentRailFilter";
import type { AgentSurfaceLocationGlyph } from "./agentSurfaceLocation";

export interface AgentWorkspaceCardProject {
  readonly projectRootKey: string;
  readonly repositoryRoot: string;
  readonly label: string;
}

export type AgentWorkspaceCardInput =
  | {
      readonly kind: "draft";
      readonly project: AgentWorkspaceCardProject;
      readonly isolation: AgentTaskIsolation;
      readonly serverName: string | null;
      readonly previousWorktree: AgentComposerPreviousWorktree | null;
      readonly liveBranches: AgentLiveCheckoutBranches | null | undefined;
    }
  | {
      readonly kind: "thread";
      readonly project: AgentWorkspaceCardProject;
      readonly view: AgentThreadView;
      readonly servers: ReadonlyArray<AgentComposerServerName>;
      readonly liveBranches: AgentLiveCheckoutBranches | null | undefined;
      readonly rememberedBranch: string | null;
    };

export interface AgentWorkspaceCardDetails {
  readonly machine: string;
  readonly checkout: string;
  readonly branch: string | null;
  readonly relation: string | null;
  readonly path: string | null;
}

export interface AgentWorkspaceCard {
  readonly state: "draft" | "thread";
  readonly projectLabel: string;
  readonly monogram: string;
  readonly location: AgentWorkspaceLocation;
  readonly glyph: AgentSurfaceLocationGlyph;
  readonly lead: string;
  readonly rest: string | null;
  readonly accessibleLabel: string;
  readonly details: AgentWorkspaceCardDetails;
  readonly revealPath: string | null;
}

const SEPARATOR = " · ";

export function agentWorkspaceCard(input: AgentWorkspaceCardInput): AgentWorkspaceCard {
  switch (input.kind) {
    case "draft":
      return card("draft", input.project.label, draftLocation(input), null);
    case "thread":
      return card("thread", input.project.label, threadLocation(input), threadRelation(input.view));
  }
}

export function agentWorkspaceCardEqual(
  left: AgentWorkspaceCard | null,
  right: AgentWorkspaceCard | null,
): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  return (
    left.state === right.state &&
    left.projectLabel === right.projectLabel &&
    left.lead === right.lead &&
    left.rest === right.rest &&
    left.glyph === right.glyph &&
    left.revealPath === right.revealPath &&
    left.details.machine === right.details.machine &&
    left.details.checkout === right.details.checkout &&
    left.details.branch === right.details.branch &&
    left.details.relation === right.details.relation &&
    left.details.path === right.details.path
  );
}

function draftLocation(
  input: Extract<AgentWorkspaceCardInput, { kind: "draft" }>,
): AgentWorkspaceLocation {
  const previous = input.isolation === "worktree" ? input.previousWorktree : null;
  if (previous !== null && input.serverName === null) {
    return {
      machine: THIS_COMPUTER,
      checkout: "previousWorktree",
      branch: previous.branch,
      path: previous.worktreePath,
    };
  }
  const local = input.serverName === null && input.isolation === "in-place";
  return agentDraftLocation({
    isolation: input.isolation,
    serverName: input.serverName,
    projectRoot: input.project.repositoryRoot,
    branch: local
      ? agentLiveCheckoutBranch(input.liveBranches, input.project.repositoryRoot)
      : null,
  });
}

function threadLocation(
  input: Extract<AgentWorkspaceCardInput, { kind: "thread" }>,
): AgentWorkspaceLocation {
  const location = agentComposerThreadLocation(input.view, input.servers, input.liveBranches);
  if (location === null) throw new TypeError("A selected thread always has a location.");
  if (location.branch !== null || location.machine.kind !== "thisComputer") return location;
  if (location.checkout !== "localCheckout") return location;
  return { ...location, branch: input.rememberedBranch };
}

function threadRelation(view: AgentThreadView): string | null {
  if (view.execution?.kind === "remote") return null;
  if (view.thread.target.isolation !== "worktree") return null;
  const status = agentShipStatus(view.ship);
  return status === null ? null : agentShipRelationLabel(status);
}

function card(
  state: AgentWorkspaceCard["state"],
  projectLabel: string,
  location: AgentWorkspaceLocation,
  relation: string | null,
): AgentWorkspaceCard {
  const server = location.machine.kind === "server";
  const checkout = agentCheckoutLabel(location.checkout);
  const lead = server ? agentMachineLabel(location.machine) : checkout;
  const restParts = server ? [checkout, location.branch] : [location.branch];
  const rest = joinKnown(restParts, SEPARATOR);
  const path = visiblePath(location);
  return {
    state,
    projectLabel,
    monogram: agentProjectMonogram(projectLabel),
    location,
    glyph: cardGlyph(location),
    lead,
    rest,
    accessibleLabel: `Workspace: ${joinKnown([projectLabel, lead, ...restParts], ", ")}`,
    details: {
      machine: agentMachineLabel(location.machine),
      checkout,
      branch: location.branch,
      relation,
      path,
    },
    revealPath: server ? null : path,
  };
}

function visiblePath(location: AgentWorkspaceLocation): string | null {
  if (location.machine.kind === "server") return null;
  if (location.checkout === "newWorktree") return null;
  return location.path;
}

function cardGlyph(location: AgentWorkspaceLocation): AgentSurfaceLocationGlyph {
  if (location.machine.kind === "server") return "server";
  switch (location.checkout) {
    case "newWorktree":
    case "worktree":
    case "previousWorktree":
      return "branch";
    case "localCheckout":
    case "serverCheckout":
      return "folder";
  }
}

function joinKnown(parts: ReadonlyArray<string | null>, separator: string): string | null {
  const known = parts.filter((part): part is string => part !== null && part !== "");
  return known.length === 0 ? null : known.join(separator);
}
