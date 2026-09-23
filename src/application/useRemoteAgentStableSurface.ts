import { useLayoutEffect, useMemo, useRef } from "react";
import { unsupportedAgentTurnChanges } from "../domain/agentTurnChanges";
import type { AgentQueuedEditCommit, AgentQueuedEditSession } from "./agentQueuedFollowUpEdit";
import type { AgentThreadsSurface } from "./agentThreadPorts";

type Methods = {
  [
    K in keyof AgentThreadsSurface as AgentThreadsSurface[K] extends (...args: never[]) => unknown
      ? K
      : never
  ]: AgentThreadsSurface[K];
};

/** Stable callbacks read the last committed surface, not an abandoned React render. */
export function useRemoteAgentStableSurface(surface: AgentThreadsSurface): AgentThreadsSurface {
  const current = useRef(surface);
  useLayoutEffect(() => {
    current.current = surface;
  });
  const methods = useMemo<Methods>(
    () => ({
      revealAttachment: (...args) => current.current.revealAttachment(...args),
      pendingTurnCount: (...args) => current.current.pendingTurnCount(...args),
      markThreadViewed: (...args) => current.current.markThreadViewed(...args),
      markThreadUnread: (...args) => current.current.markThreadUnread(...args),
      renameThread: (...args) => current.current.renameThread(...args),
      updateThreadOrganization: (
        ...args: Parameters<NonNullable<AgentThreadsSurface["updateThreadOrganization"]>>
      ) => current.current.updateThreadOrganization?.(...args),
      reorderThread: (...args: Parameters<NonNullable<AgentThreadsSurface["reorderThread"]>>) =>
        current.current.reorderThread?.(...args),
      threadCopyDetail: (...args) => current.current.threadCopyDetail(...args),
      lastUsedLaunch: (...args) => current.current.lastUsedLaunch(...args),
      isolationPreview: (...args) => current.current.isolationPreview(...args),
      refreshIsolationStatus: (...args) => current.current.refreshIsolationStatus(...args),
      startThread: (...args) => current.current.startThread(...args),
      sendFollowUp: (...args) => current.current.sendFollowUp(...args),
      hasUnconfirmedMessage: (threadId: string) =>
        current.current.hasUnconfirmedMessage?.(threadId) === true,
      discardUnconfirmedMessage: (threadId: string) =>
        current.current.discardUnconfirmedMessage?.(threadId),
      sendDeferredFollowUpNow: (threadId: string, id: string) =>
        current.current.sendDeferredFollowUpNow?.(threadId, id) ?? Promise.resolve(),
      steer: (...args) => current.current.steer(...args),
      removeDeferredFollowUp: (...args) => current.current.removeDeferredFollowUp(...args),
      beginDeferredFollowUpEdit: (threadId: string, id: string) =>
        current.current.beginDeferredFollowUpEdit?.(threadId, id) ?? null,
      cancelDeferredFollowUpEdit: (session: AgentQueuedEditSession) =>
        current.current.cancelDeferredFollowUpEdit?.(session),
      commitDeferredFollowUpEdit: (
        session: AgentQueuedEditSession,
        commit: AgentQueuedEditCommit,
      ) => current.current.commitDeferredFollowUpEdit?.(session, commit) ?? Promise.resolve(false),
      importExternalSession: (...args) => current.current.importExternalSession(...args),
      stop: (...args) => current.current.stop(...args),
      togglePin: (...args) => current.current.togglePin(...args),
      archive: (...args) => current.current.archive(...args),
      unarchive: (threadId: string) => current.current.unarchive?.(threadId) ?? false,
      remove: (...args) => current.current.remove(...args),
      batchThreadMutations: <T>(work: () => Promise<T>) =>
        current.current.batchThreadMutations?.(work) ?? work(),
      hasLiveTasksForOwner: (...args) => current.current.hasLiveTasksForOwner(...args),
      stopProjectTasks: (...args) => current.current.stopProjectTasks(...args),
      releaseProjectTasks: (...args) => current.current.releaseProjectTasks(...args),
      removeOrphanedWorktree: (...args) => current.current.removeOrphanedWorktree(...args),
      pruneOrphanedWorktrees: (...args) => current.current.pruneOrphanedWorktrees(...args),
      getTurnChangesRevision: (threadId: string) =>
        current.current.getTurnChangesRevision?.(threadId) ??
        current.current.turnChangesRevision ??
        current.current,
      getTurnChanges: (...args: Parameters<NonNullable<AgentThreadsSurface["getTurnChanges"]>>) =>
        current.current.getTurnChanges?.(...args) ??
        Promise.resolve(unsupportedAgentTurnChanges(args[1], "notApplicable")),
      getTurnFileDiff: (...args: Parameters<NonNullable<AgentThreadsSurface["getTurnFileDiff"]>>) =>
        current.current.getTurnFileDiff?.(...args) ??
        Promise.reject(new Error("Recorded changes are not available for this turn.")),
      showChanges: (...args) => current.current.showChanges(...args),
      hideChanges: (...args) => current.current.hideChanges(...args),
      showFileDiff: (...args) => current.current.showFileDiff(...args),
      hideFileDiff: (...args) => current.current.hideFileDiff(...args),
      removeWorktree: (...args) => current.current.removeWorktree(...args),
      refreshShipStatus: (...args) => current.current.refreshShipStatus(...args),
      commitThreadChanges: (...args) => current.current.commitThreadChanges(...args),
      pushThreadBranch: (...args) => current.current.pushThreadBranch(...args),
      openThreadCompareUrl: (...args) => current.current.openThreadCompareUrl(...args),
      integrateThreadBranch: (...args) => current.current.integrateThreadBranch(...args),
      removeThreadWorktree: (...args) => current.current.removeThreadWorktree(...args),
      resetThreadShip: (...args) => current.current.resetThreadShip(...args),
      openChangedFile: (...args) => current.current.openChangedFile(...args),
      openChangedFileDiff: (...args) => current.current.openChangedFileDiff(...args),
      configureAgentCli: (...args) => current.current.configureAgentCli(...args),
      dismissNotice: (...args) => current.current.dismissNotice(...args),
    }),
    [],
  );
  return {
    ...surface,
    ...methods,
    isolationPreview: surface.isolationPreview,
    lastUsedLaunch: surface.lastUsedLaunch,
    threadCopyDetail: surface.threadCopyDetail,
    pendingTurnCount: surface.pendingTurnCount,
  };
}
