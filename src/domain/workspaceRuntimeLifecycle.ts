export interface WorkspaceRuntimeLifecycleGateway {
  disposeWorkspace(rootPath: string): Promise<void>;
  disposeRegisteredWorkspace?(
    target: RegisteredWorkspaceRuntimeDisposalTarget,
  ): Promise<RegisteredWorkspaceRuntimeDisposalResult>;
}

export type ProjectRuntimeStopResult = "stopped" | "incomplete" | "stale";

export interface RegisteredWorkspaceRuntimeDisposalTarget {
  readonly workspaceId: string;
  readonly admissionToken: number;
  readonly selectedRootPath: string;
  readonly canonicalRootPath: string;
}

export type RegisteredWorkspaceRuntimeDisposalResult =
  | { readonly status: "closed" }
  | { readonly status: "incomplete"; readonly errors: readonly string[] };
