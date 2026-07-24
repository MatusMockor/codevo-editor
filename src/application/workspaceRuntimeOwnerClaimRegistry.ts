import type { LanguageServerDiagnosticEvent } from "../domain/languageServerDiagnostics";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { LanguageServerDiagnosticsRuntimeKind } from "./useLanguageServerDiagnosticsSubscriptions";

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

  resolveDiagnosticsEvent(
    event: LanguageServerDiagnosticEvent,
    runtimeKind: LanguageServerDiagnosticsRuntimeKind,
    phpRuntimeStatuses: Record<string, LanguageServerRuntimeStatus>,
    javaScriptTypeScriptRuntimeStatuses: Record<string, LanguageServerRuntimeStatus>,
  ): WorkspaceRuntimeOwner | null {
    const claims = [...this.claimsByOwner.values()].filter((claim) =>
      claim.aliases.some((alias) => workspaceRootKeysEqual(alias, event.rootPath)),
    );
    if (claims.length === 0) return null;

    const sessionMatches = claims.filter((claim) =>
      this.sessionIds(
        claim.owner,
        runtimeKind,
        phpRuntimeStatuses,
        javaScriptTypeScriptRuntimeStatuses,
      ).includes(event.sessionId),
    );
    if (sessionMatches.length === 1) return sessionMatches[0].owner;
    if (claims.length !== 1 || sessionMatches.length > 1) return null;

    const knownSessionIds = this.sessionIds(
      claims[0].owner,
      runtimeKind,
      phpRuntimeStatuses,
      javaScriptTypeScriptRuntimeStatuses,
    );
    return knownSessionIds.length === 0 ? claims[0].owner : null;
  }

  private sessionIds(
    owner: WorkspaceRuntimeOwner,
    runtimeKind: LanguageServerDiagnosticsRuntimeKind,
    phpRuntimeStatuses: Record<string, LanguageServerRuntimeStatus>,
    javaScriptTypeScriptRuntimeStatuses: Record<string, LanguageServerRuntimeStatus>,
  ): number[] {
    const status =
      runtimeKind === "php"
        ? phpRuntimeStatuses[owner.ownerKey]
        : javaScriptTypeScriptRuntimeStatuses[owner.ownerKey];
    if (!status || (status.kind !== "starting" && status.kind !== "running")) return [];
    return [status.sessionId];
  }
}
