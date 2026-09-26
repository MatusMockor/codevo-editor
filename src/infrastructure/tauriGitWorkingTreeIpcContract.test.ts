import { describe, expect, it } from "vitest";
import wireContract from "../../contracts/git-working-tree-wire.json";
import {
  AMEND_GIT_HEAD_IPC_COMMAND,
  DISCARD_GIT_FILE_IPC_COMMAND,
  GET_GIT_AMEND_CANDIDATE_IPC_COMMAND,
  PREPARE_GIT_DISCARD_IPC_COMMAND,
  invokeAmendGitHeadIpc,
  invokeDiscardGitFileIpc,
  invokeGetGitAmendCandidateIpc,
  invokePrepareGitDiscardIpc,
} from "./tauriGitWorkingTreeIpcContract";

type Call = { readonly command: string; readonly args: unknown };

function recorder(response: unknown) {
  const calls: Call[] = [];
  const invoke = async (command: string, args: Readonly<Record<string, unknown>>) => {
    calls.push({ command, args });
    return response;
  };
  return { calls, invoke };
}

describe("git working tree IPC contract", () => {
  it("reads the amend candidate for exactly the validated target", async () => {
    const fake = recorder(wireContract.amendCandidates.ready);
    const extended = { repositoryRoot: "/repo", worktreePath: null, shell: "rm -rf /" };
    await expect(invokeGetGitAmendCandidateIpc(fake.invoke, extended)).resolves.toEqual(
      wireContract.amendCandidates.ready,
    );
    expect(fake.calls).toEqual([
      {
        command: GET_GIT_AMEND_CANDIDATE_IPC_COMMAND,
        args: { request: { repositoryRoot: "/repo", worktreePath: null } },
      },
    ]);
  });

  it("sends the amend request in the shared contract shape and parses the receipt", async () => {
    const fake = recorder(wireContract.amendReceipt);
    const request = wireContract.amendRequest.request;
    await expect(
      invokeAmendGitHeadIpc(fake.invoke, { ...request, force: true } as never),
    ).resolves.toEqual(wireContract.amendReceipt);
    expect(fake.calls).toEqual([
      { command: AMEND_GIT_HEAD_IPC_COMMAND, args: wireContract.amendRequest },
    ]);
  });

  it("sends the discard request in the shared contract shape and parses the receipt", async () => {
    const fake = recorder(wireContract.discardReceipts.restored);
    const request = wireContract.discardRequest.request;
    await expect(
      invokeDiscardGitFileIpc(fake.invoke, {
        ...request,
        file: { ...request.file, expectedStatus: "renamed", clean: "-fdx" },
      } as never),
    ).resolves.toEqual(wireContract.discardReceipts.restored);
    expect(fake.calls).toEqual([
      { command: DISCARD_GIT_FILE_IPC_COMMAND, args: wireContract.discardRequest },
    ]);
  });

  it("prepares a discard in the shared contract shape and parses the fingerprint", async () => {
    const fake = recorder(wireContract.discardPreparation);
    const request = wireContract.prepareDiscardRequest.request;
    await expect(
      invokePrepareGitDiscardIpc(fake.invoke, {
        ...request,
        file: { ...request.file, expectedStatus: "untracked" },
        fingerprint: "ignored",
      } as never),
    ).resolves.toEqual(wireContract.discardPreparation);
    expect(fake.calls).toEqual([
      { command: PREPARE_GIT_DISCARD_IPC_COMMAND, args: wireContract.prepareDiscardRequest },
    ]);
  });

  it("rejects invalid requests before invoking the backend", async () => {
    const fake = recorder(wireContract.discardReceipts.deleted);
    const target = { repositoryRoot: "/repo", worktreePath: null };
    const file = { relativePath: "a.ts", oldRelativePath: null, expectedStatus: "modified" };
    const fingerprint = "ab".repeat(32);
    const invalid = [
      { ...target, fingerprint: "not hex", file },
      { ...target, fingerprint, file: { ...file, relativePath: "../escape.ts" } },
      { ...target, fingerprint, file: { ...file, relativePath: "/etc/passwd" } },
      { ...target, fingerprint, file: { ...file, expectedStatus: "ignored" } },
      { ...target, fingerprint, repositoryRoot: "relative/root", file },
    ];
    for (const request of invalid) {
      await expect(invokeDiscardGitFileIpc(fake.invoke, request as never)).rejects.toThrow();
    }
    await expect(
      invokeAmendGitHeadIpc(fake.invoke, {
        ...target,
        expectedHead: "HEAD",
        message: "m",
        files: [],
      }),
    ).rejects.toThrow();
    await expect(
      invokeAmendGitHeadIpc(fake.invoke, {
        ...target,
        expectedHead: "a".repeat(40),
        message: "x".repeat(4_097),
        files: [],
      }),
    ).rejects.toThrow();
    await expect(
      invokeAmendGitHeadIpc(fake.invoke, {
        ...target,
        expectedHead: "a".repeat(40),
        message: "m",
        files: [{ relativePath: "a.ts", action: "stageEverything" }],
      } as never),
    ).rejects.toThrow();
    expect(fake.calls).toEqual([]);
  });

  it("rejects malformed backend responses", async () => {
    await expect(
      invokeGetGitAmendCandidateIpc(recorder({ kind: "ready" }).invoke, {
        repositoryRoot: "/repo",
        worktreePath: null,
      }),
    ).rejects.toThrow();
  });
});
