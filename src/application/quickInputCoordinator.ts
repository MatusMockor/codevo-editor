export interface QuickInputRequest {
  readonly defaultValue: string;
  readonly message: string;
}

interface PendingQuickInput {
  readonly request: QuickInputRequest;
  readonly scopeGeneration: number;
  readonly resolve: (value: string | null) => void;
}

export type QuickInputListener = () => void;

const MAX_DEFAULT_VALUE_LENGTH = 4096;
const MAX_MESSAGE_LENGTH = 256;
const MAX_QUEUED_INPUTS = 15;

/**
 * Serializes application input requests behind one declarative UI host.
 * Requests are immutable and every request settles exactly once.
 */
export class QuickInputCoordinator {
  private active: PendingQuickInput | null = null;
  private hostLeaseGeneration = 0;
  private readonly listeners = new Set<QuickInputListener>();
  private readonly queued: PendingQuickInput[] = [];
  private scopeGeneration = 0;
  private workspaceScope: string | null = null;

  readonly getSnapshot = (): QuickInputRequest | null => this.active?.request ?? null;

  readonly subscribe = (listener: QuickInputListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  acquireHostLease(): () => void {
    const generation = ++this.hostLeaseGeneration;
    return () => {
      queueMicrotask(() => {
        if (this.hostLeaseGeneration === generation) {
          this.cancelAll();
        }
      });
    };
  }

  prompt(message: string, defaultValue = ""): Promise<string | null> {
    if (message.length === 0 || message.length > MAX_MESSAGE_LENGTH) {
      return Promise.reject(
        new RangeError(`Quick input message must contain 1-${MAX_MESSAGE_LENGTH} characters.`),
      );
    }
    if (defaultValue.length > MAX_DEFAULT_VALUE_LENGTH) {
      return Promise.reject(
        new RangeError(
          `Quick input default value must not exceed ${MAX_DEFAULT_VALUE_LENGTH} characters.`,
        ),
      );
    }

    const request: QuickInputRequest = {
      defaultValue: `${defaultValue}`,
      message: `${message}`,
    };

    return new Promise((resolve) => {
      const pending = {
        request,
        resolve,
        scopeGeneration: this.scopeGeneration,
      };
      if (this.active) {
        if (this.queued.length >= MAX_QUEUED_INPUTS) {
          resolve(null);
          return;
        }
        this.queued.push(pending);
        return;
      }

      this.active = pending;
      this.emit();
    });
  }

  resolveActive(request: QuickInputRequest, value: string | null): void {
    const completed = this.active;
    if (!completed || completed.request !== request) {
      return;
    }

    this.active = this.queued.shift() ?? null;
    completed.resolve(
      completed.scopeGeneration === this.scopeGeneration ? value : null,
    );
    this.emit();
  }

  setWorkspaceScope(scope: string | null): void {
    if (scope === this.workspaceScope) {
      return;
    }

    this.workspaceScope = scope;
    this.scopeGeneration += 1;
    this.cancelAll();
  }

  cancelAll(): void {
    const pending = this.active ? [this.active, ...this.queued] : [...this.queued];
    if (pending.length === 0) {
      return;
    }

    this.active = null;
    this.queued.length = 0;
    for (const input of pending) {
      input.resolve(null);
    }
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
