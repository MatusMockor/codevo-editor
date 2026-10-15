import { useMemo, useState } from "react";
import { createRemoteProjectDirectoryGateway } from "../../application/remoteRepositoryLookupGateway";
import { createRemoteProjectRegistrationGateway } from "../../application/remoteProjectRegistrationGateway";
import {
  useRemoteProjectFolderRegistration,
  type RemoteProjectFolderController,
  type RemoteProjectFolderOwner,
} from "../../application/useRemoteProjectFolderRegistration";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";
import { useRemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";
import { remoteAddProjectServerProjects } from "./remoteAddProject/remoteAddProjectPresentation";

export interface AgentRemoteFolderProjectOptions {
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly workspaceRoot: string | null;
  readonly selectionIdentity: object;
  refreshProjects(): Promise<void>;
  onProjectAdded(project: AgentProjectDescriptor): void;
}

export interface AgentRemoteFolderProject extends RemoteProjectFolderController {
  openFor(serverId: string, initialPath?: string | null): void;
}

type FolderSession = Readonly<{
  runnerGateway: RemoteRunnerGateway | null;
  owner: RemoteProjectFolderOwner;
}>;

export function useAgentRemoteFolderProject(
  options: AgentRemoteFolderProjectOptions,
): AgentRemoteFolderProject {
  const runnerGateway = useRemoteRunnerContext()?.gateway ?? null;
  const [stored, setSession] = useState<FolderSession | null>(null);
  const current =
    stored !== null &&
    stored.runnerGateway === runnerGateway &&
    stored.owner.workspaceOwner === options.workspaceRoot;
  if (stored !== null && !current) setSession(null);
  const owner = current ? stored.owner : null;
  const serverId = owner?.serverId ?? null;
  const serverProjects = useMemo(
    () => remoteAddProjectServerProjects(options.projects, serverId),
    [options.projects, serverId],
  );
  const controller = useRemoteProjectFolderRegistration({
    owner,
    serverProjects,
    selectionIdentity: options.selectionIdentity,
    refreshProjects: options.refreshProjects,
    selectProject(key) {
      const project = options.projects.find((entry) => entry.rootKey === key);
      if (project) options.onProjectAdded(project);
    },
    onClose() {
      setSession(null);
    },
  });
  return {
    ...controller,
    openFor(nextServerId, initialPath = null) {
      setSession({
        runnerGateway,
        owner: {
          serverId: nextServerId,
          workspaceOwner: options.workspaceRoot,
          directoryGateway: createRemoteProjectDirectoryGateway(runnerGateway, nextServerId),
          registrationGateway: createRemoteProjectRegistrationGateway(runnerGateway, nextServerId),
          ...(initialPath === null ? {} : { initialPath }),
        },
      });
    },
  };
}
