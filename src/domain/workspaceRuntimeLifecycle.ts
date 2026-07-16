export interface WorkspaceRuntimeLifecycleGateway {
  disposeWorkspace(rootPath: string): Promise<void>;
}

export type ProjectRuntimeStopResult = "stopped" | "incomplete" | "stale";
