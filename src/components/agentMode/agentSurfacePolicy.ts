import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentThreadTarget } from "../../domain/agentThread";
import type { AgentSurfaceKind } from "../../domain/agentWorkbenchLayout";
import {
  DEFAULT_TERMINAL_LAUNCH_TARGET,
  terminalLaunchTargetForThread,
  type TerminalGateway,
  type TerminalLaunchTarget,
} from "../../domain/terminal";
import { agentSurfaceTargetGone } from "./agentModePresentation";

export const SURFACE_NO_THREAD_REASON = "Select a thread first";
export const SURFACE_WORKTREE_GONE_REASON = "The worktree no longer exists";
export const SURFACE_UNTRUSTED_TERMINAL_REASON = "Trust the workspace to start a terminal";
export const SURFACE_FOREIGN_ROOT_TERMINAL_REASON =
  "Terminal is available for the workspace root repository only.";

export function agentSurfaceTerminalRootMismatch(
  thread: AgentThreadView,
  workspaceRoot: string | null,
): boolean {
  return thread.thread.owner.repositoryRoot !== workspaceRoot;
}

export function agentSurfaceBlockedReason(
  kind: AgentSurfaceKind,
  thread: AgentThreadView | null,
  workspaceTrusted: boolean,
  workspaceRoot: string | null,
): string | null {
  if (thread === null) return SURFACE_NO_THREAD_REASON;
  if (agentSurfaceTargetGone(thread)) return SURFACE_WORKTREE_GONE_REASON;
  if (kind !== "terminal") return null;
  if (agentSurfaceTerminalRootMismatch(thread, workspaceRoot)) {
    return SURFACE_FOREIGN_ROOT_TERMINAL_REASON;
  }
  if (!workspaceTrusted) return SURFACE_UNTRUSTED_TERMINAL_REASON;
  return null;
}

export function agentSurfaceTerminalOwnerKey(workspaceId: string, threadId: string): string {
  return `${workspaceId}:agent-surface:${threadId}`;
}

export function agentSurfaceTerminalLaunchTargetFor(
  threadId: string,
  isolation: AgentThreadTarget["isolation"],
): TerminalLaunchTarget {
  if (isolation !== "worktree") return DEFAULT_TERMINAL_LAUNCH_TARGET;
  return terminalLaunchTargetForThread(threadId);
}

export function agentSurfaceTerminalLaunchTarget(thread: AgentThreadView): TerminalLaunchTarget {
  return agentSurfaceTerminalLaunchTargetFor(
    thread.thread.threadId,
    thread.thread.target.isolation,
  );
}

export function withTerminalLaunchTarget(
  gateway: TerminalGateway,
  target: TerminalLaunchTarget,
): TerminalGateway {
  const forwarded: TerminalGateway = {
    acknowledgeStart: (sessionId) => gateway.acknowledgeStart(sessionId),
    listProfiles: () => gateway.listProfiles(),
    resize: (sessionId, size) => gateway.resize(sessionId, size),
    start: (rootPath, size, profileId, shellIntegrationEnabled) =>
      gateway.start(rootPath, size, profileId, shellIntegrationEnabled, target),
    stop: (sessionId) => gateway.stop(sessionId),
    stopRoot: (rootPath) => gateway.stopRoot(rootPath),
    stopAll: () => gateway.stopAll(),
    subscribeOutput: (listener) => gateway.subscribeOutput(listener),
    writeInput: (sessionId, data) => gateway.writeInput(sessionId, data),
  };
  const subscribeStatus = gateway.subscribeStatus;
  if (subscribeStatus === undefined) return forwarded;
  return { ...forwarded, subscribeStatus: (listener) => subscribeStatus.call(gateway, listener) };
}
