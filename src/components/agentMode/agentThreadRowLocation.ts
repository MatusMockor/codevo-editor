import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  agentCheckoutLabel,
  agentLocationTokenText,
  agentThreadLocation,
  type AgentWorkspaceLocation,
} from "../../domain/agentWorkspaceLocation";
import { agentShipBranchLabel } from "./agentModePresentation";

export type AgentThreadRowGlyph = "localCheckout" | "worktree" | "server";

export interface AgentThreadRowLocation {
  readonly glyph: AgentThreadRowGlyph;
  readonly label: string;
  readonly title: string;
}

export interface AgentThreadRowLocationInput {
  readonly serverName: string | null;
  readonly rememberedBranch: string | null;
}

const FALLBACK_SERVER_NAME = "Server";
const SEPARATOR = " · ";

export function agentThreadRowLocation(
  view: AgentThreadView,
  input: AgentThreadRowLocationInput,
): AgentThreadRowLocation {
  const target = view.thread.target;
  const location = agentThreadLocation({
    isolation: target.isolation,
    worktreePath: target.worktreePath,
    repositoryRoot: view.thread.owner.repositoryRoot,
    serverName: input.serverName,
    branch: knownBranch(view, input),
  });
  return {
    glyph: rowGlyph(location),
    label: location.branch ?? agentCheckoutLabel(location.checkout),
    title: agentLocationTokenText(location),
  };
}

export function agentThreadRowServerName(
  view: AgentThreadView,
  serverNames: ReadonlyMap<string, string>,
): string | null {
  const execution = view.execution;
  if (execution?.kind !== "remote") return null;
  return serverNames.get(execution.serverId) ?? FALLBACK_SERVER_NAME;
}

export function agentThreadRowProjectLine(projectLabel: string, serverName: string | null): string {
  return serverName === null ? projectLabel : `${serverName}${SEPARATOR}${projectLabel}`;
}

function knownBranch(view: AgentThreadView, input: AgentThreadRowLocationInput): string | null {
  if (input.serverName !== null) return null;
  if (view.thread.target.isolation === "worktree") return agentShipBranchLabel(view.ship);
  return input.rememberedBranch;
}

function rowGlyph(location: AgentWorkspaceLocation): AgentThreadRowGlyph {
  if (location.machine.kind === "server") return "server";
  switch (location.checkout) {
    case "localCheckout":
    case "serverCheckout":
      return "localCheckout";
    case "newWorktree":
    case "worktree":
    case "previousWorktree":
      return "worktree";
  }
}
