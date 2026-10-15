import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import type { VscodeProcessTasksGateway } from "../../domain/vscodeProcessTasksGateway";
import type { FileEntry } from "../../domain/workspace";
import { useConfigureVscodeProcessTasks } from "../useConfigureVscodeProcessTasks";
import {
  useWorkbenchNodePackageScripts,
  type NodePackageScriptsWorkbenchGateway,
} from "../useNodePackageScriptWorkbench";
import { useWorkbenchVscodeProcessTasks } from "../useWorkbenchVscodeProcessTasks";
import type { WorkbenchNotice } from "../../domain/workbenchNotice";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";
import type { AgentWorkspaceFiles, AgentWorkspaceOwnerFiles } from "./agentAppPorts";
import type { AgentWorkspaceAuthority } from "./useAgentWorkspaceAuthority";

export interface AgentWorkspaceTasksOptions {
  readonly authority: AgentWorkspaceAuthority;
  readonly hasJavaScriptTypeScriptWorkspace: boolean;
  readonly nodePackageScriptDiscoveryVersion: number;
  readonly nodePackageScriptsGateway: NodePackageScriptsWorkbenchGateway;
  readonly ownerFiles: AgentWorkspaceOwnerFiles;
  readonly reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void;
  readonly requestTerminalSession: (consumer: (sessionId: number | null) => void) => void;
  readonly revealFile: (path: string) => void;
  readonly setNotices: Dispatch<SetStateAction<WorkbenchNotice[]>>;
  readonly vscodeProcessTasksGateway: VscodeProcessTasksGateway;
  readonly vscodeProcessTasksVersion: number;
  readonly workspaceFiles: AgentWorkspaceFiles;
  readonly workspaceIdentityDescriptor: WorkspaceIdentityDescriptor | null;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
}

export function useAgentWorkspaceTasks({
  authority,
  hasJavaScriptTypeScriptWorkspace,
  nodePackageScriptDiscoveryVersion,
  nodePackageScriptsGateway,
  ownerFiles,
  reportErrorForActiveWorkspaceRoot,
  requestTerminalSession,
  revealFile,
  setNotices,
  vscodeProcessTasksGateway,
  vscodeProcessTasksVersion,
  workspaceFiles,
  workspaceIdentityDescriptor,
  workspaceRoot,
  workspaceTrusted,
}: AgentWorkspaceTasksOptions) {
  const workspaceTrustedRef = useRef(workspaceTrusted);
  workspaceTrustedRef.current = workspaceTrusted;
  const runtimeOwner =
    workspaceRoot === null ? null : authority.resolveWorkspaceRuntimeOwner(workspaceRoot);
  const openConfiguredTasksFile = useCallback(
    async (
      entry: FileEntry,
      options: { readonly pin: boolean; readonly shouldCommit: () => boolean },
    ) => {
      if (!options.shouldCommit()) return false;
      revealFile(entry.path);
      return true;
    },
    [revealFile],
  );
  const configureTasks = useConfigureVscodeProcessTasks({
    currentWorkspaceRootRef: authority.currentWorkspaceRootRef,
    openFile: openConfiguredTasksFile,
    workspaceFiles,
    workspaceIdentity: workspaceIdentityDescriptor,
    workspaceOwnerFiles: ownerFiles,
    workspaceRoot,
    workspaceRuntimeOwner: runtimeOwner,
    workspaceRuntimeOwnerClaimsRef: authority.workspaceRuntimeOwnerClaimsRef,
    workspaceRuntimeOwnerRef: authority.workspaceRuntimeOwnerRef,
    workspaceTrustedRef,
  });
  const vscodeProcessTasks = useWorkbenchVscodeProcessTasks({
    configurationVersion: vscodeProcessTasksVersion,
    configureTasks,
    gateway: vscodeProcessTasksGateway,
    requestTerminalSession,
    rootPath: workspaceRoot,
    setNotices,
    workspaceId: workspaceIdentityDescriptor?.workspaceId ?? null,
    workspaceTrusted,
  });
  const nodePackageScripts = useWorkbenchNodePackageScripts({
    currentWorkspaceRootRef: authority.currentWorkspaceRootRef,
    discoveryVersion: nodePackageScriptDiscoveryVersion,
    gateway: nodePackageScriptsGateway,
    hasJavaScriptTypeScriptWorkspace,
    identity: workspaceIdentityDescriptor,
    reportErrorForActiveWorkspaceRoot,
    requestTerminalSession,
    rootPath: workspaceRoot,
    trusted: workspaceTrusted,
  });
  return { nodePackageScripts, vscodeProcessTasks };
}
