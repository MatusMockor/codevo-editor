import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  agentProjectOwnsLaunchRoot,
  agentProjectOwnsOwner,
  type AgentProjectDescriptor,
} from "../../domain/agentProject";
import type { AgentTaskIsolation } from "../../domain/agentTask";
import type { RemoteSurfaceScope } from "../../domain/remoteRunnerSurfaces";
import type { AgentComposerPreviousWorktree } from "./agentComposerPreviousWorktree";
import {
  agentCheckoutLabel,
  agentDraftLocation,
  agentPreviousWorktreeLabel,
  THIS_COMPUTER,
  agentLocationTokenText,
  agentThreadLocation,
  type AgentWorkspaceLocation,
} from "../../domain/agentWorkspaceLocation";
import { agentLiveCheckoutBranch, type AgentLiveCheckoutBranches } from "./agentLiveCheckoutBranch";
import { agentShipBranchLabel, agentSurfaceTargetGone } from "./agentModePresentation";
import { agentSurfaceLocalAvailable, type AgentSurfaceScope } from "./agentSurfacePolicy";
import type { AgentProjectWorkspaceActivation } from "./useAgentProjectWorkspaceSync";

export type AgentSurfaceLocationGlyph = "folder" | "branch" | "server";

export type AgentSurfaceLocation =
  | { readonly kind: "hidden" }
  | {
      readonly kind: "shown";
      readonly projectLabel: string;
      readonly location: AgentWorkspaceLocation;
      readonly token: string;
      readonly description: string;
      readonly glyph: AgentSurfaceLocationGlyph;
      readonly path: string | null;
    };

export interface AgentSurfaceRemoteLocationInput {
  readonly scope: RemoteSurfaceScope | null;
  readonly serverName: string | null;
}

export interface AgentSurfaceLocationInput {
  readonly thread: AgentThreadView | null;
  readonly threadRootPath: string | null;
  readonly scope: AgentSurfaceScope;
  readonly workspaceRoot: string | null;
  readonly activation: AgentProjectWorkspaceActivation | undefined;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly liveBranches: AgentLiveCheckoutBranches | null | undefined;
  readonly draftIsolation: AgentTaskIsolation;
  readonly draftPreviousWorktree: AgentComposerPreviousWorktree | null;
  readonly remote: AgentSurfaceRemoteLocationInput | null;
}

export const HIDDEN_AGENT_SURFACE_LOCATION: AgentSurfaceLocation = Object.freeze({
  kind: "hidden",
});

const UNNAMED_SERVER = "";
const NOT_CREATED_YET = "(not created yet)";
const SHOWS_PROJECT_ROOT = "shows project root";

export function agentSurfaceRemoteProjectRootKey(
  scope: Pick<RemoteSurfaceScope, "serverId" | "runnerId" | "projectId">,
): string {
  return ["remote", scope.serverId, scope.runnerId, scope.projectId]
    .map((part, index) => (index === 0 ? part : encodeURIComponent(part)))
    .join(":");
}

export function agentSurfaceLocation(input: AgentSurfaceLocationInput): AgentSurfaceLocation {
  if (input.remote !== null) return remoteLocation(input, input.remote);
  return localLocation(input);
}

function localLocation(input: AgentSurfaceLocationInput): AgentSurfaceLocation {
  const { scope, thread } = input;
  if (scope.kind !== "repository") return HIDDEN_AGENT_SURFACE_LOCATION;
  const available = agentSurfaceLocalAvailable({
    remote: false,
    scope,
    workspaceRoot: input.workspaceRoot,
    thread,
    activation: input.activation,
  });
  if (!available) return HIDDEN_AGENT_SURFACE_LOCATION;
  const project = scopeProject(input.projects, scope);
  if (project === null) return HIDDEN_AGENT_SURFACE_LOCATION;
  if (thread === null) return localDraftLocation(input, project.label, scope.rootPath);
  const location = localThreadLocation(input, project, thread);
  if (location === null) return HIDDEN_AGENT_SURFACE_LOCATION;
  return shown(project.label, location);
}

function localDraftLocation(
  input: AgentSurfaceLocationInput,
  projectLabel: string,
  projectRoot: string,
): AgentSurfaceLocation {
  const previous = input.draftIsolation === "worktree" ? input.draftPreviousWorktree : null;
  if (previous !== null) return previousWorktreeDraft(previous, projectLabel, projectRoot);
  if (input.draftIsolation === "worktree") {
    const location = agentDraftLocation({
      isolation: "worktree",
      serverName: null,
      projectRoot,
      branch: null,
    });
    return {
      kind: "shown",
      projectLabel,
      location,
      token: `${agentCheckoutLabel(location.checkout)} ${NOT_CREATED_YET} · ${SHOWS_PROJECT_ROOT}`,
      description: `Right panel shows the project root of ${projectLabel}. ${agentCheckoutLabel(location.checkout)} not created yet.`,
      glyph: locationGlyph(location),
      path: projectRoot,
    };
  }
  return shown(
    projectLabel,
    agentDraftLocation({
      isolation: "in-place",
      serverName: null,
      projectRoot,
      branch: agentLiveCheckoutBranch(input.liveBranches, projectRoot),
    }),
  );
}

function previousWorktreeDraft(
  previous: AgentComposerPreviousWorktree,
  projectLabel: string,
  projectRoot: string,
): AgentSurfaceLocation {
  const label = agentPreviousWorktreeLabel(previous.branch);
  const location: AgentWorkspaceLocation = {
    machine: THIS_COMPUTER,
    checkout: "previousWorktree",
    branch: previous.branch,
    path: previous.worktreePath,
  };
  return {
    kind: "shown",
    projectLabel,
    location,
    token: `${label} · ${SHOWS_PROJECT_ROOT}`,
    description: `Right panel shows the project root of ${projectLabel}. Sending continues in ${label} at ${previous.worktreePath}.`,
    glyph: locationGlyph(location),
    path: projectRoot,
  };
}

function localThreadLocation(
  input: AgentSurfaceLocationInput,
  project: AgentProjectDescriptor,
  view: AgentThreadView,
): AgentWorkspaceLocation | null {
  const record = view.thread;
  if (view.execution !== undefined) return null;
  if (!agentProjectOwnsOwner(project, record.owner)) return null;
  if (!agentProjectOwnsLaunchRoot(project, record.owner.repositoryRoot)) return null;
  if (agentSurfaceTargetGone(view)) return null;
  const rootPath = input.threadRootPath;
  if (rootPath === null) return null;
  const worktreePath = record.target.worktreePath;
  if (record.target.isolation === "worktree") {
    if (worktreePath !== null && worktreePath !== rootPath) return null;
    return agentThreadLocation({
      isolation: "worktree",
      worktreePath,
      repositoryRoot: rootPath,
      serverName: null,
      branch: agentShipBranchLabel(view.ship),
    });
  }
  return agentThreadLocation({
    isolation: record.target.isolation,
    worktreePath: null,
    repositoryRoot: rootPath,
    serverName: null,
    branch: agentLiveCheckoutBranch(input.liveBranches, rootPath),
  });
}

function remoteLocation(
  input: AgentSurfaceLocationInput,
  remote: AgentSurfaceRemoteLocationInput,
): AgentSurfaceLocation {
  const scope = remote.scope;
  if (scope === null) return HIDDEN_AGENT_SURFACE_LOCATION;
  const rootKey = agentSurfaceRemoteProjectRootKey(scope);
  const project = input.projects.find((candidate) => candidate.rootKey === rootKey) ?? null;
  const serverName = remote.serverName ?? UNNAMED_SERVER;
  const thread = input.thread;
  if (thread === null) {
    if (scope.taskId !== undefined || project === null) return HIDDEN_AGENT_SURFACE_LOCATION;
    return shown(
      project.label,
      agentDraftLocation({
        isolation: input.draftIsolation,
        serverName,
        projectRoot: "",
        branch: null,
      }),
    );
  }
  const execution = thread.execution;
  if (execution === undefined || execution.serverId !== scope.serverId)
    return HIDDEN_AGENT_SURFACE_LOCATION;
  return shown(
    project?.label ?? thread.repositoryLabel,
    agentThreadLocation({
      isolation: thread.thread.target.isolation,
      worktreePath: thread.thread.target.worktreePath,
      repositoryRoot: "",
      serverName,
      branch: null,
    }),
  );
}

function scopeProject(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  scope: Extract<AgentSurfaceScope, { kind: "repository" }>,
): AgentProjectDescriptor | null {
  return (
    projects.find(
      (candidate) =>
        candidate.rootKey === scope.projectRootKey &&
        candidate.ownerId === scope.ownerId &&
        candidate.generation === scope.generation &&
        candidate.rootPath === scope.rootPath &&
        candidate.origin !== "closed-tab-live-tasks",
    ) ?? null
  );
}

function shown(projectLabel: string, location: AgentWorkspaceLocation): AgentSurfaceLocation {
  const token = agentLocationTokenText(location);
  return {
    kind: "shown",
    projectLabel,
    location,
    token,
    description: `Right panel shows ${token} of ${projectLabel}`,
    glyph: locationGlyph(location),
    path: location.path,
  };
}

function locationGlyph(location: AgentWorkspaceLocation): AgentSurfaceLocationGlyph {
  if (location.machine.kind === "server") return "server";
  switch (location.checkout) {
    case "newWorktree":
    case "worktree":
    case "previousWorktree":
      return "branch";
    case "localCheckout":
    case "serverCheckout":
      return "folder";
  }
}
