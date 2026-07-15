import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import type { DocumentSaveResult } from "./documentSaveService";

export interface CapturedDirtyCloseTarget<TIdentity> {
  readonly owner: WorkspaceRuntimeOwner;
  readonly targetId: string;
  readonly identity: TIdentity;
}

export type DirtyCloseTargetState =
  | { readonly status: "current"; readonly clean: boolean }
  | { readonly status: "stale" };

export interface DirtyCloseSaveTransactionPorts<TIdentity, TCommitResult> {
  saveTarget(
    target: CapturedDirtyCloseTarget<TIdentity>,
  ): Promise<DocumentSaveResult>;
  isOwnerCurrent(owner: WorkspaceRuntimeOwner): boolean | Promise<boolean>;
  revalidateTarget(
    target: CapturedDirtyCloseTarget<TIdentity>,
  ): DirtyCloseTargetState | Promise<DirtyCloseTargetState>;
  /**
   * Atomically revalidates the captured scope while acquiring the close
   * exclusion, then performs the close mutation. A stale scope must be
   * rejected without mutating editor state.
   */
  commitCloseConditionally(
    targets: readonly CapturedDirtyCloseTarget<TIdentity>[],
  ):
    | DirtyCloseConditionalCommitResult<TIdentity, TCommitResult>
    | Promise<DirtyCloseConditionalCommitResult<TIdentity, TCommitResult>>;
}

export type DirtyCloseSaveBlockedResult<TIdentity> = {
  readonly status: "blocked";
  readonly target: CapturedDirtyCloseTarget<TIdentity>;
  readonly saveResult: Exclude<
    DocumentSaveResult,
    { readonly status: "saved" | "stale" }
  >;
};

export type DirtyCloseSaveStaleReason =
  | "owner-replaced"
  | "target-replaced"
  | "newer-edit"
  | "save-stale";

export type DirtyCloseSaveStaleResult<TIdentity> = {
  readonly status: "stale";
  readonly target: CapturedDirtyCloseTarget<TIdentity>;
  readonly reason: DirtyCloseSaveStaleReason;
};

export type DirtyCloseConditionalCommitResult<TIdentity, TCommitResult> =
  | { readonly status: "committed"; readonly result: TCommitResult }
  | DirtyCloseSaveStaleResult<TIdentity>;

export type DirtyCloseSaveTransactionResult<TIdentity, TCommitResult> =
  | { readonly status: "closed"; readonly result: TCommitResult }
  | DirtyCloseSaveBlockedResult<TIdentity>
  | DirtyCloseSaveStaleResult<TIdentity>;

export interface DirtyCloseSaveTransactionRequest<TIdentity> {
  readonly targets: readonly CapturedDirtyCloseTarget<TIdentity>[];
}

/**
 * Saves a captured close scope before allowing its caller to acquire an
 * exclusion or mutate editor state. The injected ports keep active and cached
 * workspace repositories behind the same owner-fenced protocol. The final
 * conditional commit closes the race between post-save validation and close.
 */
export class DirtyCloseSaveTransaction<TIdentity, TCommitResult = void> {
  constructor(
    private readonly ports: DirtyCloseSaveTransactionPorts<
      TIdentity,
      TCommitResult
    >,
  ) {}

  async execute(
    request: DirtyCloseSaveTransactionRequest<TIdentity>,
  ): Promise<DirtyCloseSaveTransactionResult<TIdentity, TCommitResult>> {
    const targets = [...request.targets];

    for (const target of targets) {
      const ownerFailure = await this.ownerFailure(target);
      if (ownerFailure) {
        return ownerFailure;
      }

      const targetFailure = await this.targetFailure(target, false);
      if (targetFailure) {
        return targetFailure;
      }

      const saveResult = await this.save(target);
      const saveFailure = this.saveFailure(target, saveResult);
      if (saveFailure) {
        return saveFailure;
      }
    }

    for (const target of targets) {
      const ownerFailure = await this.ownerFailure(target);
      if (ownerFailure) {
        return ownerFailure;
      }

      const targetFailure = await this.targetFailure(target, true);
      if (targetFailure) {
        return targetFailure;
      }
    }

    const commitResult = await this.ports.commitCloseConditionally(targets);
    if (commitResult.status === "stale") {
      return commitResult;
    }

    return { status: "closed", result: commitResult.result };
  }

  private async ownerFailure(
    target: CapturedDirtyCloseTarget<TIdentity>,
  ): Promise<DirtyCloseSaveTransactionResult<TIdentity, TCommitResult> | null> {
    if (await this.ports.isOwnerCurrent(target.owner)) {
      return null;
    }

    return {
      status: "stale",
      target,
      reason: "owner-replaced",
    };
  }

  private async targetFailure(
    target: CapturedDirtyCloseTarget<TIdentity>,
    requireClean: boolean,
  ): Promise<DirtyCloseSaveTransactionResult<TIdentity, TCommitResult> | null> {
    const state = await this.ports.revalidateTarget(target);
    if (state.status === "stale") {
      return {
        status: "stale",
        target,
        reason: "target-replaced",
      };
    }
    if (!requireClean || state.clean) {
      return null;
    }

    return {
      status: "stale",
      target,
      reason: "newer-edit",
    };
  }

  private async save(
    target: CapturedDirtyCloseTarget<TIdentity>,
  ): Promise<DocumentSaveResult> {
    try {
      return await this.ports.saveTarget(target);
    } catch (error) {
      return { status: "failed", error };
    }
  }

  private saveFailure(
    target: CapturedDirtyCloseTarget<TIdentity>,
    saveResult: DocumentSaveResult,
  ): DirtyCloseSaveTransactionResult<TIdentity, TCommitResult> | null {
    if (saveResult.status === "saved" && saveResult.contentIsCurrent) {
      return null;
    }
    if (saveResult.status === "saved") {
      return {
        status: "stale",
        target,
        reason: "newer-edit",
      };
    }
    if (saveResult.status === "stale") {
      return {
        status: "stale",
        target,
        reason: "save-stale",
      };
    }

    return {
      status: "blocked",
      target,
      saveResult,
    };
  }
}
