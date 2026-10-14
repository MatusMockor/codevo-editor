import type { AgentProjectDescriptor } from "../domain/agentProject";
import type { RemoteStartBase } from "../domain/remoteGitSyncWire";
import {
  isRemoteFolderProject,
  remoteProjectKindOf,
  type RemoteProjectKind,
} from "../domain/remoteProjectKind";
import type { RemoteRunnerIsolation } from "../domain/remoteRunner";
import type { AgentIsolationPreview } from "./agentThreadPorts";

export const REMOTE_FOLDER_NEEDS_IN_PLACE =
  "This server project is a folder, not a Git repository, so it cannot run in a worktree. Choose the server folder and send again.";
export const REMOTE_FOLDER_BASE_UNAVAILABLE =
  "This server project is a folder, not a Git repository, so it cannot start from a branch.";
export const REMOTE_PROJECT_KIND_CHANGED =
  "The server project changed. Refresh the server projects before starting.";

export type RemoteProjectLaunchRefusal = "projectChanged" | "needsInPlace" | "baseUnavailable";

export type RemoteProjectListing = RemoteProjectKind | "unlisted" | "unread";

export interface RemoteProjectLaunch {
  readonly captured: RemoteProjectKind | undefined;
  readonly current: RemoteProjectListing;
  readonly isolation: RemoteRunnerIsolation;
  readonly base: RemoteStartBase | undefined;
}

export function remoteProjectLaunchRefusal(
  launch: RemoteProjectLaunch,
): RemoteProjectLaunchRefusal | null {
  const captured = remoteProjectKindOf({ kind: launch.captured });
  if (launch.current === "unlisted") return "projectChanged";
  if (launch.current !== "unread" && launch.current !== captured) return "projectChanged";
  if (captured !== "folder") return null;
  if (launch.isolation !== "in-place") return "needsInPlace";
  if (launch.base !== undefined) return "baseUnavailable";
  return null;
}

export function remoteProjectLaunchRefusalMessage(refusal: RemoteProjectLaunchRefusal): string {
  switch (refusal) {
    case "projectChanged":
      return REMOTE_PROJECT_KIND_CHANGED;
    case "needsInPlace":
      return REMOTE_FOLDER_NEEDS_IN_PLACE;
    case "baseUnavailable":
      return REMOTE_FOLDER_BASE_UNAVAILABLE;
    default: {
      const unreachable: never = refusal;
      return unreachable;
    }
  }
}

export function remoteProjectIsolationPreview(
  repositoryRoot: string,
  project: AgentProjectDescriptor | undefined,
): AgentIsolationPreview {
  const inPlaceAllowed = project?.isolationPolicy === "in-place";
  const folder =
    project !== undefined && isRemoteFolderProject({ kind: project.remoteProjectKind });
  return {
    repositoryRoot,
    repositoryStatus: folder ? { kind: "notRepository" } : { kind: "ready" },
    recommended: inPlaceAllowed ? { kind: "in-place" } : { kind: "worktree", reason: "policy" },
    inPlaceGuard: { kind: "safe" },
    inPlaceAllowed,
    confirmationKey: null,
  };
}
