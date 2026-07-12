export const DOCUMENT_SYNC_CLOSE_GRACE_MS = 500;

export interface WorkspaceCloseRequest {
  closeDocuments: readonly (() => Promise<void>)[];
  disposeRuntime: () => Promise<void>;
}

export class CloseCoordinator {
  constructor(
    private readonly documentCloseGraceMs = DOCUMENT_SYNC_CLOSE_GRACE_MS,
  ) {}

  async close(request: WorkspaceCloseRequest): Promise<void> {
    try {
      await settleBestEffortWithin(
        request.closeDocuments.map(invokeBestEffort),
        this.documentCloseGraceMs,
      );
    } finally {
      await request.disposeRuntime();
    }
  }
}

function invokeBestEffort(operation: () => Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(operation)
    .catch(() => undefined);
}

async function settleBestEffortWithin(
  operations: readonly Promise<void>[],
  timeoutMs: number,
): Promise<void> {
  if (operations.length === 0) {
    return;
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const completion = Promise.all(operations).then(() => "settled" as const);
  const timeout = new Promise<"timed-out">((resolve) => {
    timeoutId = setTimeout(() => resolve("timed-out"), timeoutMs);
  });
  const result = await Promise.race([completion, timeout]);

  if (result === "timed-out") {
    void completion.catch(() => undefined);
  }

  if (timeoutId === null) {
    return;
  }
  clearTimeout(timeoutId);
}
