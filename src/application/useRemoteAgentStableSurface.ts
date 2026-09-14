import { useLayoutEffect, useMemo, useRef } from "react";
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
      threadCopyDetail: (...args) => current.current.threadCopyDetail(...args),
      lastUsedLaunch: (...args) => current.current.lastUsedLaunch(...args),
      isolationPreview: (...args) => current.current.isolationPreview(...args),
      refreshIsolationStatus: (...args) => current.current.refreshIsolationStatus(...args),
      startThread: (...args) => current.current.startThread(...args),
      sendFollowUp: (...args) => current.current.sendFollowUp(...args),
      steer: (...args) => current.current.steer(...args),
      removeDeferredFollowUp: (...args) => current.current.removeDeferredFollowUp(...args),
      importExternalSession: (...args) => current.current.importExternalSession(...args),
      stop: (...args) => current.current.stop(...args),
      togglePin: (...args) => current.current.togglePin(...args),
      archive: (...args) => current.current.archive(...args),
      remove: (...args) => current.current.remove(...args),
      hasLiveTasksForOwner: (...args) => current.current.hasLiveTasksForOwner(...args),
      stopProjectTasks: (...args) => current.current.stopProjectTasks(...args),
      releaseProjectTasks: (...args) => current.current.releaseProjectTasks(...args),
      removeOrphanedWorktree: (...args) => current.current.removeOrphanedWorktree(...args),
      pruneOrphanedWorktrees: (...args) => current.current.pruneOrphanedWorktrees(...args),
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
