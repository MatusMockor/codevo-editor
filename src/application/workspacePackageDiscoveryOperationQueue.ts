import type { WorkspaceSourceDiscoveryGateway } from "../domain/workspaceSourceDiscovery";

export const MAX_PHYSICAL_WORKSPACE_PACKAGE_DISCOVERY_OPERATIONS = 4;

interface PendingOperation<T> {
  cancelPending?: () => void;
  readonly factory: () => Promise<T>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: T) => void;
  readonly signal: AbortSignal;
}

export class WorkspacePackageDiscoveryOperationQueue {
  private active = 0;
  private readonly pending: PendingOperation<unknown>[] = [];

  run<T>(factory: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise<T>((resolve, reject) => {
      const operation: PendingOperation<T> = { factory, reject, resolve, signal };
      const cancelPending = () => {
        const index = this.pending.indexOf(operation as PendingOperation<unknown>);
        if (index < 0) return;
        this.pending.splice(index, 1);
        reject(abortError());
      };
      operation.cancelPending = cancelPending;
      signal.addEventListener("abort", cancelPending, { once: true });
      this.pending.push(operation as PendingOperation<unknown>);
      this.drain();
    });
  }

  private drain(): void {
    while (
      this.active < MAX_PHYSICAL_WORKSPACE_PACKAGE_DISCOVERY_OPERATIONS &&
      this.pending.length > 0
    ) {
      const operation = this.pending.shift();
      if (!operation) return;
      if (operation.cancelPending) {
        operation.signal.removeEventListener("abort", operation.cancelPending);
        delete operation.cancelPending;
      }
      if (operation.signal.aborted) {
        operation.reject(abortError());
        continue;
      }
      this.active += 1;
      let settled = false;
      const cancelActive = () => {
        if (settled) return;
        settled = true;
        operation.reject(abortError());
      };
      operation.signal.addEventListener("abort", cancelActive, { once: true });

      let physical: Promise<unknown>;
      try {
        physical = operation.factory();
      } catch (error) {
        physical = Promise.reject(error);
      }
      void physical
        .then(
          (value) => {
            if (settled) return;
            settled = true;
            operation.resolve(value);
          },
          (error: unknown) => {
            if (settled) return;
            settled = true;
            operation.reject(error);
          },
        )
        .finally(() => {
          operation.signal.removeEventListener("abort", cancelActive);
          this.active -= 1;
          this.drain();
        });
    }
  }
}

const QUEUES = new WeakMap<
  WorkspaceSourceDiscoveryGateway,
  WorkspacePackageDiscoveryOperationQueue
>();

export function runWorkspacePackageDiscoveryOperation<T>(
  gateway: WorkspaceSourceDiscoveryGateway,
  signal: AbortSignal,
  factory: () => Promise<T>,
): Promise<T> {
  let queue = QUEUES.get(gateway);
  if (!queue) {
    queue = new WorkspacePackageDiscoveryOperationQueue();
    QUEUES.set(gateway, queue);
  }
  return queue.run(factory, signal);
}

function abortError(): DOMException {
  return new DOMException("Workspace package discovery was cancelled.", "AbortError");
}
