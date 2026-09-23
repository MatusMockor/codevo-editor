import type { AgentThreadDropSection } from "../domain/agentThreadOrganization";
import { settleAgentThreadMutation } from "./agentThreadMutationOutcome";
import type { AgentThreadsSurface, AgentThreadView, AgentTasksNotice } from "./agentThreadPorts";
import type { RemoteAgentMetadata } from "./remoteAgentMetadata";

export const isRemoteAgentIdentity = (value: string) =>
  value.startsWith("remote:") || value.startsWith("remote-thread:");

interface Options {
  readonly local: AgentThreadsSurface;
  readonly threads: readonly AgentThreadView[];
  readonly report: (message: string) => void;
  readonly update: (
    threadId: string,
    change: Partial<Omit<RemoteAgentMetadata, "threadId">>,
  ) => Promise<boolean> | void;
  readonly stop: (threadId: string) => Promise<void>;
  readonly batch?: <T>(work: () => Promise<T>) => Promise<T>;
  readonly reorder?: (
    threadId: string,
    targetThreadId: string,
    placement: "before" | "after",
    destination?: AgentThreadDropSection,
  ) => void;
}

/** Routes presentation actions; remote identities can never fall through to local tools. */
export function remoteAgentThreadActions({
  local,
  threads,
  report,
  update,
  stop,
  reorder,
  batch,
}: Options) {
  const byId = new Map(threads.map((view) => [view.thread.threadId, view]));
  const remote = (id: string) => isRemoteAgentIdentity(id) || byId.get(id)?.execution !== undefined;
  const unsupported = (id: string) => {
    report("This action is not available for a server conversation yet.");
    return id;
  };
  const asyncAction =
    <A extends readonly unknown[]>(action: (id: string, ...args: A) => Promise<void>) =>
    async (id: string, ...args: A) => {
      if (remote(id)) unsupported(id);
      else await action(id, ...args);
    };
  const syncAction =
    <A extends readonly unknown[]>(action: (id: string, ...args: A) => void) =>
    (id: string, ...args: A) => {
      if (remote(id)) unsupported(id);
      else action(id, ...args);
    };
  return {
    markThreadViewed(id: string) {
      if (!remote(id)) return local.markThreadViewed(id);
      const thread = byId.get(id)?.thread;
      if (
        thread &&
        (thread.viewedAtEpochMs === null || thread.viewedAtEpochMs < thread.updatedAtEpochMs)
      )
        void update(id, { viewedAtEpochMs: thread.updatedAtEpochMs });
    },
    markThreadUnread(id: string) {
      if (remote(id)) void update(id, { viewedAtEpochMs: null });
      else local.markThreadUnread(id);
    },
    renameThread(id: string, title: string) {
      if (remote(id)) void update(id, { title });
      else local.renameThread(id, title);
    },
    updateThreadOrganization(
      id: string,
      change: {
        readonly snoozedUntil?: number | null;
        readonly settledAt?: number | null;
        readonly sortOrder?: number | null;
      },
    ) {
      if (remote(id)) {
        if (change.settledAt != null && byId.get(id)?.lifecycle === "running") {
          report("Stop the agent before marking this conversation as settled.");
          return;
        }
        void update(id, change);
      } else local.updateThreadOrganization?.(id, change);
    },
    reorderThread(
      id: string,
      targetId: string,
      placement: "before" | "after",
      destination?: AgentThreadDropSection,
    ) {
      if (remote(id)) {
        if (!remote(targetId) || !reorder) {
          unsupported(id);
          return;
        }
        reorder(id, targetId, placement, destination);
      } else if (!remote(targetId)) local.reorderThread?.(id, targetId, placement, destination);
    },
    togglePin(id: string) {
      if (remote(id)) void update(id, { pinned: !byId.get(id)?.thread.pinned });
      else local.togglePin(id);
    },
    archive(id: string): Promise<boolean> {
      if (!remote(id)) return settleAgentThreadMutation(local.archive(id));
      const view = byId.get(id);
      if (view === undefined || view.thread.archived) return Promise.resolve(false);
      if (view.lifecycle === "running") {
        report("Stop the agent before archiving this conversation.");
        return Promise.resolve(false);
      }
      return settleAgentThreadMutation(update(id, { archived: true }));
    },
    unarchive(id: string): Promise<boolean> {
      if (!remote(id)) return settleAgentThreadMutation(local.unarchive?.(id));
      const view = byId.get(id);
      if (view === undefined || !view.thread.archived) return Promise.resolve(false);
      return settleAgentThreadMutation(update(id, { archived: false }));
    },
    batchThreadMutations<T>(work: () => Promise<T>): Promise<T> {
      if (batch === undefined) return work();
      return batch(work);
    },
    remove(id: string): Promise<boolean> {
      if (!remote(id)) return settleAgentThreadMutation(local.remove(id));
      if (byId.get(id)?.lifecycle === "running") {
        report("Stop the agent before removing this conversation.");
        return Promise.resolve(false);
      }
      return settleAgentThreadMutation(update(id, { removed: true }));
    },
    threadCopyDetail: ((id, detail) => {
      if (!remote(id)) return local.threadCopyDetail(id, detail);
      return detail === "threadId" ? (byId.get(id)?.execution?.conversationId ?? null) : null;
    }) satisfies AgentThreadsSurface["threadCopyDetail"],
    stop: async (id: string) => {
      if (remote(id)) await stop(id);
      else await local.stop(id);
    },
    hasLiveTasksForOwner: (id: string) =>
      remote(id)
        ? threads.some((view) => view.thread.owner.ownerId === id && view.lifecycle === "running")
        : local.hasLiveTasksForOwner(id),
    stopProjectTasks: async (id: string, roots: readonly string[]) => {
      if (!remote(id))
        return local.stopProjectTasks(
          id,
          roots.filter((root) => !remote(root)),
        );
      for (const view of threads) {
        if (view.thread.owner.ownerId === id && view.lifecycle === "running")
          await stop(view.thread.threadId);
      }
    },
    releaseProjectTasks: (id: string) => {
      if (!remote(id)) local.releaseProjectTasks(id);
    },
    removeOrphanedWorktree: asyncAction(local.removeOrphanedWorktree),
    pruneOrphanedWorktrees: asyncAction(local.pruneOrphanedWorktrees),
    showChanges: asyncAction(local.showChanges),
    hideChanges: syncAction(local.hideChanges),
    showFileDiff: asyncAction(local.showFileDiff),
    hideFileDiff: syncAction(local.hideFileDiff),
    removeWorktree: asyncAction(local.removeWorktree),
    refreshShipStatus: asyncAction(local.refreshShipStatus),
    commitThreadChanges: asyncAction(local.commitThreadChanges),
    pushThreadBranch: asyncAction(local.pushThreadBranch),
    openThreadCompareUrl: asyncAction(local.openThreadCompareUrl),
    integrateThreadBranch: asyncAction(local.integrateThreadBranch),
    removeThreadWorktree: asyncAction(local.removeThreadWorktree),
    resetThreadShip: syncAction(local.resetThreadShip),
    openChangedFile: asyncAction(local.openChangedFile),
    openChangedFileDiff: asyncAction(local.openChangedFileDiff),
  };
}

export const remoteAgentNotice = (message: string): AgentTasksNotice => ({
  kind: "warning",
  message,
  action: null,
});
