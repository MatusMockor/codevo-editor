export interface CaptureWorkspaceBeforeSwitchPorts {
  invalidatePendingFileOpen(): void;
  persistWorkspaceSession(rootPath: string): Promise<void>;
  cacheWorkspaceState(rootPath: string): void;
  reportPersistenceError(rootPath: string, error: unknown): void;
}

export interface CaptureWorkspaceBeforeSwitchRequest {
  rootPath: string;
  cacheWorkspace: boolean;
  isRequestCurrent(): boolean;
}

export async function captureWorkspaceBeforeSwitch(
  request: CaptureWorkspaceBeforeSwitchRequest,
  ports: CaptureWorkspaceBeforeSwitchPorts,
): Promise<"continue" | "stale"> {
  ports.invalidatePendingFileOpen();

  if (!request.cacheWorkspace) {
    return "continue";
  }

  try {
    await ports.persistWorkspaceSession(request.rootPath);
  } catch (error) {
    ports.reportPersistenceError(request.rootPath, error);
  }

  if (!request.isRequestCurrent()) {
    return "stale";
  }

  ports.cacheWorkspaceState(request.rootPath);
  return "continue";
}
