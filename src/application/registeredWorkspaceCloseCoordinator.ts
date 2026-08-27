import type {
  RegisteredWorkspaceRuntimeDisposalResult,
  RegisteredWorkspaceRuntimeDisposalTarget,
} from "../domain/workspaceRuntimeLifecycle";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";
import { CloseCoordinator } from "./closeCoordinator";

export interface RegisteredWorkspaceCloseLease {
  readonly target: RegisteredWorkspaceRuntimeDisposalTarget;
  isCurrent: () => boolean;
}

export type RegisteredWorkspaceClosePreparation =
  | { readonly status: "legacy" }
  | { readonly status: "invalid" }
  | { readonly status: "ready"; readonly lease: RegisteredWorkspaceCloseLease };

export type RegisteredWorkspaceCloseResult =
  | { readonly status: "closed" }
  | { readonly status: "incomplete"; readonly errors: readonly string[] }
  | { readonly status: "stale" };

export interface RegisteredWorkspaceCloseRequest {
  readonly lease: RegisteredWorkspaceCloseLease;
  readonly closeDocuments: readonly (() => Promise<void>)[];
  disposeRegisteredWorkspace: (
    target: RegisteredWorkspaceRuntimeDisposalTarget,
  ) => Promise<RegisteredWorkspaceRuntimeDisposalResult>;
}

export function prepareRegisteredWorkspaceClose(
  descriptor: WorkspaceIdentityDescriptor,
  isCurrent: () => boolean,
): RegisteredWorkspaceClosePreparation {
  if (descriptor.admissionToken === undefined) {
    return { status: "legacy" };
  }
  if (!Number.isSafeInteger(descriptor.admissionToken) || descriptor.admissionToken <= 0) {
    return { status: "invalid" };
  }
  if (!descriptor.workspaceId || !descriptor.selectedPath || !descriptor.canonicalRoot) {
    return { status: "invalid" };
  }
  return {
    status: "ready",
    lease: {
      target: {
        workspaceId: descriptor.workspaceId,
        admissionToken: descriptor.admissionToken,
        selectedRootPath: descriptor.selectedPath,
        canonicalRootPath: descriptor.canonicalRoot,
      },
      isCurrent,
    },
  };
}

export class RegisteredWorkspaceCloseCoordinator {
  constructor(private readonly closeCoordinator = new CloseCoordinator()) {}

  async close(request: RegisteredWorkspaceCloseRequest): Promise<RegisteredWorkspaceCloseResult> {
    if (!request.lease.isCurrent()) {
      return { status: "stale" };
    }

    const disposal = {
      result: null as RegisteredWorkspaceRuntimeDisposalResult | null,
    };
    await this.closeCoordinator.close({
      closeDocuments: request.closeDocuments.map((closeDocument) => async () => {
        if (!request.lease.isCurrent()) {
          return;
        }
        await closeDocument();
      }),
      disposeRuntime: async () => {
        if (!request.lease.isCurrent()) {
          return;
        }
        const result = await request.disposeRegisteredWorkspace(request.lease.target);
        disposal.result = result;
      },
    });
    if (!disposal.result) {
      return { status: "stale" };
    }

    switch (disposal.result.status) {
      case "closed":
        return { status: "closed" };
      case "incomplete":
        return { status: "incomplete", errors: disposal.result.errors };
      default: {
        const exhaustive: never = disposal.result;
        return exhaustive;
      }
    }
  }
}
