import { invoke } from "@tauri-apps/api/core";
import type {
  BoundedWorkspaceTextRead,
  WorkspaceJsTestFileEnumeration,
  WorkspaceTestDiscoveryGateway,
} from "../domain/jsTestDiscovery";
import type { WorkspaceIdentityDescriptorResolver } from "./tauriWorkspaceIdentityGateway";
import {
  invokeWorkspaceTestDiscoveryIpc,
  WORKSPACE_TEST_DISCOVERY_IPC_COMMANDS,
  type InvokeWorkspaceTestDiscoveryCommand,
} from "./tauriWorkspaceTestDiscoveryIpcContract";

export class TauriWorkspaceTestDiscoveryGateway implements WorkspaceTestDiscoveryGateway {
  constructor(
    private readonly identities: WorkspaceIdentityDescriptorResolver,
    private readonly invokeCommand: InvokeWorkspaceTestDiscoveryCommand = invoke,
  ) {}

  enumerateJsTestFiles(
    workspaceRoot: string,
    limits: { readonly maxFiles: number; readonly maxVisited: number },
  ): Promise<WorkspaceJsTestFileEnumeration> {
    return invokeWorkspaceTestDiscoveryIpc(
      this.invokeCommand,
      WORKSPACE_TEST_DISCOVERY_IPC_COMMANDS.enumerate,
      {
        workspaceId: this.workspaceId(workspaceRoot),
        maxFiles: limits.maxFiles,
        maxVisited: limits.maxVisited,
      },
    );
  }

  readTextFileBounded(
    workspaceRoot: string,
    relativePath: string,
    maxBytes: number,
  ): Promise<BoundedWorkspaceTextRead> {
    return invokeWorkspaceTestDiscoveryIpc(
      this.invokeCommand,
      WORKSPACE_TEST_DISCOVERY_IPC_COMMANDS.readBounded,
      {
        workspaceId: this.workspaceId(workspaceRoot),
        relativePath,
        maxBytes,
      },
    );
  }

  private workspaceId(workspaceRoot: string): string {
    const match = this.identities.matchForPath?.(workspaceRoot);
    if (!match || match.relativePath !== "") {
      throw new Error("Workspace test discovery requires an opened native workspace root.");
    }
    return match.descriptor.workspaceId;
  }
}
