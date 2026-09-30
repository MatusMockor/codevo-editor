import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  agentThreadLocation,
  type AgentMachine,
  type AgentWorkspaceLocation,
} from "../../domain/agentWorkspaceLocation";
import { agentLiveCheckoutBranch, type AgentLiveCheckoutBranches } from "./agentLiveCheckoutBranch";
import { agentShipBranchLabel } from "./agentModePresentation";

export interface AgentComposerServerName {
  readonly id: string;
  readonly name: string;
}

const UNKNOWN_SERVER_NAME = "Server";

export function agentComposerThreadLocation(
  view: AgentThreadView | null,
  servers: ReadonlyArray<AgentComposerServerName>,
  live: AgentLiveCheckoutBranches | null | undefined,
): AgentWorkspaceLocation | null {
  if (view === null) return null;
  const { thread } = view;
  const serverName = threadServerName(view, servers);
  return agentThreadLocation({
    isolation: thread.target.isolation,
    worktreePath: thread.target.worktreePath,
    repositoryRoot: thread.owner.repositoryRoot,
    serverName,
    branch: threadBranch(view, serverName, live),
  });
}

export function agentWorkspaceLocationEqual(
  left: AgentWorkspaceLocation | null | undefined,
  right: AgentWorkspaceLocation | null | undefined,
): boolean {
  if (left === right) return true;
  if (left === null || left === undefined || right === null || right === undefined) return false;
  return (
    sameMachine(left.machine, right.machine) &&
    left.checkout === right.checkout &&
    left.branch === right.branch &&
    left.path === right.path
  );
}

function threadServerName(
  view: AgentThreadView,
  servers: ReadonlyArray<AgentComposerServerName>,
): string | null {
  const execution = view.execution;
  if (execution?.kind !== "remote") return null;
  return servers.find((server) => server.id === execution.serverId)?.name ?? UNKNOWN_SERVER_NAME;
}

function threadBranch(
  view: AgentThreadView,
  serverName: string | null,
  live: AgentLiveCheckoutBranches | null | undefined,
): string | null {
  if (serverName !== null) return null;
  const { target, owner } = view.thread;
  if (target.isolation === "in-place" && target.worktreePath === null) {
    return agentLiveCheckoutBranch(live, owner.repositoryRoot);
  }
  return agentShipBranchLabel(view.ship);
}

function sameMachine(left: AgentMachine, right: AgentMachine): boolean {
  if (left.kind === "thisComputer" || right.kind === "thisComputer")
    return left.kind === right.kind;
  return left.name === right.name;
}
