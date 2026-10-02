import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  agentCheckoutLabel,
  agentLocationTokenText,
  agentThreadLocation,
  type AgentWorkspaceLocation,
} from "../../domain/agentWorkspaceLocation";
import type { AgentCliKind } from "../../domain/agentTask";
import { agentShipBranchLabel } from "./agentModePresentation";
import { agentProviderLabel } from "./agentSidebarPresentation";

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

export function agentThreadRowGroupedContext(
  repositoryLabel: string | null,
  serverName: string | null,
): string | null {
  const parts = [serverName, repositoryLabel].filter(
    (part): part is string => part !== null && part !== "",
  );
  return parts.length === 0 ? null : parts.join(SEPARATOR);
}

export type AgentThreadRowRuntimePlace = "local" | "server";

export interface AgentThreadRowRuntime {
  readonly place: AgentThreadRowRuntimePlace;
  readonly provider: AgentCliKind;
  readonly label: string;
}

export function agentThreadRowRuntime(
  view: AgentThreadView,
  connectedServerName: string | null,
): AgentThreadRowRuntime {
  const provider = view.thread.provider.kind;
  const providerLabel = agentProviderLabel(provider);
  if (view.execution?.kind !== "remote") {
    return { place: "local", provider, label: `${providerLabel}, local` };
  }
  const name = connectedServerName?.trim() ?? "";
  const where = name === "" ? "server" : name;
  return { place: "server", provider, label: `${providerLabel}, on ${where}` };
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
