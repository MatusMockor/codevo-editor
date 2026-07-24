import type { WorkspaceTrustGateway, WorkspaceTrustState } from "../domain/trust";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export interface WorkspaceTrustIntent {
  readonly owner: WorkspaceRuntimeOwner;
  readonly revision: number;
  readonly rootPath: string;
  readonly trusted: boolean;
}

export interface WorkspaceTrustIntentResult {
  readonly intent: WorkspaceTrustIntent;
  readonly trust: WorkspaceTrustState;
}

/**
 * Serializes trust-store mutations per admitted workspace owner while allowing
 * a newer UI intent to supersede an in-flight mutation.
 */
export class WorkspaceTrustIntentCoordinator {
  private readonly desiredByOwner = new Map<string, WorkspaceTrustIntent>();
  private readonly mutationByOwner = new Map<string, Promise<WorkspaceTrustIntentResult>>();
  private nextRevision = 0;

  desiredTrust(owner: WorkspaceRuntimeOwner, rootPath: string): boolean | null {
    const intent = this.desiredByOwner.get(owner.ownerKey);
    if (!intent) {
      return null;
    }

    if (!workspaceRootKeysEqual(intent.owner.executionRoot, owner.executionRoot)) {
      return null;
    }

    if (!workspaceRootKeysEqual(intent.rootPath, rootPath)) {
      return null;
    }

    return intent.trusted;
  }

  request(owner: WorkspaceRuntimeOwner, rootPath: string, trusted: boolean): WorkspaceTrustIntent {
    const intent = {
      owner,
      revision: ++this.nextRevision,
      rootPath,
      trusted,
    };
    this.desiredByOwner.set(owner.ownerKey, intent);
    return intent;
  }

  persist(ownerKey: string, gateway: WorkspaceTrustGateway): Promise<WorkspaceTrustIntentResult> {
    const existing = this.mutationByOwner.get(ownerKey);
    if (existing) {
      return existing;
    }

    const mutation = this.persistLatest(ownerKey, gateway).finally(() => {
      if (this.mutationByOwner.get(ownerKey) === mutation) {
        this.mutationByOwner.delete(ownerKey);
      }
    });
    this.mutationByOwner.set(ownerKey, mutation);
    return mutation;
  }

  release(ownerKey: string): void {
    this.desiredByOwner.delete(ownerKey);
    this.mutationByOwner.delete(ownerKey);
  }

  private async persistLatest(
    ownerKey: string,
    gateway: WorkspaceTrustGateway,
  ): Promise<WorkspaceTrustIntentResult> {
    while (true) {
      const intent = this.desiredByOwner.get(ownerKey);
      if (!intent) {
        throw new Error("Workspace trust intent is unavailable.");
      }

      let trust: WorkspaceTrustState;
      try {
        trust = await gateway.setTrust(intent.rootPath, intent.trusted);
      } catch (error) {
        const latest = this.desiredByOwner.get(ownerKey);
        if (latest && latest.revision !== intent.revision) {
          continue;
        }

        if (latest?.revision === intent.revision) {
          this.desiredByOwner.delete(ownerKey);
        }

        throw error;
      }

      const latest = this.desiredByOwner.get(ownerKey);
      if (latest && latest.revision !== intent.revision) {
        continue;
      }

      return { intent, trust };
    }
  }
}
