import { remoteAgentProjectKey } from "./remoteAgentProjection";
import type { RemoteRunnerCloneJob } from "../domain/remoteRunner";
import {
  boundedRemoteAddProjectError,
  type RemoteAddProjectServerProject,
} from "./remoteAddProjectMachine";

export type RemoteAddProjectPendingClone = Readonly<{
  name: string;
  environment?: "local" | "remote";
  id?: string;
  projectKey?: string;
  status: RemoteRunnerCloneJob["status"];
  error: string | null;
}>;

export function remoteAddProjectPendingClone(
  input: Readonly<{
    job: RemoteRunnerCloneJob | null;
    projectKey?: string;
    requestedName: string | null;
    trackedName: string | null;
    cloneError: string | null;
    failure: Readonly<{ name: string; error: string }> | null;
    confirmVisible: boolean;
  }>,
): RemoteAddProjectPendingClone | null {
  if (input.job !== null) {
    return {
      name: input.requestedName ?? input.trackedName ?? "",
      id: input.job.id,
      ...(input.projectKey === undefined ? {} : { projectKey: input.projectKey }),
      status: input.job.status,
      error: cloneError(input.job.error ?? input.cloneError),
    };
  }
  if (input.failure === null || input.confirmVisible) return null;
  return { name: input.failure.name, status: "failed", error: input.failure.error };
}

function cloneError(value: string | null): string | null {
  if (value === null) return null;
  return boundedRemoteAddProjectError(value);
}

export function matchingCloneProjectKey(
  projects: readonly RemoteAddProjectServerProject[],
  serverId: string,
  runnerId: string | null,
  projectId: string,
): string | undefined {
  if (runnerId === null) return undefined;
  const key = remoteAgentProjectKey(serverId, runnerId, projectId);
  return projects.some((project) => project.key === key) ? key : undefined;
}
