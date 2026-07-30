import type { WorkspaceSettings } from "../../domain/settings";

export interface PendingWorkspaceSettingsLoad {
  readonly legacyRawKeys: readonly string[];
  readonly promise: Promise<WorkspaceSettings>;
}

const DEFAULT_MAX_PENDING_WORKSPACE_SETTINGS_LOADS = 8;
const pendingLoadPermitPoolsByGateway = new WeakMap<object, SettingsLoadPermitPool>();

export function boundedPendingWorkspaceSettingsLoadsFor(
  gateway: object,
): BoundedPendingWorkspaceSettingsLoads {
  let permits = pendingLoadPermitPoolsByGateway.get(gateway);
  if (!permits) {
    permits = new SettingsLoadPermitPool(DEFAULT_MAX_PENDING_WORKSPACE_SETTINGS_LOADS);
    pendingLoadPermitPoolsByGateway.set(gateway, permits);
  }
  return new BoundedPendingWorkspaceSettingsLoads(
    DEFAULT_MAX_PENDING_WORKSPACE_SETTINGS_LOADS,
    permits,
  );
}

export class PendingWorkspaceSettingsLoadCapacityError extends Error {
  constructor() {
    super("Too many workspace settings reads are still pending");
    this.name = "PendingWorkspaceSettingsLoadCapacityError";
  }
}

export class BoundedPendingWorkspaceSettingsLoads {
  private readonly entries = new Map<string, PendingWorkspaceSettingsLoad>();
  private readonly permits: SettingsLoadPermitPool;

  constructor(
    maxEntries = DEFAULT_MAX_PENDING_WORKSPACE_SETTINGS_LOADS,
    permits?: SettingsLoadPermitPool,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("Pending workspace settings load capacity must be a positive integer");
    }
    this.permits = permits ?? new SettingsLoadPermitPool(maxEntries);
  }

  get(key: string): PendingWorkspaceSettingsLoad | undefined {
    return this.entries.get(key);
  }

  assertCanStart(key: string): void {
    if (!this.entries.has(key) && !this.permits.hasCapacity()) {
      throw new PendingWorkspaceSettingsLoadCapacityError();
    }
  }

  track(
    key: string,
    legacyRawKeys: readonly string[],
    start: () => Promise<WorkspaceSettings>,
  ): PendingWorkspaceSettingsLoad {
    if (!this.permits.tryAcquire()) {
      throw new PendingWorkspaceSettingsLoadCapacityError();
    }

    let promise: Promise<WorkspaceSettings>;
    try {
      promise = start();
    } catch (error) {
      this.permits.release();
      throw error;
    }
    const load = { legacyRawKeys, promise };
    this.entries.delete(key);
    this.entries.set(key, load);

    const forgetIfCurrent = () => {
      this.permits.release();
      if (this.entries.get(key) === load) {
        this.entries.delete(key);
      }
    };
    void load.promise.then(forgetIfCurrent, forgetIfCurrent);
    return load;
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}

class SettingsLoadPermitPool {
  private active = 0;

  constructor(private readonly capacity: number) {}

  hasCapacity(): boolean {
    return this.active < this.capacity;
  }

  tryAcquire(): boolean {
    if (!this.hasCapacity()) return false;
    this.active += 1;
    return true;
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
  }
}
