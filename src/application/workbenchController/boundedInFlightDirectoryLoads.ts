import type { FileEntry } from "../../domain/workspace";
import { normalizedWorkspaceRootKey } from "../../domain/workspaceRootKey";

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

export interface DirectoryLoadPresentation {
  readonly id: symbol;
  readonly settlement: Promise<"deadline" | "superseded">;
}

export class BoundedInFlightDirectoryLoads {
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
    return this.permits.get(key);
  }

  canAdmit(key: string, generation: number, rootPath: string | null = null): boolean {
    return this.permits.canAdmit(
      key,
      directoryLoadOwnerKey(generation, rootPath),
      this.maxEntriesPerGeneration,
    );
  }

  admit(key: string, load: InFlightDirectoryLoad): boolean {
    return this.permits.admit(
      key,
      load,
      directoryLoadOwnerKey(load.generation, load.rootPath),
      this.maxEntriesPerGeneration,
    );
  }

  deleteIfCurrent(key: string, requestId: symbol): void {
    this.permits.deleteIfCurrent(key, requestId);
  }

  retireIfCurrent(key: string, requestId: symbol): void {
    this.permits.deleteIfCurrent(key, requestId);
  }

  beginPresentation(key: string, deadlineMs: number): DirectoryLoadPresentation {
    return this.permits.beginPresentation(key, deadlineMs);
  }

  isCurrentPresentation(key: string, presentationId: symbol): boolean {
    return this.permits.isCurrentPresentation(key, presentationId);
  }

  finishPresentation(key: string, presentationId: symbol): void {
    this.permits.finishPresentation(key, presentationId);
  }

  cancelPresentation(key: string, presentationId: symbol): boolean {
    return this.permits.cancelPresentation(key, presentationId);
  }

  values(): IterableIterator<InFlightDirectoryLoad> {
    return this.permits.values();
  }

  size(): number {
    return this.permits.size();
  }
}

function directoryLoadOwnerKey(generation: number, rootPath: string | null): string {
  return JSON.stringify([normalizedWorkspaceRootKey(rootPath), generation]);
}

class DirectoryLoadPermitPool {
  private active = 0;
  private readonly currentPresentationByKey = new Map<
    string,
    {
      readonly id: symbol;
      readonly resolve: (settlement: "deadline" | "superseded") => void;
      readonly timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly entries = new Map<string, InFlightDirectoryLoad>();
  private readonly ownersByRequestId = new Map<symbol, string>();

  constructor(private readonly capacity: number) {}

  hasCapacity(): boolean {
    return this.active < this.capacity;
  }

  get(key: string): InFlightDirectoryLoad | undefined {
    return this.entries.get(key);
  }

  canAdmit(key: string, ownerKey: string, maxEntriesPerOwner: number): boolean {
    return (
      !this.entries.has(key) &&
      this.hasCapacity() &&
      [...this.ownersByRequestId.values()].filter((candidateOwner) => candidateOwner === ownerKey)
        .length < maxEntriesPerOwner
    );
  }

  admit(
    key: string,
    load: InFlightDirectoryLoad,
    ownerKey: string,
    maxEntriesPerOwner: number,
  ): boolean {
    if (!this.canAdmit(key, ownerKey, maxEntriesPerOwner)) {
      return false;
    }
    this.active += 1;
    this.entries.set(key, load);
    this.ownersByRequestId.set(load.requestId, ownerKey);
    return true;
  }

  deleteIfCurrent(key: string, requestId: symbol): void {
    if (this.ownersByRequestId.delete(requestId)) {
      this.active = Math.max(0, this.active - 1);
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

  beginPresentation(key: string, deadlineMs: number): DirectoryLoadPresentation {
    const previous = this.currentPresentationByKey.get(key);
    if (previous) {
      clearTimeout(previous.timer);
      previous.resolve("superseded");
    }

    const presentationId = Symbol(key);
    let resolve!: (settlement: "deadline" | "superseded") => void;
    const settlement = new Promise<"deadline" | "superseded">((resolvePromise) => {
      resolve = resolvePromise;
    });
    const timer = setTimeout(() => resolve("deadline"), deadlineMs);
    this.currentPresentationByKey.set(key, { id: presentationId, resolve, timer });
    return { id: presentationId, settlement };
  }

  isCurrentPresentation(key: string, presentationId: symbol): boolean {
    return this.currentPresentationByKey.get(key)?.id === presentationId;
  }

  finishPresentation(key: string, presentationId: symbol): void {
    if (this.isCurrentPresentation(key, presentationId)) {
      const current = this.currentPresentationByKey.get(key);
      if (current) {
        clearTimeout(current.timer);
      }
      this.currentPresentationByKey.delete(key);
    }
  }

  cancelPresentation(key: string, presentationId: symbol): boolean {
    const current = this.currentPresentationByKey.get(key);
    if (current?.id !== presentationId) {
      return false;
    }
    clearTimeout(current.timer);
    this.currentPresentationByKey.delete(key);
    current.resolve("superseded");
    return true;
  }
}
