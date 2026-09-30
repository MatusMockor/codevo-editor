import type { AgentTaskIsolation } from "./agentTask";

export type AgentMachine =
  { readonly kind: "thisComputer" } | { readonly kind: "server"; readonly name: string };

export type AgentCheckoutKind =
  "localCheckout" | "serverCheckout" | "newWorktree" | "worktree" | "previousWorktree";

export interface AgentWorkspaceLocation {
  readonly machine: AgentMachine;
  readonly checkout: AgentCheckoutKind;
  readonly branch: string | null;
  readonly path: string | null;
}

export interface AgentDraftLocationInput {
  readonly isolation: AgentTaskIsolation;
  readonly serverName: string | null;
  readonly projectRoot: string;
  readonly branch: string | null;
}

export interface AgentThreadLocationInput {
  readonly isolation: AgentTaskIsolation;
  readonly worktreePath: string | null;
  readonly repositoryRoot: string;
  readonly serverName: string | null;
  readonly branch: string | null;
}

export const THIS_COMPUTER: AgentMachine = Object.freeze({ kind: "thisComputer" });

const FALLBACK_SERVER_NAME = "Server";
const MAX_LABEL_CHARS = 200;
const SEPARATOR = " · ";

export function agentCheckoutLabel(checkout: AgentCheckoutKind): string {
  switch (checkout) {
    case "localCheckout":
      return "Local checkout";
    case "serverCheckout":
      return "Server checkout";
    case "newWorktree":
      return "New worktree";
    case "worktree":
      return "Worktree";
    case "previousWorktree":
      return "Previous worktree";
  }
}

export function agentPreviousWorktreeLabel(branch: string | null): string {
  const name = boundedLabel(branch);
  const label = agentCheckoutLabel("previousWorktree");
  return name === null ? label : `${label} (${name})`;
}

export function agentMachineLabel(machine: AgentMachine): string {
  switch (machine.kind) {
    case "thisComputer":
      return "This computer";
    case "server":
      return machine.name;
  }
}

export function agentDraftLocation(input: AgentDraftLocationInput): AgentWorkspaceLocation {
  const machine = machineFor(input.serverName);
  const remote = machine.kind === "server";
  return {
    machine,
    checkout: draftCheckout(input.isolation, remote),
    branch: boundedLabel(input.branch),
    path: remote ? null : input.projectRoot,
  };
}

export function agentThreadLocation(input: AgentThreadLocationInput): AgentWorkspaceLocation {
  const machine = machineFor(input.serverName);
  const remote = machine.kind === "server";
  const checkout = threadCheckout(input.isolation, input.worktreePath, remote);
  return {
    machine,
    checkout,
    branch: boundedLabel(input.branch),
    path: remote ? null : threadPath(checkout, input),
  };
}

export function agentLocationTokenText(location: AgentWorkspaceLocation): string {
  const parts: string[] = [];
  if (location.machine.kind === "server") parts.push(agentMachineLabel(location.machine));
  parts.push(agentCheckoutLabel(location.checkout));
  if (location.branch !== null) parts.push(location.branch);
  return parts.join(SEPARATOR);
}

function machineFor(serverName: string | null): AgentMachine {
  if (serverName === null) return THIS_COMPUTER;
  return { kind: "server", name: boundedLabel(serverName) ?? FALLBACK_SERVER_NAME };
}

function draftCheckout(isolation: AgentTaskIsolation, remote: boolean): AgentCheckoutKind {
  if (isolation === "worktree") return "newWorktree";
  return remote ? "serverCheckout" : "localCheckout";
}

function threadCheckout(
  isolation: AgentTaskIsolation,
  worktreePath: string | null,
  remote: boolean,
): AgentCheckoutKind {
  if (isolation === "worktree") {
    if (remote) return "worktree";
    return worktreePath === null ? "newWorktree" : "worktree";
  }
  return remote ? "serverCheckout" : "localCheckout";
}

function threadPath(checkout: AgentCheckoutKind, input: AgentThreadLocationInput): string | null {
  if (checkout === "worktree") return input.worktreePath;
  if (checkout === "newWorktree") return null;
  return input.repositoryRoot;
}

function boundedLabel(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return [...trimmed].slice(0, MAX_LABEL_CHARS).join("");
}
