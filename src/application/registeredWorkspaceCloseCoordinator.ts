import type {
  RegisteredWorkspaceRuntimeDisposalResult,
  RegisteredWorkspaceRuntimeDisposalTarget,
} from "../domain/workspaceRuntimeLifecycle";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";
import { CloseCoordinator } from "./closeCoordinator";
import {
  retryWhileWorkspaceReleasing,
  scheduleWorkspaceReleaseRetry,
  WORKSPACE_RELEASE_STILL_IN_PROGRESS,
  type WorkspaceReleaseRetryDelay,
  type WorkspaceReleaseRetryOutcome,
} from "./workspaceReleaseRetry";

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
  | { readonly status: "retainedByOtherOwners" }
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
  constructor(
    private readonly closeCoordinator = new CloseCoordinator(),
    private readonly releaseRetryDelay: WorkspaceReleaseRetryDelay = scheduleWorkspaceReleaseRetry,
  ) {}

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
        const outcome = await retryWhileWorkspaceReleasing({
          attempt: () => request.disposeRegisteredWorkspace(request.lease.target),
          delay: this.releaseRetryDelay,
          isCurrent: request.lease.isCurrent,
          isReleasing: (result) => result.status === "releasing",
        });
        disposal.result = settledDisposalResult(outcome);
      },
    });
    if (!disposal.result) {
      return { status: "stale" };
    }

    switch (disposal.result.status) {
      case "closed":
      case "unknownWorkspace":
        return { status: "closed" };
      case "releasing":
        return { status: "incomplete", errors: [WORKSPACE_RELEASE_STILL_IN_PROGRESS] };
      case "retainedByOtherOwners":
        return { status: "retainedByOtherOwners" };
      case "incomplete":
        return { status: "incomplete", errors: disposal.result.errors };
      default: {
        const exhaustive: never = disposal.result;
        return exhaustive;
      }
    }
  }
}

function settledDisposalResult(
  outcome: WorkspaceReleaseRetryOutcome<RegisteredWorkspaceRuntimeDisposalResult>,
): RegisteredWorkspaceRuntimeDisposalResult | null {
  switch (outcome.kind) {
    case "settled":
      return outcome.result;
    case "abandoned":
      return null;
    case "exhausted":
      return { status: "incomplete", errors: [WORKSPACE_RELEASE_STILL_IN_PROGRESS] };
    default: {
      const unsupported: never = outcome;
      return unsupported;
    }
  }
}
