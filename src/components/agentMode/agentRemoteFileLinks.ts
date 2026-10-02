import type { RemoteAgentThreadExecution } from "../../application/agentThreadPorts";
import {
  agentLocalFileLinkFailure,
  type AgentLocalFileLinkFailure,
  type AgentLocalFileLinkPlace,
} from "../../domain/agentMarkdown/agentLocalFileLinkFailure";
import type { AgentLocalFileLink } from "../../domain/agentMarkdown/agentMarkdownLink";
import {
  resolveAgentRemoteFileLink,
  type AgentRemoteFileLinkAnchors,
} from "../../domain/agentMarkdown/agentRemoteFileLinkPath";
import type { AgentTaskIsolation } from "../../domain/agentTask";
import type {
  RemoteFileRevealSettlement,
  RemoteFileRevealTarget,
} from "../../domain/remoteFileReveal";
import type { RemoteSurfaceScope } from "../../domain/remoteRunnerSurfaces";

export type AgentRemoteFileOpenOutcome = RemoteFileRevealSettlement;

export interface AgentRemoteFileOpenRequest {
  readonly scope: RemoteSurfaceScope;
  readonly target: RemoteFileRevealTarget;
}

export interface AgentRemoteFileLinkPort {
  open(request: AgentRemoteFileOpenRequest): Promise<AgentRemoteFileOpenOutcome>;
  report(failure: AgentLocalFileLinkFailure): void;
}

export interface AgentRemoteFileLinkScope {
  readonly kind: "remote";
  readonly port: AgentRemoteFileLinkPort;
  readonly scope: RemoteSurfaceScope;
  readonly place: AgentLocalFileLinkPlace;
  readonly anchors: AgentRemoteFileLinkAnchors;
}

export interface AgentRemoteFileLinkThread {
  readonly execution: Pick<
    RemoteAgentThreadExecution,
    "serverId" | "runnerId" | "projectId" | "conversationId" | "latestTaskId"
  >;
  readonly isolation: AgentTaskIsolation;
  readonly repositoryLabel: string;
}

export function agentRemoteFileLinkScope(
  port: AgentRemoteFileLinkPort | null,
  thread: AgentRemoteFileLinkThread,
): AgentRemoteFileLinkScope | null {
  if (port === null) return null;
  const { serverId, runnerId, projectId, conversationId, latestTaskId } = thread.execution;
  const worktree = thread.isolation === "worktree";
  return {
    kind: "remote",
    port,
    scope: { serverId, runnerId, projectId, taskId: latestTaskId },
    place: {
      kind: worktree ? "worktree" : "project",
      label: thread.repositoryLabel === "" ? null : thread.repositoryLabel,
    },
    anchors: worktree
      ? { kind: "worktree", workspaceDirectory: conversationId }
      : {
          kind: "project",
          projectDirectory: thread.repositoryLabel === projectId ? projectId : null,
        },
  };
}

export function agentRemotePathLinkAccepted(
  link: AgentLocalFileLink,
  scope: AgentRemoteFileLinkScope,
): boolean {
  return resolveAgentRemoteFileLink(link, scope.anchors).kind === "server";
}

export async function attemptRemoteFileLink(
  link: AgentLocalFileLink,
  scope: AgentRemoteFileLinkScope,
): Promise<AgentLocalFileLinkFailure | null> {
  const written = link.location.path;
  const resolution = resolveAgentRemoteFileLink(link, scope.anchors);
  if (resolution.kind === "absolute") {
    return agentLocalFileLinkFailure("serverAbsolutePath", written, scope.place);
  }
  if (resolution.kind === "unsupported") {
    return agentLocalFileLinkFailure("outsideProject", written, scope.place);
  }
  if (resolution.kind === "checkoutRoot") {
    return agentLocalFileLinkFailure("checkoutFolder", written, scope.place);
  }
  const outcome = await scope.port
    .open({ scope: scope.scope, target: resolution.target })
    .catch((): AgentRemoteFileOpenOutcome => "failed");
  return remoteOpenFailure(outcome, written, scope.place);
}

function remoteOpenFailure(
  outcome: AgentRemoteFileOpenOutcome,
  path: string,
  place: AgentLocalFileLinkPlace,
): AgentLocalFileLinkFailure | null {
  switch (outcome) {
    case "opened":
    case "superseded":
      return null;
    case "notFound":
    case "notRegularFile":
    case "unreadable":
    case "failed":
    case "unsavedChanges":
    case "saveInProgress":
    case "filesUnavailable":
      return agentLocalFileLinkFailure(outcome, path, place);
    default:
      return unsupportedOutcome(outcome);
  }
}

function unsupportedOutcome(outcome: never): never {
  throw new Error(`Unsupported remote file link outcome: ${String(outcome)}`);
}
