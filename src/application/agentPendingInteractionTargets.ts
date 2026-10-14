import { agentRootOwnerId } from "../domain/agentProject";
import { runningTurn, type AgentTurn } from "../domain/agentThread";
import { remoteAgentThreadRequestScope } from "../domain/remoteAgentThreadRequestScope";
import type { AgentThreadRequestScope } from "./agentThreadRequestPorts";
import type { AgentThreadView, RemoteAgentThreadExecution } from "./agentThreadPorts";
import {
  isRemoteAgentThreadRequestDescription,
  type RemoteAgentThreadRequestDescription,
} from "./remoteAgentThreadRequestWatch";

export const MAX_AGENT_PENDING_INTERACTION_THREADS = 8;
export const MAX_AGENT_PENDING_INTERACTION_DESCRIBED_REMOTE_THREADS = 4;
export const MAX_AGENT_PENDING_INTERACTION_DESCRIBED_LEGACY_THREADS = 2;

export interface AgentPendingInteractionTarget {
  readonly threadId: string;
  readonly turnId: string;
  readonly scope: AgentThreadRequestScope;
  readonly key: string;
  readonly description: RemoteAgentThreadRequestDescription | null;
}

interface Candidate {
  readonly view: AgentThreadView;
  readonly pinned: boolean;
  readonly target: AgentPendingInteractionTarget;
}

interface Budget {
  remote: number;
  legacy: number;
}

export function agentPendingInteractionTargets(
  views: ReadonlyArray<AgentThreadView>,
  pinnedThreadId: string | null = null,
): ReadonlyArray<AgentPendingInteractionTarget> {
  const candidates = views
    .flatMap((view) => candidateOf(view, view.thread.threadId === pinnedThreadId))
    .sort(byPinnedThenRecency);
  const budget: Budget = { remote: 0, legacy: 0 };
  const targets: AgentPendingInteractionTarget[] = [];
  for (const { target } of candidates) {
    if (targets.length >= MAX_AGENT_PENDING_INTERACTION_THREADS) break;
    if (!admitted(budget, target.description)) continue;
    targets.push(target);
  }
  return targets;
}

export function agentThreadRequestScopeKey(scope: AgentThreadRequestScope): string {
  return JSON.stringify([scope.rootKey, scope.ownerId, scope.threadId, scope.workspaceId]);
}

function candidateOf(view: AgentThreadView, pinned: boolean): readonly Candidate[] {
  if (view.lifecycle !== "running") return [];
  const turn = runningTurn(view.thread);
  if (turn === null) return [];
  const target =
    view.execution?.kind === "remote"
      ? remoteTarget(view, view.execution, turn, pinned)
      : localTarget(view, turn);
  if (target === null) return [];
  return [{ view, pinned, target }];
}

function localTarget(view: AgentThreadView, turn: AgentTurn): AgentPendingInteractionTarget | null {
  if (view.thread.provider.kind === "codex" && turn.codexTransport !== "appServer") return null;
  const { rootKey, ownerId: workspaceId } = view.thread.owner;
  const scope = {
    rootKey,
    ownerId: agentRootOwnerId(rootKey),
    threadId: view.thread.threadId,
    workspaceId,
  };
  return targetOf(view, turn, scope, null);
}

function remoteTarget(
  view: AgentThreadView,
  execution: RemoteAgentThreadExecution,
  turn: AgentTurn,
  pinned: boolean,
): AgentPendingInteractionTarget | null {
  const scope = remoteAgentThreadRequestScope(execution);
  if (scope === null) return null;
  const requests = execution.requests;
  const source = requests?.source ?? "legacy";
  if (source === "legacy" && execution.interactiveQuestions !== true) return null;
  const sequences = new Map(Object.entries(requests?.sequences ?? {}));
  const description: RemoteAgentThreadRequestDescription = {
    source,
    reachable: execution.reachability.kind === "reachable",
    turns: [
      {
        turnId: turn.turnId,
        startedAtEpochMs: turn.startedAtEpochMs,
        interactionSequence: sequences.get(turn.turnId) ?? null,
        terminal: false,
      },
    ],
    awaiting: (requests?.awaitingApproval ?? []).filter((turnId) => turnId === turn.turnId),
  };
  if (!isRemoteAgentThreadRequestDescription(description)) return null;
  return targetOf(view, turn, scope, pinned ? null : description);
}

function targetOf(
  view: AgentThreadView,
  turn: AgentTurn,
  scope: AgentThreadRequestScope,
  description: RemoteAgentThreadRequestDescription | null,
): AgentPendingInteractionTarget {
  const key = JSON.stringify([agentThreadRequestScopeKey(scope), turn.turnId]);
  return { threadId: view.thread.threadId, turnId: turn.turnId, scope, key, description };
}

function admitted(
  budget: Budget,
  description: RemoteAgentThreadRequestDescription | null,
): boolean {
  if (description === null) return true;
  if (budget.remote >= MAX_AGENT_PENDING_INTERACTION_DESCRIBED_REMOTE_THREADS) return false;
  const legacy = description.source === "legacy";
  if (legacy && budget.legacy >= MAX_AGENT_PENDING_INTERACTION_DESCRIBED_LEGACY_THREADS)
    return false;
  budget.remote += 1;
  if (legacy) budget.legacy += 1;
  return true;
}

function byPinnedThenRecency(left: Candidate, right: Candidate): number {
  const pinned = Number(right.pinned) - Number(left.pinned);
  if (pinned !== 0) return pinned;
  return right.view.thread.updatedAtEpochMs - left.view.thread.updatedAtEpochMs;
}
