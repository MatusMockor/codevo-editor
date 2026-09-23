import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { isTerminalAgentTurnStatus } from "../domain/agentThread";
import type { RemoteRunnerGateway, RemoteRunnerTask } from "../domain/remoteRunner";
import type { AgentThreadView } from "./agentThreadPorts";
import {
  authorizedTurnChanges,
  createAgentTurnChangesReader,
  MAX_TURN_CHANGES_LEASES,
  TURN_CHANGES_NOT_APPLICABLE,
} from "./agentTurnChangesReader";
import type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
import { remoteAgentProjectKey, remoteAgentThreadKey } from "./remoteAgentProjection";
import { isRemoteTaskTerminal } from "./remoteRunnerTaskState";

export interface RemoteAgentTurnChangesInput {
  readonly gateway: RemoteRunnerGateway | null;
  readonly owner: object;
  readonly valid: (owner: object) => boolean;
  readonly snapshots: readonly RemoteAgentInventorySnapshot[];
  readonly views: ReadonlyMap<string, AgentThreadView>;
}
interface ServerIndex {
  readonly snapshot: RemoteAgentInventorySnapshot;
  readonly tasks: ReadonlyMap<string, RemoteRunnerTask | null>;
  readonly projects: ReadonlySet<string>;
}
interface Lease {
  readonly threadId: string;
  readonly turnId: string;
  readonly identity: string;
}

/** Resolves a historical projected turn to its own server task, never the latest task. */
export function useRemoteAgentTurnChanges(input: RemoteAgentTurnChangesInput) {
  const indices = useMemo(() => {
    const result = new Map<string, ServerIndex | null>();
    for (const snapshot of input.snapshots) {
      if (result.has(snapshot.serverId)) {
        result.set(snapshot.serverId, null);
        continue;
      }
      const tasks = new Map<string, RemoteRunnerTask | null>();
      for (const task of snapshot.tasks) tasks.set(task.id, tasks.has(task.id) ? null : task);
      result.set(snapshot.serverId, {
        snapshot,
        tasks,
        projects: new Set(snapshot.projects.map((project) => project.id)),
      });
    }
    return result;
  }, [input.snapshots]);
  const inventoryRevision = useMemo(
    () =>
      JSON.stringify(
        input.snapshots
          .map((snapshot) =>
            JSON.stringify([
              snapshot.serverId,
              snapshot.connected,
              snapshot.descriptor?.runnerId,
              snapshot.descriptor?.capabilities.turnChanges === true,
              snapshot.projects.map((project) => project.id).sort(),
            ]),
          )
          .sort(),
      ),
    [input.snapshots],
  );
  const allowed =
    input.valid(input.owner) &&
    Boolean(input.gateway?.getTurnChanges && input.gateway.getTurnFileDiff);
  const revision = useRef({
    owner: input.owner,
    gateway: input.gateway,
    allowed,
    inventoryRevision,
    value: {},
  });
  if (
    revision.current.owner !== input.owner ||
    revision.current.gateway !== input.gateway ||
    revision.current.allowed !== allowed ||
    revision.current.inventoryRevision !== inventoryRevision
  ) {
    revision.current = {
      owner: input.owner,
      gateway: input.gateway,
      allowed,
      inventoryRevision,
      value: {},
    };
  }
  const mounted = useRef(false);
  const current = useRef({ input, indices });
  current.current = { input, indices };
  const threadRevisions = useRef(
    new Map<
      string,
      { key: string; owner: object; gateway: RemoteRunnerGateway | null; value: object }
    >(),
  );
  const getTurnChangesRevision = (threadId: string): object => {
    const { input: live, indices: servers } = current.current;
    const view = live.views.get(threadId);
    const target = view?.execution;
    const indexed = target ? servers.get(target.serverId) : null;
    const snapshot = indexed?.snapshot;
    const key = JSON.stringify([
      live.valid(live.owner),
      Boolean(live.gateway?.getTurnChanges && live.gateway.getTurnFileDiff),
      target?.serverId,
      target?.runnerId,
      target?.projectId,
      target?.conversationId,
      view?.thread.owner.rootKey,
      view?.thread.owner.ownerId,
      snapshot?.connected,
      snapshot?.descriptor?.runnerId,
      snapshot?.descriptor?.capabilities.turnChanges === true,
      target ? indexed?.projects.has(target.projectId) : false,
      view?.thread.turns
        .filter((turn) => isTerminalAgentTurnStatus(turn.status))
        .map((turn) => {
          const task = indexed?.tasks.get(turn.turnId);
          return [
            turn.turnId,
            turn.status.kind,
            task === null
              ? "duplicate"
              : task === undefined
                ? "missing"
                : [
                    task.id,
                    task.runnerId,
                    task.projectId,
                    task.conversationId ?? task.id,
                    task.sequence,
                    task.createdAt,
                    task.provider,
                    task.isolation ?? "worktree",
                    task.status,
                  ],
          ];
        }),
    ]);
    let entry = threadRevisions.current.get(threadId);
    if (
      !entry ||
      entry.key !== key ||
      entry.owner !== live.owner ||
      entry.gateway !== live.gateway
    ) {
      entry = { key, owner: live.owner, gateway: live.gateway, value: {} };
      threadRevisions.current.set(threadId, entry);
      while (threadRevisions.current.size > 128)
        threadRevisions.current.delete(threadRevisions.current.keys().next().value!);
    }
    return entry.value;
  };
  // Record intermediate revocations even when the view does not query its epoch during that render.
  for (const threadId of threadRevisions.current.keys()) getTurnChangesRevision(threadId);
  const leases = useRef(new Map<string, Lease>());
  const owner = useRef({ owner: input.owner, gateway: input.gateway });
  if (owner.current.owner !== input.owner || owner.current.gateway !== input.gateway) {
    owner.current = { owner: input.owner, gateway: input.gateway };
    leases.current.clear();
  }

  const resolveTarget = (threadId: string, turnId: string) => {
    const { input: live, indices: servers } = current.current;
    const gateway = live.gateway;
    const view = live.views.get(threadId);
    const execution = view?.execution;
    const turn = view?.thread.turns.find((candidate) => candidate.turnId === turnId);
    if (
      !gateway?.getTurnChanges ||
      !gateway.getTurnFileDiff ||
      !live.valid(live.owner) ||
      !execution ||
      !turn ||
      !isTerminalAgentTurnStatus(turn.status)
    )
      return null;
    const indexed = servers.get(execution.serverId);
    const snapshot = indexed?.snapshot;
    const task = indexed?.tasks.get(turnId);
    if (
      !snapshot?.connected ||
      snapshot.descriptor?.runnerId !== execution.runnerId ||
      snapshot.descriptor.capabilities.turnChanges !== true ||
      !task ||
      !isRemoteTaskTerminal(task) ||
      task.runnerId !== execution.runnerId ||
      task.projectId !== execution.projectId ||
      !indexed?.projects.has(execution.projectId) ||
      (task.conversationId ?? task.id) !== execution.conversationId ||
      remoteAgentThreadKey(execution.serverId, task.runnerId, task.conversationId ?? task.id) !==
        threadId ||
      view.thread.owner.rootKey !==
        remoteAgentProjectKey(execution.serverId, task.runnerId, execution.projectId)
    )
      return null;
    const identity = JSON.stringify([
      execution.serverId,
      task.runnerId,
      task.projectId,
      task.conversationId ?? task.id,
      task.id,
      task.sequence,
      task.createdAt,
      task.provider,
      task.isolation ?? "worktree",
      task.status,
    ]);
    return { gateway, serverId: execution.serverId, taskId: task.id, identity };
  };
  // Observe every ownership transition, including A → B → A between request settlements.
  for (const [key, lease] of leases.current) {
    if (resolveTarget(lease.threadId, lease.turnId)?.identity !== lease.identity)
      leases.current.delete(key);
  }
  const resolver = useRef(resolveTarget);
  resolver.current = resolveTarget;
  const [reader] = useState<ReturnType<typeof createAgentTurnChangesReader>>(() =>
    createAgentTurnChangesReader((threadId, turnId) => {
      if (!mounted.current) return TURN_CHANGES_NOT_APPLICABLE;
      const target = resolver.current(threadId, turnId);
      if (!target) return TURN_CHANGES_NOT_APPLICABLE;
      const key = JSON.stringify([threadId, turnId]);
      let lease = leases.current.get(key);
      if (!lease || lease.identity !== target.identity) {
        lease = { threadId, turnId, identity: target.identity };
        leases.current.set(key, lease);
        for (const [candidateKey, candidate] of leases.current) {
          if (leases.current.size <= MAX_TURN_CHANGES_LEASES) break;
          if (!reader.retainsLease(candidate)) leases.current.delete(candidateKey);
        }
      }
      const request = { serverId: target.serverId, taskId: target.taskId };
      return authorizedTurnChanges({
        lease,
        identity: target.identity,
        getSummary: () => target.gateway.getTurnChanges!(request),
        getFileDiff: (relativePath) =>
          target.gateway.getTurnFileDiff!({ ...request, relativePath }),
      });
    }),
  );
  useLayoutEffect(() => {
    const owned = leases.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      owned.clear();
      reader.cancelPendingReads();
    };
  }, [reader]);
  return {
    turnChangesRevision: revision.current.value,
    getTurnChangesRevision,
    getTurnChanges: reader.getTurnChanges,
    getTurnFileDiff: reader.getTurnFileDiff,
  };
}
