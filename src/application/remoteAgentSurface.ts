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
  ) => void;
  readonly stop: (threadId: string) => Promise<void>;
}

/** Routes presentation actions; remote identities can never fall through to local tools. */
export function remoteAgentThreadActions({ local, threads, report, update, stop }: Options) {
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
        update(id, { viewedAtEpochMs: Date.now() });
    },
    markThreadUnread(id: string) {
      if (remote(id)) update(id, { viewedAtEpochMs: null });
      else local.markThreadUnread(id);
    },
    renameThread(id: string, title: string) {
      if (remote(id)) update(id, { title });
      else local.renameThread(id, title);
    },
    togglePin(id: string) {
      if (remote(id)) update(id, { pinned: !byId.get(id)?.thread.pinned });
      else local.togglePin(id);
    },
    archive(id: string) {
      if (!remote(id)) return local.archive(id);
      if (byId.get(id)?.lifecycle === "running") {
        report("Stop the agent before archiving this conversation.");
        return;
      }
      update(id, { archived: !byId.get(id)?.thread.archived });
    },
    remove(id: string) {
      if (!remote(id)) return local.remove(id);
      if (byId.get(id)?.lifecycle === "running") {
        report("Stop the agent before removing this conversation.");
        return;
      }
      update(id, { removed: true });
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
