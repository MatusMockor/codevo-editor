import { invoke } from "@tauri-apps/api/core";
import type {
  BoundedWorkspaceSourceRead,
  WorkspaceJavaScriptSourceFileEnumeration,
  WorkspaceSourceDiscoveryGateway,
} from "../domain/workspaceSourceDiscovery";
import type {
  NpmOpenScriptGatewayOwner,
  NpmOpenScriptGatewayOwnerPort,
  NpmOpenScriptNavigationGateway,
  NpmOpenScriptNavigationGatewayBinder,
} from "../application/useNpmOpenScriptNavigation";
import type { WorkspaceIdentityDescriptorResolver } from "./tauriWorkspaceIdentityGateway";
import {
  invokeWorkspaceSourceBoundedReadIpc,
  invokeWorkspaceSourceEnumerationIpc,
  type InvokeWorkspaceSourceDiscoveryCommand,
} from "./tauriWorkspaceSourceDiscoveryIpcContract";

const invokeWorkspaceSourceCommand: InvokeWorkspaceSourceDiscoveryCommand = (command, args) =>
  invoke(command, args);

export class TauriWorkspaceSourceDiscoveryGateway
  implements WorkspaceSourceDiscoveryGateway, NpmOpenScriptNavigationGatewayBinder
{
  constructor(
    private readonly identities: WorkspaceIdentityDescriptorResolver,
    private readonly invokeCommand: InvokeWorkspaceSourceDiscoveryCommand = invokeWorkspaceSourceCommand,
  ) {}

  enumerateJavaScriptSourceFiles(
    workspaceRoot: string,
    limits: { readonly maxFiles: number; readonly maxVisited: number },
  ): Promise<WorkspaceJavaScriptSourceFileEnumeration> {
    return invokeWorkspaceSourceEnumerationIpc(this.invokeCommand, {
      workspaceId: this.workspaceId(workspaceRoot),
      maxFiles: limits.maxFiles,
      maxVisited: limits.maxVisited,
    });
  }

  readSourceTextBounded(
    workspaceRoot: string,
    relativePath: string,
    maxBytes: number,
  ): Promise<BoundedWorkspaceSourceRead> {
    return invokeWorkspaceSourceBoundedReadIpc(this.invokeCommand, {
      workspaceId: this.workspaceId(workspaceRoot),
      relativePath,
      maxBytes,
    });
  }

  /**
   * Creates a narrow npm manifest reader bound to a controller-owned authority port.
   * The shared gateway remains a singleton; the returned adapter carries no authority
   * of its own and fails closed whenever the port is absent or has advanced.
   */
  bindNpmOpenScriptNavigation(
    ownerPort: NpmOpenScriptGatewayOwnerPort | null,
  ): NpmOpenScriptNavigationGateway {
    return {
      readManifestBounded: async (request) => {
        const owner = ownerPort?.() ?? null;
        if (!owner || !validNpmOwner(owner) || !requestMatchesOwner(request, owner)) {
          return { status: "changed" };
        }
        if (!this.hasExactWorkspaceRoot(owner.rootPath, owner.workspaceId)) {
          return { status: "changed" };
        }

        const lease = npmOwnerLease(owner);
        const read = await invokeWorkspaceSourceBoundedReadIpc(this.invokeCommand, {
          workspaceId: owner.workspaceId,
          relativePath: request.manifestRelativePath,
          maxBytes: request.maxBytes,
        });
        if (!this.isNpmLeaseCurrent(ownerPort, lease)) return { status: "changed" };
        if (read.status !== "ok") return read;

        return {
          status: "ok",
          content: read.content,
          revision: lease.revision,
          isCurrent: () => this.isNpmLeaseCurrent(ownerPort, lease),
        };
      },
    };
  }

  private isNpmLeaseCurrent(
    ownerPort: NpmOpenScriptGatewayOwnerPort | null,
    lease: NpmOwnerLease,
  ): boolean {
    const current = ownerPort?.() ?? null;
    return (
      current !== null &&
      validNpmOwner(current) &&
      sameNpmOwner(current, lease.owner) &&
      this.hasExactWorkspaceRoot(current.rootPath, current.workspaceId)
    );
  }

  private hasExactWorkspaceRoot(rootPath: string, workspaceId: string): boolean {
    const match = this.identities.matchForPath?.(rootPath, workspaceId);
    return (
      match !== null &&
      match !== undefined &&
      match.descriptor.workspaceId === workspaceId &&
      match.relativePath === ""
    );
  }

  private workspaceId(workspaceRoot: string): string {
    const match = this.identities.matchForPath?.(workspaceRoot);
    if (!match || match.relativePath !== "") {
      throw new Error("Workspace source discovery requires an opened native workspace root.");
    }
    return match.descriptor.workspaceId;
  }
}

interface NpmOwnerLease {
  readonly owner: NpmOpenScriptGatewayOwner;
  readonly revision: string;
}

function npmOwnerLease(owner: NpmOpenScriptGatewayOwner): NpmOwnerLease {
  const captured = Object.freeze({ ...owner });
  return {
    owner: captured,
    revision: JSON.stringify([
      captured.workspaceId,
      captured.ownerKey,
      captured.activationEpoch,
      captured.rootPath,
      captured.nodePackageScriptDiscoveryVersion,
    ]),
  };
}

function requestMatchesOwner(
  request: Parameters<NpmOpenScriptNavigationGateway["readManifestBounded"]>[0],
  owner: NpmOpenScriptGatewayOwner,
): boolean {
  return (
    request.activationEpoch === owner.activationEpoch &&
    request.ownerKey === owner.ownerKey &&
    request.rootPath === owner.rootPath &&
    request.workspaceId === owner.workspaceId
  );
}

function sameNpmOwner(left: NpmOpenScriptGatewayOwner, right: NpmOpenScriptGatewayOwner): boolean {
  return (
    left.activationEpoch === right.activationEpoch &&
    left.nodePackageScriptDiscoveryVersion === right.nodePackageScriptDiscoveryVersion &&
    left.ownerKey === right.ownerKey &&
    left.rootPath === right.rootPath &&
    left.workspaceId === right.workspaceId
  );
}

function validNpmOwner(owner: NpmOpenScriptGatewayOwner): boolean {
  return (
    Number.isSafeInteger(owner.activationEpoch) &&
    owner.activationEpoch >= 0 &&
    Number.isSafeInteger(owner.nodePackageScriptDiscoveryVersion) &&
    owner.nodePackageScriptDiscoveryVersion >= 0 &&
    owner.ownerKey.length > 0 &&
    owner.rootPath.length > 0 &&
    owner.workspaceId.length > 0
  );
}
