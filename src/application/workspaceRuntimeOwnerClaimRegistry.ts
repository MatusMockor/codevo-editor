import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

interface WorkspaceRuntimeOwnerClaim {
  aliases: string[];
  generation: number | null;
  owner: WorkspaceRuntimeOwner;
}

/**
 * Owns the alias and generation bookkeeping used to route asynchronous LSP
 * diagnostics back to the workspace runtime that started the session.
 */
export class WorkspaceRuntimeOwnerClaimRegistry {
  private readonly claimsByOwner = new Map<string, WorkspaceRuntimeOwnerClaim>();

  clear(): void {
    this.claimsByOwner.clear();
  }

  generationFor(ownerKey: string): number | null | undefined {
    return this.claimsByOwner.get(ownerKey)?.generation;
  }

  register(
    owner: WorkspaceRuntimeOwner,
    aliases: readonly string[],
    generation: number | null,
  ): void {
    const previous = this.claimsByOwner.get(owner.ownerKey);
    const candidates = [...(previous?.aliases ?? []), ...aliases, owner.executionRoot];
    this.claimsByOwner.set(owner.ownerKey, {
      aliases: candidates.filter(
        (alias, index) =>
          candidates.findIndex((candidate) => workspaceRootKeysEqual(candidate, alias)) === index,
      ),
      generation,
      owner,
    });
  }

  retire(ownerKey: string, expectedGeneration?: number | null): WorkspaceRuntimeOwner | null {
    const claim = this.claimsByOwner.get(ownerKey);
    if (!claim) return null;
    if (expectedGeneration !== undefined && claim.generation !== expectedGeneration) {
      return null;
    }

    this.claimsByOwner.delete(ownerKey);
    return claim.owner;
  }
}
