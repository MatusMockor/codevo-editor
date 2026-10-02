import type { AgentThreadView } from "../../application/agentThreadPorts";
import { agentShipStatus } from "../../domain/agentShip";
import type { AgentTaskIsolation } from "../../domain/agentTask";
import type { AgentThreadBranchIdentity } from "../../domain/agentThreadBranchMemory";
import {
  THIS_COMPUTER,
  agentDraftLocation,
  type AgentCheckoutKind,
  type AgentMachine,
  type AgentWorkspaceLocation,
} from "../../domain/agentWorkspaceLocation";
import { agentShipBranchLabel } from "./agentModePresentation";

export type AgentComposerStripRunOn =
  | { readonly kind: "hidden" }
  | { readonly kind: "picker"; readonly machine: AgentMachine }
  | { readonly kind: "label"; readonly machine: AgentMachine };

export type AgentComposerStripCheckout =
  | { readonly kind: "picker"; readonly checkout: AgentCheckoutKind }
  | { readonly kind: "label"; readonly checkout: AgentCheckoutKind };

export interface AgentComposerStrip {
  readonly runOn: AgentComposerStripRunOn;
  readonly checkout: AgentComposerStripCheckout;
}

export type AgentComposerStripInput =
  | {
      readonly kind: "draft";
      readonly isolation: AgentTaskIsolation;
      readonly serverName: string | null;
      readonly serversConfigured: boolean;
      readonly previousWorktreeSelected: boolean;
    }
  | {
      readonly kind: "started";
      readonly location: AgentWorkspaceLocation | null;
      readonly isolation: AgentTaskIsolation;
      readonly serverName: string | null;
    };

export type AgentComposerThreadBranch =
  | { readonly kind: "none" }
  | {
      readonly kind: "live";
      readonly identity: AgentThreadBranchIdentity;
      readonly repositoryRoot: string;
      readonly running: boolean;
    }
  | { readonly kind: "worktree"; readonly branch: string | null; readonly detail: string | null }
  | { readonly kind: "serverCheckout" };

const NO_THREAD_BRANCH: AgentComposerThreadBranch = Object.freeze({ kind: "none" });
const SERVER_CHECKOUT_BRANCH: AgentComposerThreadBranch = Object.freeze({
  kind: "serverCheckout",
});

export function agentComposerStrip(input: AgentComposerStripInput): AgentComposerStrip {
  switch (input.kind) {
    case "draft":
      return draftStrip(input);
    case "started":
      return startedStrip(input);
  }
}

export function agentComposerThreadBranch(view: AgentThreadView | null): AgentComposerThreadBranch {
  if (view === null) return NO_THREAD_BRANCH;
  if (view.execution?.kind === "remote") return remoteThreadBranch(view);
  const { thread } = view;
  if (thread.target.isolation === "in-place" && thread.target.worktreePath === null) {
    return {
      kind: "live",
      identity: {
        threadId: thread.threadId,
        rootKey: thread.owner.rootKey,
        ownerId: thread.owner.ownerId,
      },
      repositoryRoot: thread.owner.repositoryRoot,
      running: view.lifecycle === "running",
    };
  }
  return { kind: "worktree", branch: agentShipBranchLabel(view.ship), detail: aheadDetail(view) };
}

function draftStrip(
  input: Extract<AgentComposerStripInput, { kind: "draft" }>,
): AgentComposerStrip {
  const location = agentDraftLocation({
    isolation: input.isolation,
    serverName: input.serverName,
    projectRoot: "",
    branch: null,
  });
  const checkout: AgentCheckoutKind = input.previousWorktreeSelected
    ? "worktree"
    : location.checkout;
  return {
    runOn: draftRunOn(location.machine, input.serversConfigured),
    checkout: { kind: "picker", checkout },
  };
}

function draftRunOn(machine: AgentMachine, serversConfigured: boolean): AgentComposerStripRunOn {
  if (serversConfigured) return { kind: "picker", machine };
  if (machine.kind === "server") return { kind: "label", machine };
  return { kind: "hidden" };
}

function startedStrip(
  input: Extract<AgentComposerStripInput, { kind: "started" }>,
): AgentComposerStrip {
  const machine = input.location?.machine ?? fallbackMachine(input.serverName);
  const checkout = input.location?.checkout ?? fallbackCheckout(input.isolation, machine);
  return {
    runOn: machine.kind === "server" ? { kind: "label", machine } : { kind: "hidden" },
    checkout: { kind: "label", checkout },
  };
}

function fallbackMachine(serverName: string | null): AgentMachine {
  if (serverName === null) return THIS_COMPUTER;
  return { kind: "server", name: serverName };
}

function fallbackCheckout(isolation: AgentTaskIsolation, machine: AgentMachine): AgentCheckoutKind {
  if (isolation === "worktree") return "worktree";
  return machine.kind === "server" ? "serverCheckout" : "localCheckout";
}

function remoteThreadBranch(view: AgentThreadView): AgentComposerThreadBranch {
  if (view.execution?.gitShip !== true) return NO_THREAD_BRANCH;
  if (view.thread.target.isolation === "in-place") return SERVER_CHECKOUT_BRANCH;
  const status = agentShipStatus(view.ship);
  if (status === null) return NO_THREAD_BRANCH;
  const base = status.primary.branch;
  return {
    kind: "worktree",
    branch: status.worktree.branch,
    detail: base === null ? null : `from ${base}`,
  };
}

function aheadDetail(view: AgentThreadView): string | null {
  const status = agentShipStatus(view.ship);
  if (status === null || status.primary.branch === null) return null;
  return `${status.relation.aheadOfPrimary} ahead of ${status.primary.branch}`;
}
