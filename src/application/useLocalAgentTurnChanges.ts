import { useCallback, useLayoutEffect, useRef } from "react";
import {
  agentProjectOwnsLaunchRoot,
  agentProjectOwnsOwner,
  type AgentProjectDescriptor,
} from "../domain/agentProject";
import { isTerminalAgentTurnStatus, type AgentThread, type AgentTurn } from "../domain/agentThread";
import type {
  AgentTurnChangesDenialReason,
  AgentTurnChangesGateway,
} from "../domain/agentTurnChanges";
import type { AgentThreadHistoryPageView } from "./useAgentThreadHistory";
import {
  authorizedTurnChanges,
  createAgentTurnChangesReader,
  MAX_TURN_CHANGES_LEASES,
  TURN_CHANGES_NOT_APPLICABLE,
} from "./agentTurnChangesReader";

export interface LocalAgentTurnChangesDependencies {
  readonly gateway: AgentTurnChangesGateway | null;
  readonly projects: readonly AgentProjectDescriptor[];
  readonly threads: ReadonlyMap<string, AgentThread>;
  readonly historyPage: AgentThreadHistoryPageView | null;
}

type LocalTurnChangesTarget =
  | {
      readonly kind: "target";
      readonly gateway: AgentTurnChangesGateway;
      readonly rootPath: string;
      readonly identity: string;
    }
  | { readonly kind: "notApplicable" }
  | { readonly kind: "denied"; readonly reason: AgentTurnChangesDenialReason };

const NOT_APPLICABLE: LocalTurnChangesTarget = { kind: "notApplicable" };
const denied = (reason: AgentTurnChangesDenialReason): LocalTurnChangesTarget => ({
  kind: "denied",
  reason,
});

function finishedTurn(
  deps: LocalAgentTurnChangesDependencies,
  thread: AgentThread,
  turnId: string,
): AgentTurn | null {
  const turn =
    thread.turns.find((candidate) => candidate.turnId === turnId) ??
    (deps.historyPage?.threadId === thread.threadId
      ? deps.historyPage.turns.find((candidate) => candidate.turnId === turnId)
      : undefined);
  if (!turn || !isTerminalAgentTurnStatus(turn.status)) return null;
  return turn;
}

function targetFor(
  deps: LocalAgentTurnChangesDependencies,
  threadId: string,
  turnId: string,
): LocalTurnChangesTarget {
  const thread = deps.threads.get(threadId);
  if (!thread) return NOT_APPLICABLE;
  const turn = finishedTurn(deps, thread, turnId);
  if (turn === null) return NOT_APPLICABLE;
  const project = deps.projects.find((candidate) => candidate.rootKey === thread.owner.rootKey);
  if (!project || project.trust === "unknown") return NOT_APPLICABLE;
  const deny = (reason: AgentTurnChangesDenialReason) =>
    project.repositories.length === 0 ? NOT_APPLICABLE : denied(reason);
  if (deps.gateway === null) return deny("gatewayMissing");
  if (project.trust === "untrusted") return deny("untrusted");
  if (!agentProjectOwnsOwner(project, thread.owner)) return deny("ownerMismatch");
  if (!agentProjectOwnsLaunchRoot(project, thread.owner.repositoryRoot))
    return deny("launchRootNotOwned");
  return {
    kind: "target",
    gateway: deps.gateway,
    rootPath: thread.target.worktreePath ?? thread.owner.repositoryRoot,
    identity: JSON.stringify([
      project.rootKey,
      project.rootPath,
      project.ownerId,
      project.generation,
      project.leaseToken,
      thread.owner.ownerId,
      thread.owner.repositoryRoot,
      thread.target.isolation,
      thread.target.worktreePath,
      turn.turnId,
      turn.startedAtEpochMs,
      turn.endedAtEpochMs,
      turn.status,
    ]),
  };
}

function targetIdentity(target: LocalTurnChangesTarget): string | null {
  if (target.kind !== "target") return null;
  return target.identity;
}

function displayScope(deps: LocalAgentTurnChangesDependencies, threadId: string): string {
  const thread = deps.threads.get(threadId);
  if (!thread) return "missing";
  const project = deps.projects.find((candidate) => candidate.rootKey === thread.owner.rootKey);
  const turns = [
    ...thread.turns,
    ...(deps.historyPage?.threadId === threadId ? deps.historyPage.turns : []),
  ];
  return JSON.stringify([
    project && [
      project.rootKey,
      project.rootPath,
      project.ownerId,
      project.generation,
      project.leaseToken,
      project.trust,
      [...(project.runtimeOwnerIds ?? [])].sort(),
      project.repositories.map((repository) => repository.repositoryRoot).sort(),
    ],
    thread.owner,
    thread.target,
    turns
      .filter((turn) => isTerminalAgentTurnStatus(turn.status))
      .map((turn) => [turn.turnId, turn.startedAtEpochMs, turn.endedAtEpochMs, turn.status]),
  ]);
}

/** Descriptor and turn leases survive harmless streaming renders, never owner replacement. */
export function useLocalAgentTurnChanges(dependencies: LocalAgentTurnChangesDependencies) {
  const deps = useRef(dependencies);
  deps.current = dependencies;
  const revisions = useRef(
    new Map<string, { scope: string; gateway: AgentTurnChangesGateway | null; revision: object }>(),
  );
  const getTurnChangesRevision = useCallback((threadId: string): object => {
    const current = deps.current;
    const scope = displayScope(current, threadId);
    let entry = revisions.current.get(threadId);
    if (!entry || entry.scope !== scope || entry.gateway !== current.gateway) {
      entry = { scope, gateway: current.gateway, revision: {} };
      revisions.current.set(threadId, entry);
      while (revisions.current.size > 64)
        revisions.current.delete(revisions.current.keys().next().value!);
    }
    return entry.revision;
  }, []);
  // Advance retained epochs even when no UI read occurs during an A → B → A transition.
  for (const threadId of revisions.current.keys()) getTurnChangesRevision(threadId);
  const mounted = useRef(true);
  const leases = useRef(
    new Map<
      string,
      {
        threadId: string;
        turnId: string;
        identity: string;
        gateway: AgentTurnChangesGateway;
        lease: object;
      }
    >(),
  );
  let revoked = false;
  for (const [key, captured] of leases.current) {
    const target = targetFor(dependencies, captured.threadId, captured.turnId);
    if (targetIdentity(target) !== captured.identity || dependencies.gateway !== captured.gateway) {
      leases.current.delete(key);
      revoked = true;
    }
  }
  const scope = JSON.stringify(
    dependencies.projects
      .map((project) =>
        JSON.stringify([
          project.rootKey,
          project.rootPath,
          project.ownerId,
          project.generation,
          project.leaseToken,
          project.trust,
          [...(project.runtimeOwnerIds ?? [])].sort(),
          project.repositories.map((repository) => repository.repositoryRoot).sort(),
        ]),
      )
      .sort(),
  );
  const display = useRef({ scope, gateway: dependencies.gateway, revision: {} });
  if (
    revoked ||
    display.current.scope !== scope ||
    display.current.gateway !== dependencies.gateway
  )
    display.current = { scope, gateway: dependencies.gateway, revision: {} };
  useLayoutEffect(() => {
    const ownedLeases = leases.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      ownedLeases.clear();
      reader.current?.cancelPendingReads();
    };
  }, []);
  const reader = useRef<ReturnType<typeof createAgentTurnChangesReader> | null>(null);
  if (reader.current === null)
    reader.current = createAgentTurnChangesReader((threadId, turnId) => {
      if (!mounted.current) return TURN_CHANGES_NOT_APPLICABLE;
      const target = targetFor(deps.current, threadId, turnId);
      if (target.kind === "notApplicable") return TURN_CHANGES_NOT_APPLICABLE;
      if (target.kind === "denied") return target;
      const gateway = target.gateway;
      const key = JSON.stringify([threadId, turnId]);
      let captured = leases.current.get(key);
      if (!captured || captured.identity !== target.identity || captured.gateway !== gateway) {
        captured = { threadId, turnId, identity: target.identity, gateway, lease: {} };
        leases.current.set(key, captured);
        for (const [candidateKey, candidate] of leases.current) {
          if (leases.current.size <= MAX_TURN_CHANGES_LEASES) break;
          if (!reader.current?.retainsLease(candidate.lease)) leases.current.delete(candidateKey);
        }
      }
      return authorizedTurnChanges({
        lease: captured.lease,
        identity: captured.identity,
        getSummary: () => gateway.getSummary(target.rootPath, turnId),
        getFileDiff: (path) => gateway.getFileDiff(target.rootPath, turnId, path),
      });
    });
  return {
    ...reader.current,
    turnChangesRevision: display.current.revision,
    getTurnChangesRevision,
  };
}
