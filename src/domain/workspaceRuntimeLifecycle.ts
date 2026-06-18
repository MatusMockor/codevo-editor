export interface WorkspaceRuntimeLifecycleGateway {
  disposeWorkspace(rootPath: string): Promise<void>;
}
