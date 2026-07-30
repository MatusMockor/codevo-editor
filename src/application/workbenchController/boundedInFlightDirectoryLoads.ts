import type { FileEntry } from "../../domain/workspace";

export const MAX_IN_FLIGHT_DIRECTORY_LOADS = 32;
export const MAX_DIRECTORY_ENTRIES_PER_LOAD = 20_000;
const directoryPermitPoolsByGateway = new WeakMap<object, DirectoryLoadPermitPool>();

export function boundedInFlightDirectoryLoadsFor(gateway: object): BoundedInFlightDirectoryLoads {
  let permits = directoryPermitPoolsByGateway.get(gateway);
  if (!permits) {
    permits = new DirectoryLoadPermitPool(MAX_IN_FLIGHT_DIRECTORY_LOADS);
    directoryPermitPoolsByGateway.set(gateway, permits);
  }
  return new BoundedInFlightDirectoryLoads(
    MAX_IN_FLIGHT_DIRECTORY_LOADS,
    Math.floor(MAX_IN_FLIGHT_DIRECTORY_LOADS / 4),
    permits,
  );
}

export interface BoundedDirectoryLoadResult {
  readonly entries: readonly FileEntry[];
  readonly truncated: boolean;
}

export interface InFlightDirectoryLoad {
  readonly generation: number;
  readonly path: string;
  readonly promise: Promise<BoundedDirectoryLoadResult>;
  readonly requestId: symbol;
  readonly rootPath: string | null;
}

export class BoundedInFlightDirectoryLoads {
  private readonly entries = new Map<string, InFlightDirectoryLoad>();
  private readonly generationsByRequestId = new Map<symbol, number>();
  private readonly permits: DirectoryLoadPermitPool;

  constructor(
    maxEntries = MAX_IN_FLIGHT_DIRECTORY_LOADS,
    private readonly maxEntriesPerGeneration = Math.max(1, Math.floor(maxEntries / 4)),
    permits?: DirectoryLoadPermitPool,
  ) {
    if (
      !Number.isInteger(maxEntries) ||
      maxEntries < 1 ||
      !Number.isInteger(maxEntriesPerGeneration) ||
      maxEntriesPerGeneration < 1 ||
      maxEntriesPerGeneration > maxEntries
    ) {
      throw new Error("Directory load capacity must be a positive integer");
    }
    this.permits = permits ?? new DirectoryLoadPermitPool(maxEntries);
  }

  get(key: string): InFlightDirectoryLoad | undefined {
    return this.entries.get(key);
  }

  canAdmit(key: string, generation: number): boolean {
    return (
      !this.entries.has(key) &&
      this.permits.hasCapacity() &&
      [...this.generationsByRequestId.values()].filter(
        (candidateGeneration) => candidateGeneration === generation,
      ).length < this.maxEntriesPerGeneration
    );
  }

  admit(key: string, load: InFlightDirectoryLoad): boolean {
    if (!this.canAdmit(key, load.generation) || !this.permits.tryAcquire()) {
      return false;
    }
    this.entries.set(key, load);
    this.generationsByRequestId.set(load.requestId, load.generation);
    return true;
  }

  deleteIfCurrent(key: string, requestId: symbol): void {
    if (this.generationsByRequestId.delete(requestId)) {
      this.permits.release();
    }
    if (this.entries.get(key)?.requestId === requestId) {
      this.entries.delete(key);
    }
  }

  values(): IterableIterator<InFlightDirectoryLoad> {
    return this.entries.values();
  }

  size(): number {
    return this.entries.size;
  }
}

class DirectoryLoadPermitPool {
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
