import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  agentLocationTokenText,
  agentMachineLabel,
  agentThreadLocation,
  type AgentWorkspaceLocation,
} from "../../domain/agentWorkspaceLocation";
import type { AgentCliKind } from "../../domain/agentTask";
import { agentShipBranchLabel } from "./agentModePresentation";
import { agentProviderLabel } from "./agentSidebarPresentation";

export type AgentThreadRowBranch =
  | { readonly kind: "unknown" }
  | { readonly kind: "checkout"; readonly name: string }
  | { readonly kind: "worktree"; readonly name: string };

export interface AgentThreadRowLocation {
  readonly branch: AgentThreadRowBranch;
  readonly title: string;
}

export interface AgentThreadRowLocationInput {
  readonly serverName: string | null;
  readonly rememberedBranch: string | null;
}

const FALLBACK_SERVER_NAME = "Server";
const SEPARATOR = " · ";
const UNKNOWN_BRANCH: AgentThreadRowBranch = Object.freeze({ kind: "unknown" });

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
  return { branch: rowBranch(location), title: rowTitle(location) };
}

export function agentThreadRowServerName(
  view: AgentThreadView,
  serverNames: ReadonlyMap<string, string>,
): string | null {
  const execution = view.execution;
  if (execution?.kind !== "remote") return null;
  return serverNames.get(execution.serverId) ?? FALLBACK_SERVER_NAME;
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
  return agentRowRuntime(
    view.thread.provider.kind,
    view.execution?.kind === "remote" ? "server" : "local",
    connectedServerName,
  );
}

export function agentRowRuntime(
  provider: AgentCliKind,
  place: AgentThreadRowRuntimePlace,
  connectedServerName: string | null,
): AgentThreadRowRuntime {
  const providerLabel = agentProviderLabel(provider);
  if (place === "local") {
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

function rowBranch(location: AgentWorkspaceLocation): AgentThreadRowBranch {
  const name = location.branch;
  if (name === null) return UNKNOWN_BRANCH;
  switch (location.checkout) {
    case "localCheckout":
    case "serverCheckout":
      return { kind: "checkout", name };
    case "newWorktree":
    case "worktree":
    case "previousWorktree":
      return { kind: "worktree", name };
  }
}

function rowTitle(location: AgentWorkspaceLocation): string {
  const text = agentLocationTokenText(location);
  if (location.machine.kind === "server") return text;
  return `${agentMachineLabel(location.machine)}${SEPARATOR}${text}`;
}
