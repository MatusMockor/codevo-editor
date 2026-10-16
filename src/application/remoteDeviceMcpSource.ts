import { useLayoutEffect } from "react";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import { isRemoteFolderProject, type RemoteProjectKind } from "../domain/remoteProjectKind";
import {
  isRemoteMcpDeviceSyncRootPath,
  type RemoteMcpDeviceSyncProjectKind,
} from "../domain/remoteRunnerMcpDeviceSync";
import { remoteAgentProjectKey } from "./remoteAgentProjection";
import { readRemoteInstructionRoot } from "./remoteInstructionSources";

export type RemoteDeviceMcpTarget = Readonly<{
  serverId: string;
  runnerId: string;
  projectId: string;
  projectKind?: RemoteProjectKind;
}>;
export type RemoteDeviceMcpSource = Readonly<{
  rootPath: string;
  projectKind: RemoteMcpDeviceSyncProjectKind;
}>;
export type RemoteDeviceMcpProjects = Readonly<{
  projects: readonly AgentProjectDescriptor[];
  identities: ReadonlyMap<string, string>;
}>;
export type RemoteDeviceMcpSourceResolver = (
  target: RemoteDeviceMcpTarget,
) => RemoteDeviceMcpSource | null;

const FOLDER_IDENTITY_PREFIX = "folder:";

function explicitRoot(target: RemoteDeviceMcpTarget): string | null | undefined {
  try {
    return readRemoteInstructionRoot(target.serverId, target.runnerId, target.projectId);
  } catch {
    return null;
  }
}

function isLocalProject(project: AgentProjectDescriptor): boolean {
  return !project.rootKey.startsWith("remote:");
}

function pairedFolderRoot(
  target: RemoteDeviceMcpTarget,
  snapshot: RemoteDeviceMcpProjects,
): string | null {
  const remoteKey = remoteAgentProjectKey(target.serverId, target.runnerId, target.projectId);
  const remote = snapshot.projects.find((project) => project.rootKey === remoteKey);
  if (remote === undefined || remote.trust !== "trusted") return null;
  if (!isRemoteFolderProject({ kind: remote.remoteProjectKind })) return null;
  const identity = snapshot.identities.get(remoteKey);
  if (identity === undefined || !identity.startsWith(FOLDER_IDENTITY_PREFIX)) return null;
  const locals = snapshot.projects.filter(
    (project) =>
      isLocalProject(project) &&
      project.trust === "trusted" &&
      snapshot.identities.get(project.rootKey) === identity,
  );
  if (locals.length !== 1) return null;
  return locals[0]!.rootPath;
}

export function resolveRemoteDeviceMcpSource(
  target: RemoteDeviceMcpTarget,
  snapshot: RemoteDeviceMcpProjects | null,
): RemoteDeviceMcpSource | null {
  const explicit = explicitRoot(target);
  if (explicit === null) return null;
  if (explicit !== undefined) {
    if (!isRemoteMcpDeviceSyncRootPath(explicit)) return null;
    return {
      rootPath: explicit,
      projectKind: isRemoteFolderProject({ kind: target.projectKind }) ? "folder" : "git",
    };
  }
  if (snapshot === null) return null;
  const paired = pairedFolderRoot(target, snapshot);
  if (paired === null || !isRemoteMcpDeviceSyncRootPath(paired)) return null;
  return { rootPath: paired, projectKind: "folder" };
}

export type RemoteDeviceMcpSources = Readonly<{
  publish(snapshot: RemoteDeviceMcpProjects | null): void;
  resolve: RemoteDeviceMcpSourceResolver;
}>;

export function createRemoteDeviceMcpSources(): RemoteDeviceMcpSources {
  let current: RemoteDeviceMcpProjects | null = null;
  return {
    publish(snapshot) {
      current = snapshot;
    },
    resolve(target) {
      return resolveRemoteDeviceMcpSource(target, current);
    },
  };
}

export function usePublishRemoteDeviceMcpProjects(
  sources: RemoteDeviceMcpSources | null | undefined,
  projects: readonly AgentProjectDescriptor[],
  identities: ReadonlyMap<string, string>,
): void {
  useLayoutEffect(() => {
    if (!sources) return undefined;
    sources.publish({ projects, identities });
    return () => sources.publish(null);
  }, [sources, projects, identities]);
}
