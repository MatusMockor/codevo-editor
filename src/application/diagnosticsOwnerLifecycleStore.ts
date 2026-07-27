import type { DiagnosticsCacheLedger } from "../domain/boundedDiagnosticsCache";

export const DIAGNOSTICS_LIFECYCLE_MAX_OWNERS = 64;
export const DIAGNOSTICS_LIFECYCLE_MAX_PUBLICATION_URIS_PER_OWNER = 20_000;
export const DIAGNOSTICS_LIFECYCLE_MAX_TOTAL_URI_STATES = 80_000;
export const DIAGNOSTICS_LIFECYCLE_MAX_TOTAL_RETAINED_UTF8_BYTES = 32 * 1024 * 1024;

interface DiagnosticsOwnerLifecycle {
  closed: boolean;
  generation: number;
  uriHistorySaturated: boolean;
  ledger?: DiagnosticsCacheLedger;
  nextPublicationRevision: number;
  readonly uriStateByUri: Map<string, DiagnosticsOwnerUriState>;
}

interface DiagnosticsOwnerUriState {
  appliedVersion?: number;
  onAppliedVersionEvicted?: () => void;
  publicationRevision?: number;
}

/**
 * Bounded exact-owner lifecycle store for diagnostics orchestration.
 *
 * A globally monotonic generation prevents A → B → A alias/session reuse from
 * making an old async completion current again. Per-owner URI revisions are
 * capped with deterministic oldest-first eviction; an evicted async operation
 * fails closed because its receipt is no longer present.
 */
export class DiagnosticsOwnerLifecycleStore {
  private readonly owners = new Map<string, DiagnosticsOwnerLifecycle>();
  private nextGeneration = 0;
  private totalRetainedUtf8Bytes = 0;
  private totalUriStates = 0;

  revision(ownerKey: string): number | null {
    const owner = this.owners.get(ownerKey);
    return owner?.closed === false ? owner.generation : null;
  }

  capture(ownerKey: string): number | null {
    const existing = this.owners.get(ownerKey);
    if (existing) {
      return existing.closed ? null : existing.generation;
    }
    return this.createOwner(ownerKey)?.generation ?? null;
  }

  isCurrent(ownerKey: string, generation: number): boolean {
    const owner = this.owners.get(ownerKey);
    return owner?.closed === false && owner.generation === generation;
  }

  isClosed(ownerKey: string): boolean {
    return this.owners.get(ownerKey)?.closed === true;
  }

  close(ownerKey: string): boolean {
    const owner = this.owners.get(ownerKey) ?? this.createOwner(ownerKey);
    if (!owner) {
      return false;
    }
    owner.closed = true;
    owner.generation = this.allocateGeneration();
    this.clearOwnerData(ownerKey);
    return true;
  }

  resetPending(ownerKey: string): void {
    const owner = this.owners.get(ownerKey);
    if (owner?.closed !== false) {
      return;
    }
    owner.generation = this.allocateGeneration();
    this.clearOwnerData(ownerKey);
  }

  prepare(ownerKey: string): boolean {
    const owner = this.owners.get(ownerKey) ?? this.createOwner(ownerKey);
    if (!owner) {
      return false;
    }
    owner.closed = false;
    owner.generation = this.allocateGeneration();
    this.clearOwnerData(ownerKey);
    return true;
  }

  restore(ownerKey: string): boolean {
    const owner = this.owners.get(ownerKey) ?? this.createOwner(ownerKey);
    if (!owner) {
      return false;
    }
    if (owner.closed) {
      owner.closed = false;
      owner.generation = this.allocateGeneration();
    }
    return true;
  }

  clearOwnerData(ownerKey: string): void {
    const owner = this.owners.get(ownerKey);
    if (!owner) {
      return;
    }
    this.totalRetainedUtf8Bytes -= owner.ledger?.retainedUtf8Bytes ?? 0;
    owner.ledger = undefined;
    const removedUriStates = owner.uriStateByUri.size;
    for (const uriState of owner.uriStateByUri.values()) {
      uriState.onAppliedVersionEvicted?.();
    }
    owner.uriStateByUri.clear();
    this.totalUriStates -= removedUriStates;
    owner.uriHistorySaturated = false;
  }

  ledger(ownerKey: string): DiagnosticsCacheLedger | undefined {
    return this.owners.get(ownerKey)?.ledger;
  }

  setLedger(ownerKey: string, ledger: DiagnosticsCacheLedger): boolean {
    const owner = this.owners.get(ownerKey);
    if (owner?.closed !== false) {
      return false;
    }
    const nextTotal =
      this.totalRetainedUtf8Bytes -
      (owner.ledger?.retainedUtf8Bytes ?? 0) +
      (ledger.retainedUtf8Bytes ?? 0);
    if (nextTotal > DIAGNOSTICS_LIFECYCLE_MAX_TOTAL_RETAINED_UTF8_BYTES) {
      return false;
    }
    owner.ledger = ledger;
    this.totalRetainedUtf8Bytes = nextTotal;
    return true;
  }

  nextPublication(ownerKey: string, uri: string): number | null {
    const owner = this.owners.get(ownerKey);
    if (owner?.closed !== false) {
      return null;
    }
    owner.nextPublicationRevision += 1;
    const revision = owner.nextPublicationRevision;

    const uriState = this.touchUriState(owner, uri);
    if (!uriState) {
      return null;
    }
    uriState.publicationRevision = revision;
    return revision;
  }

  appliedVersion(ownerKey: string, uri: string): number | undefined {
    const owner = this.owners.get(ownerKey);
    return owner?.closed === false ? owner.uriStateByUri.get(uri)?.appliedVersion : undefined;
  }

  canAcceptVersion(ownerKey: string, uri: string): boolean {
    const owner = this.owners.get(ownerKey);
    return (
      owner?.closed === false &&
      (owner.uriStateByUri.has(uri) ||
        (!owner.uriHistorySaturated &&
          this.totalUriStates < DIAGNOSTICS_LIFECYCLE_MAX_TOTAL_URI_STATES))
    );
  }

  recordAppliedVersion(
    ownerKey: string,
    uri: string,
    version: number,
    onEvicted: () => void,
  ): boolean {
    const owner = this.owners.get(ownerKey);
    if (owner?.closed !== false) {
      return false;
    }
    const uriState = this.touchUriState(owner, uri);
    if (!uriState) {
      return false;
    }
    uriState.onAppliedVersionEvicted?.();
    uriState.appliedVersion = version;
    uriState.onAppliedVersionEvicted = onEvicted;
    return true;
  }

  isPublicationCurrent(ownerKey: string, uri: string, revision: number): boolean {
    const owner = this.owners.get(ownerKey);
    return (
      owner?.closed === false && owner.uriStateByUri.get(uri)?.publicationRevision === revision
    );
  }

  publicationUriCount(ownerKey: string): number {
    return this.owners.get(ownerKey)?.uriStateByUri.size ?? 0;
  }

  ownerCount(): number {
    return this.owners.size;
  }

  retainedUtf8Bytes(): number {
    return this.totalRetainedUtf8Bytes;
  }

  uriStateCount(): number {
    return this.totalUriStates;
  }

  private createOwner(ownerKey: string): DiagnosticsOwnerLifecycle | null {
    while (this.owners.size >= DIAGNOSTICS_LIFECYCLE_MAX_OWNERS) {
      const closedOwner = Array.from(this.owners.entries()).find(([, owner]) => owner.closed);
      if (!closedOwner) {
        return null;
      }
      this.owners.delete(closedOwner[0]);
    }

    const owner: DiagnosticsOwnerLifecycle = {
      closed: false,
      generation: this.allocateGeneration(),
      nextPublicationRevision: 0,
      uriHistorySaturated: false,
      uriStateByUri: new Map(),
    };
    this.owners.set(ownerKey, owner);
    return owner;
  }

  private allocateGeneration(): number {
    this.nextGeneration += 1;
    return this.nextGeneration;
  }

  private touchUriState(
    owner: DiagnosticsOwnerLifecycle,
    uri: string,
  ): DiagnosticsOwnerUriState | null {
    const existing = owner.uriStateByUri.get(uri);
    if (existing) {
      owner.uriStateByUri.delete(uri);
      owner.uriStateByUri.set(uri, existing);
      return existing;
    }

    while (owner.uriStateByUri.size >= DIAGNOSTICS_LIFECYCLE_MAX_PUBLICATION_URIS_PER_OWNER) {
      const oldest = owner.uriStateByUri.entries().next().value as
        [string, DiagnosticsOwnerUriState] | undefined;
      if (!oldest) {
        break;
      }
      oldest[1].onAppliedVersionEvicted?.();
      owner.uriStateByUri.delete(oldest[0]);
      this.totalUriStates -= 1;
      owner.uriHistorySaturated = true;
    }
    if (this.totalUriStates >= DIAGNOSTICS_LIFECYCLE_MAX_TOTAL_URI_STATES) {
      return null;
    }
    const uriState: DiagnosticsOwnerUriState = {};
    owner.uriStateByUri.set(uri, uriState);
    this.totalUriStates += 1;
    return uriState;
  }
}
