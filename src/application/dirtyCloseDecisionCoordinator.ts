import type { DirtyCloseDecision } from "../domain/dirtyClose";
import type {
  DirtyCloseDecisionPort,
  DirtyCloseDecisionRequest,
} from "./dirtyCloseDecisionPort";

export type DirtyCloseDecisionListener = () => void;

interface PendingDecision {
  readonly request: DirtyCloseDecisionRequest;
  readonly resolve: (decision: DirtyCloseDecision) => void;
}

/**
 * Bridges application requests to one UI host and serializes simultaneous
 * close attempts so every caller receives exactly one decision.
 */
export class DirtyCloseDecisionCoordinator implements DirtyCloseDecisionPort {
  private active: PendingDecision | null = null;
  private hostLeaseGeneration = 0;
  private readonly listeners = new Set<DirtyCloseDecisionListener>();
  private readonly queued: PendingDecision[] = [];

  readonly getSnapshot = (): DirtyCloseDecisionRequest | null =>
    this.active?.request ?? null;

  readonly subscribe = (listener: DirtyCloseDecisionListener): (() => void) => {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  };

  acquireHostLease(): () => void {
    const generation = ++this.hostLeaseGeneration;

    return () => {
      queueMicrotask(() => {
        if (this.hostLeaseGeneration !== generation) {
          return;
        }

        this.cancelAll();
      });
    };
  }

  decideDirtyClose(
    request: DirtyCloseDecisionRequest,
  ): Promise<DirtyCloseDecision> {
    const requestSnapshot = snapshotRequest(request);

    return new Promise((resolve) => {
      const pending = { request: requestSnapshot, resolve };
      if (this.active) {
        this.queued.push(pending);
        return;
      }

      this.active = pending;
      this.emit();
    });
  }

  resolveActive(
    request: DirtyCloseDecisionRequest,
    decision: DirtyCloseDecision,
  ): void {
    const completed = this.active;
    if (!completed || completed.request !== request) {
      return;
    }

    this.active = this.queued.shift() ?? null;
    completed.resolve(decision);
    this.emit();
  }

  cancelAll(): void {
    const pending = this.active ? [this.active, ...this.queued] : [...this.queued];
    if (pending.length === 0) {
      return;
    }

    this.active = null;
    this.queued.length = 0;
    for (const decision of pending) {
      decision.resolve("cancel");
    }
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function snapshotRequest(
  request: DirtyCloseDecisionRequest,
): DirtyCloseDecisionRequest {
  return {
    scope: request.scope,
    documents: request.documents?.map((document) => ({ ...document })),
    documentNames: [...request.documentNames],
  };
}
