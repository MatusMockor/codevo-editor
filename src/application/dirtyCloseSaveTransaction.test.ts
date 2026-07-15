import { describe, expect, it, vi } from "vitest";
import type { EditorDocument } from "../domain/workspace";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import type { DocumentSaveResult } from "./documentSaveService";
import {
  DirtyCloseSaveTransaction,
  type CapturedDirtyCloseTarget,
  type DirtyCloseConditionalCommitResult,
  type DirtyCloseSaveTransactionPorts,
  type DirtyCloseTargetState,
} from "./dirtyCloseSaveTransaction";

interface TargetIdentity {
  readonly path: string;
  readonly revision: number;
}

const ownerA = createWorkspaceRuntimeOwner("workspace-a", "/workspace-a");
const ownerB = createWorkspaceRuntimeOwner("workspace-b", "/workspace-b");

const targetA: CapturedDirtyCloseTarget<TargetIdentity> = {
  owner: ownerA,
  targetId: "workspace-a:src/a.php:1",
  identity: { path: "src/a.php", revision: 1 },
};

const targetB: CapturedDirtyCloseTarget<TargetIdentity> = {
  owner: ownerB,
  targetId: "workspace-b:src/b.php:3",
  identity: { path: "src/b.php", revision: 3 },
};

function document(path: string): EditorDocument {
  return {
    path,
    name: path.split("/").pop() ?? path,
    content: "saved",
    savedContent: "saved",
    language: "php",
    revision: null,
  };
}

function saved(path: string, contentIsCurrent = true): DocumentSaveResult {
  return {
    status: "saved",
    document: document(path),
    contentIsCurrent,
  };
}

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

function harness(overrides: {
  saveTarget?: DirtyCloseSaveTransactionPorts<
    TargetIdentity,
    string
  >["saveTarget"];
  isOwnerCurrent?: DirtyCloseSaveTransactionPorts<
    TargetIdentity,
    string
  >["isOwnerCurrent"];
  revalidateTarget?: DirtyCloseSaveTransactionPorts<
    TargetIdentity,
    string
  >["revalidateTarget"];
  commitCloseConditionally?: DirtyCloseSaveTransactionPorts<
    TargetIdentity,
    string
  >["commitCloseConditionally"];
} = {}) {
  const calls: string[] = [];
  const targetValidationCounts = new Map<string, number>();
  const saveTarget = vi.fn(
    overrides.saveTarget ??
      (async (target: CapturedDirtyCloseTarget<TargetIdentity>) => {
        calls.push(`save:${target.targetId}`);
        return saved(target.identity.path);
      }),
  );
  const isOwnerCurrent = vi.fn(
    overrides.isOwnerCurrent ??
      ((owner) => {
        calls.push(`owner:${owner.ownerKey}`);
        return true;
      }),
  );
  const revalidateTarget = vi.fn(
    overrides.revalidateTarget ??
      ((target) => {
        calls.push(`target:${target.targetId}`);
        const count = (targetValidationCounts.get(target.targetId) ?? 0) + 1;
        targetValidationCounts.set(target.targetId, count);
        return { status: "current", clean: count > 1 } as const;
      }),
  );
  const commitCloseConditionally = vi.fn(
    overrides.commitCloseConditionally ??
      ((targets: readonly CapturedDirtyCloseTarget<TargetIdentity>[]) => {
        calls.push(`commit:${targets.map((target) => target.targetId).join(",")}`);
        return { status: "committed", result: "committed" } as const;
      }),
  );
  const transaction = new DirtyCloseSaveTransaction({
    saveTarget,
    isOwnerCurrent,
    revalidateTarget,
    commitCloseConditionally,
  });

  return {
    calls,
    commitCloseConditionally,
    isOwnerCurrent,
    revalidateTarget,
    saveTarget,
    transaction,
  };
}

describe("DirtyCloseSaveTransaction", () => {
  it("saves every captured owner target before committing the close", async () => {
    const subject = harness();

    await expect(
      subject.transaction.execute({ targets: [targetA, targetB] }),
    ).resolves.toEqual({ status: "closed", result: "committed" });

    expect(subject.saveTarget).toHaveBeenNthCalledWith(1, targetA);
    expect(subject.saveTarget).toHaveBeenNthCalledWith(2, targetB);
    const commitCall = `commit:${targetA.targetId},${targetB.targetId}`;
    expect(subject.calls.indexOf(commitCall)).toBeGreaterThan(
      subject.calls.indexOf(`save:${targetB.targetId}`),
    );
    expect(subject.calls.indexOf(commitCall)).toBeGreaterThan(
      subject.calls.lastIndexOf(`target:${targetB.targetId}`),
    );
    expect(subject.commitCloseConditionally).toHaveBeenCalledWith([
      targetA,
      targetB,
    ]);
  });

  it("uses the captured owner directly without an activation port", async () => {
    const subject = harness();

    await subject.transaction.execute({ targets: [targetB] });

    expect(subject.saveTarget).toHaveBeenCalledWith(targetB);
    expect(targetB.owner).toBe(ownerB);
  });

  it("allows a current dirty target before save and requires it clean after", async () => {
    let validation = 0;
    const subject = harness({
      revalidateTarget: () => ({
        status: "current",
        clean: ++validation > 1,
      }),
    });

    await expect(
      subject.transaction.execute({ targets: [targetA] }),
    ).resolves.toEqual({ status: "closed", result: "committed" });

    expect(subject.revalidateTarget).toHaveBeenCalledTimes(2);
  });

  it.each<DocumentSaveResult>([
    { status: "blocked", reason: "external" },
    { status: "conflict", document: document("a.php"), snapshot: null },
    { status: "partial", error: new Error("partial") },
    { status: "failed", error: new Error("failed") },
  ])("blocks close for save result $status", async (saveResult) => {
    const subject = harness({ saveTarget: async () => saveResult });

    const result = await subject.transaction.execute({ targets: [targetA] });

    expect(result).toEqual({ status: "blocked", target: targetA, saveResult });
    expect(subject.commitCloseConditionally).not.toHaveBeenCalled();
  });

  it("returns stale when the save lease is stale", async () => {
    const subject = harness({
      saveTarget: async () => ({ status: "stale" }),
    });

    await expect(
      subject.transaction.execute({ targets: [targetA] }),
    ).resolves.toEqual({
      status: "stale",
      target: targetA,
      reason: "save-stale",
    });
    expect(subject.commitCloseConditionally).not.toHaveBeenCalled();
  });

  it("returns stale when a newer edit arrives during save", async () => {
    const subject = harness({
      saveTarget: async () => saved(targetA.identity.path, false),
    });

    await expect(
      subject.transaction.execute({ targets: [targetA] }),
    ).resolves.toEqual({
      status: "stale",
      target: targetA,
      reason: "newer-edit",
    });
    expect(subject.commitCloseConditionally).not.toHaveBeenCalled();
  });

  it("blocks close when the save strategy throws", async () => {
    const error = new Error("write failed");
    const subject = harness({
      saveTarget: async () => {
        throw error;
      },
    });

    await expect(
      subject.transaction.execute({ targets: [targetA] }),
    ).resolves.toEqual({
      status: "blocked",
      target: targetA,
      saveResult: { status: "failed", error },
    });
    expect(subject.commitCloseConditionally).not.toHaveBeenCalled();
  });

  it("aborts before saving when the captured owner was replaced", async () => {
    const subject = harness({ isOwnerCurrent: () => false });

    await expect(
      subject.transaction.execute({ targets: [targetA] }),
    ).resolves.toEqual({
      status: "stale",
      target: targetA,
      reason: "owner-replaced",
    });
    expect(subject.saveTarget).not.toHaveBeenCalled();
    expect(subject.commitCloseConditionally).not.toHaveBeenCalled();
  });

  it("aborts when the captured target incarnation was replaced", async () => {
    const subject = harness({
      revalidateTarget: () => ({ status: "stale" }),
    });

    await expect(
      subject.transaction.execute({ targets: [targetA] }),
    ).resolves.toEqual({
      status: "stale",
      target: targetA,
      reason: "target-replaced",
    });
    expect(subject.saveTarget).not.toHaveBeenCalled();
    expect(subject.commitCloseConditionally).not.toHaveBeenCalled();
  });

  it("revalidates every owner and target after all saves", async () => {
    const targetStates = new Map<string, DirtyCloseTargetState>([
      [targetA.targetId, { status: "current", clean: true }],
      [targetB.targetId, { status: "current", clean: true }],
    ]);
    const subject = harness({
      revalidateTarget: (target) => targetStates.get(target.targetId)!,
      saveTarget: async (target) => {
        if (target === targetB) {
          targetStates.set(targetA.targetId, {
            status: "current",
            clean: false,
          });
        }
        return saved(target.identity.path);
      },
    });

    await expect(
      subject.transaction.execute({ targets: [targetA, targetB] }),
    ).resolves.toEqual({
      status: "stale",
      target: targetA,
      reason: "newer-edit",
    });
    expect(subject.saveTarget).toHaveBeenCalledTimes(2);
    expect(subject.commitCloseConditionally).not.toHaveBeenCalled();
  });

  it("rechecks owner replacement after asynchronous saves", async () => {
    let ownerIsCurrent = true;
    const subject = harness({
      isOwnerCurrent: () => ownerIsCurrent,
      saveTarget: async (target) => {
        ownerIsCurrent = false;
        return saved(target.identity.path);
      },
    });

    await expect(
      subject.transaction.execute({ targets: [targetA] }),
    ).resolves.toEqual({
      status: "stale",
      target: targetA,
      reason: "owner-replaced",
    });
    expect(subject.commitCloseConditionally).not.toHaveBeenCalled();
  });

  it("rejects owner replacement during the asynchronous conditional commit", async () => {
    const commitEntered = deferred();
    const releaseCommit = deferred();
    let ownerIsCurrent = true;
    const closeMutation = vi.fn();
    const subject = harness({
      commitCloseConditionally: async (
        targets,
      ): Promise<DirtyCloseConditionalCommitResult<TargetIdentity, string>> => {
        commitEntered.resolve();
        await releaseCommit.promise;
        if (!ownerIsCurrent) {
          return {
            status: "stale",
            target: targets[0],
            reason: "owner-replaced",
          };
        }

        closeMutation();
        return { status: "committed", result: "committed" };
      },
    });

    const execution = subject.transaction.execute({ targets: [targetA] });
    await commitEntered.promise;
    ownerIsCurrent = false;
    releaseCommit.resolve();

    await expect(execution).resolves.toEqual({
      status: "stale",
      target: targetA,
      reason: "owner-replaced",
    });
    expect(closeMutation).not.toHaveBeenCalled();
  });

  it("rejects a newer edit during the asynchronous conditional commit", async () => {
    const commitEntered = deferred();
    const releaseCommit = deferred();
    let targetIsClean = true;
    const closeMutation = vi.fn();
    const subject = harness({
      commitCloseConditionally: async (
        targets,
      ): Promise<DirtyCloseConditionalCommitResult<TargetIdentity, string>> => {
        commitEntered.resolve();
        await releaseCommit.promise;
        if (!targetIsClean) {
          return {
            status: "stale",
            target: targets[0],
            reason: "newer-edit",
          };
        }

        closeMutation();
        return { status: "committed", result: "committed" };
      },
    });

    const execution = subject.transaction.execute({ targets: [targetA] });
    await commitEntered.promise;
    targetIsClean = false;
    releaseCommit.resolve();

    await expect(execution).resolves.toEqual({
      status: "stale",
      target: targetA,
      reason: "newer-edit",
    });
    expect(closeMutation).not.toHaveBeenCalled();
  });

  it("commits an empty close scope without invoking save ports", async () => {
    const subject = harness();

    await expect(
      subject.transaction.execute({ targets: [] }),
    ).resolves.toEqual({ status: "closed", result: "committed" });

    expect(subject.saveTarget).not.toHaveBeenCalled();
    expect(subject.revalidateTarget).not.toHaveBeenCalled();
    expect(subject.commitCloseConditionally).toHaveBeenCalledOnce();
  });

  it("captures the target list before awaiting external ports", async () => {
    const mutableTargets = [targetA];
    const subject = harness({
      saveTarget: async (target) => {
        mutableTargets.push(targetB);
        return saved(target.identity.path);
      },
    });

    await subject.transaction.execute({ targets: mutableTargets });

    expect(subject.saveTarget).toHaveBeenCalledTimes(1);
    expect(subject.saveTarget).toHaveBeenCalledWith(targetA);
  });
});
