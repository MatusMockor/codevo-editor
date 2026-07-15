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

export interface CloseWorkspaceDocumentsBeforeSwitchPorts {
  closeLanguageServerDocuments(rootPath: string): Promise<void>;
  closeJavaScriptTypeScriptDocuments(rootPath: string): Promise<void>;
}

export interface CloseWorkspaceDocumentsBeforeSwitchRequest {
  rootPath: string;
  isRequestCurrent(): boolean;
}

export interface WorkspaceDocumentCloseCoordinatorPort {
  coordinate(rootPath: string, close: () => Promise<void>): Promise<void>;
}

export class WorkspaceDocumentCloseCoordinator
  implements WorkspaceDocumentCloseCoordinatorPort
{
  private readonly inFlight = new Map<string, Promise<void>>();

  coordinate(rootPath: string, close: () => Promise<void>): Promise<void> {
    const existing = this.inFlight.get(rootPath);
    if (existing) {
      return existing;
    }

    const pending = invokePromise(close);
    this.inFlight.set(rootPath, pending);
    void pending
      .finally(() => {
        if (this.inFlight.get(rootPath) === pending) {
          this.inFlight.delete(rootPath);
        }
      })
      .catch(() => undefined);

    return pending;
  }
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

export async function closeWorkspaceDocumentsBeforeSwitch(
  request: CloseWorkspaceDocumentsBeforeSwitchRequest,
  ports: CloseWorkspaceDocumentsBeforeSwitchPorts,
  coordinator: WorkspaceDocumentCloseCoordinatorPort,
): Promise<"continue" | "stale"> {
  await coordinator
    .coordinate(request.rootPath, async () => {
      await Promise.allSettled([
        invokePromise(() =>
          ports.closeLanguageServerDocuments(request.rootPath),
        ),
        invokePromise(() =>
          ports.closeJavaScriptTypeScriptDocuments(request.rootPath),
        ),
      ]);
    })
    .catch(() => undefined);

  if (!request.isRequestCurrent()) {
    return "stale";
  }

  return "continue";
}

function invokePromise(operation: () => Promise<void>): Promise<void> {
  try {
    return Promise.resolve(operation());
  } catch (error) {
    return Promise.reject(error);
  }
}
