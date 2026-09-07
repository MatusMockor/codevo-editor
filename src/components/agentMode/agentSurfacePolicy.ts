import type { AgentThreadView } from "../../application/agentThreadPorts";
import { isInsideAgentSurfaceRoot } from "../../application/useAgentSurfaceFileTree";
import { agentProjectOwnsLaunchRoot, type AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentThreadTarget } from "../../domain/agentThread";
import type { AgentSurfaceKind } from "../../domain/agentWorkbenchLayout";
import {
  DEFAULT_TERMINAL_LAUNCH_TARGET,
  terminalLaunchTargetForThread,
  type TerminalGateway,
  type TerminalLaunchTarget,
} from "../../domain/terminal";
import type { ComposerScope } from "./agentComposerTarget";
import { agentSurfaceTargetGone } from "./agentModePresentation";

export const SURFACE_NO_THREAD_REASON = "Select a thread first";
export const SURFACE_WORKTREE_GONE_REASON = "The worktree no longer exists";
export const SURFACE_UNTRUSTED_TERMINAL_REASON =
  "Project unavailable. Reopen it or check its workspace settings.";
export const SURFACE_FOREIGN_ROOT_TERMINAL_REASON =
  "Terminal is available for the workspace root repository only.";

export const SURFACE_FILES_THREAD_DESCRIPTION = "Browse and edit the thread's checkout.";
export const SURFACE_FILES_PROJECT_DESCRIPTION = "Browse and edit the project's files.";
export const SURFACE_FILES_UNTRUSTED_DESCRIPTION =
  "Project unavailable. Reopen it or check its workspace settings.";
export const SURFACE_FILES_NO_PROJECT_DESCRIPTION = "Add a project to browse files.";
export const SURFACE_FILES_FOREIGN_ROOT_DESCRIPTION = "Files browse the active workspace only.";

export function agentSurfaceForeignRootMessage(label: string): string {
  return `${SURFACE_FILES_FOREIGN_ROOT_DESCRIPTION} Switch to ${label} to browse its files.`;
}

export type AgentSurfaceScope =
  | { readonly kind: "none" }
  | {
      readonly kind: "foreignRoot";
      readonly projectRootKey: string;
      readonly repositoryRoot: string;
      readonly rootPath: string;
      readonly label: string;
    }
  | {
      readonly kind: "untrusted";
      readonly projectRootKey: string;
      readonly repositoryRoot: string;
    }
  | {
      readonly kind: "repository";
      readonly projectRootKey: string;
      readonly repositoryRoot: string;
      readonly rootPath: string;
      readonly ownerId: string;
      readonly generation: number;
    };

export const NO_AGENT_SURFACE_SCOPE: AgentSurfaceScope = Object.freeze({ kind: "none" });

export function agentSurfaceScopeFor(
  scope: ComposerScope | null,
  projects: ReadonlyArray<AgentProjectDescriptor>,
  workspaceRoot: string | null,
): AgentSurfaceScope {
  if (scope === null || scope.kind === "missing") return NO_AGENT_SURFACE_SCOPE;
  const project = projects.find((candidate) => candidate.rootKey === scope.projectRootKey) ?? null;
  if (project === null) return NO_AGENT_SURFACE_SCOPE;
  if (project.ownerId !== scope.ownerId || project.generation !== scope.generation) {
    return NO_AGENT_SURFACE_SCOPE;
  }
  if (project.origin === "closed-tab-live-tasks") return NO_AGENT_SURFACE_SCOPE;
  if (!agentProjectOwnsLaunchRoot(project, scope.repositoryRoot)) return NO_AGENT_SURFACE_SCOPE;
  if (workspaceRoot === null || !isInsideAgentSurfaceRoot(workspaceRoot, project.rootPath)) {
    return {
      kind: "foreignRoot",
      projectRootKey: scope.projectRootKey,
      repositoryRoot: scope.repositoryRoot,
      rootPath: project.rootPath,
      label: project.label,
    };
  }
  if (project.trust !== "trusted") {
    return {
      kind: "untrusted",
      projectRootKey: scope.projectRootKey,
      repositoryRoot: scope.repositoryRoot,
    };
  }
  return {
    kind: "repository",
    projectRootKey: scope.projectRootKey,
    repositoryRoot: scope.repositoryRoot,
    rootPath: project.rootPath,
    ownerId: scope.ownerId,
    generation: scope.generation,
  };
}

export function agentThreadCheckoutRoot(
  thread: AgentThreadView,
  projects: ReadonlyArray<AgentProjectDescriptor>,
): string {
  const worktreePath = thread.thread.target.worktreePath;
  if (worktreePath !== null) return worktreePath;
  const owner = thread.thread.owner;
  const project = projects.find((candidate) => candidate.rootKey === owner.rootKey) ?? null;
  if (project === null) return owner.repositoryRoot;
  if (
    project.ownerId !== owner.ownerId &&
    project.runtimeOwnerIds?.includes(owner.ownerId) !== true
  )
    return owner.repositoryRoot;
  if (!agentProjectOwnsLaunchRoot(project, owner.repositoryRoot)) return owner.repositoryRoot;
  return project.rootPath;
}

export function agentSurfaceFilesDescription(
  thread: AgentThreadView | null,
  scope: AgentSurfaceScope,
): string {
  if (thread !== null) return SURFACE_FILES_THREAD_DESCRIPTION;
  switch (scope.kind) {
    case "none":
      return SURFACE_FILES_NO_PROJECT_DESCRIPTION;
    case "foreignRoot":
      return SURFACE_FILES_FOREIGN_ROOT_DESCRIPTION;
    case "untrusted":
      return SURFACE_FILES_UNTRUSTED_DESCRIPTION;
    case "repository":
      return SURFACE_FILES_PROJECT_DESCRIPTION;
  }
}

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
  if (kind === "files") return filesSurfaceBlockedReason(thread);
  if (thread === null) return SURFACE_NO_THREAD_REASON;
  if (agentSurfaceTargetGone(thread)) return SURFACE_WORKTREE_GONE_REASON;
  if (kind !== "terminal") return null;
  if (agentSurfaceTerminalRootMismatch(thread, workspaceRoot)) {
    return SURFACE_FOREIGN_ROOT_TERMINAL_REASON;
  }
  if (!workspaceTrusted) return SURFACE_UNTRUSTED_TERMINAL_REASON;
  return null;
}

function filesSurfaceBlockedReason(thread: AgentThreadView | null): string | null {
  if (thread === null) return null;
  if (agentSurfaceTargetGone(thread)) return SURFACE_WORKTREE_GONE_REASON;
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
