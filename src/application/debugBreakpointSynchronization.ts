export interface DebugBreakpointSyncToken {
  readonly filePath: string;
  readonly operation: number;
  readonly rootKey: string;
  readonly sessionId: number;
}

export interface DebugBreakpointSynchronization {
  begin(rootKey: string, sessionId: number, filePath: string): DebugBreakpointSyncToken;
  isLatest(token: DebugBreakpointSyncToken): boolean;
  invalidateRoot(rootKey: string): void;
}

export function createDebugBreakpointSynchronization(): DebugBreakpointSynchronization {
  const operations = new Map<string, number>();

  const keyOf = (rootKey: string, filePath: string) => `${rootKey}\0${filePath}`;

  return {
    begin(rootKey, sessionId, filePath) {
      const key = keyOf(rootKey, filePath);
      const operation = (operations.get(key) ?? 0) + 1;
      operations.set(key, operation);
      return { filePath, operation, rootKey, sessionId };
    },
    isLatest(token) {
      return operations.get(keyOf(token.rootKey, token.filePath)) === token.operation;
    },
    invalidateRoot(rootKey) {
      for (const [key, operation] of operations) {
        if (key.startsWith(`${rootKey}\0`)) operations.set(key, operation + 1);
      }
    },
  };
}
