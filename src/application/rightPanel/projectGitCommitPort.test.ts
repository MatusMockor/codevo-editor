import { describe, expect, it } from "vitest";
import type { GitChangedFile, GitStatus } from "../../domain/git";
import type { GitAmendCandidate, GitWorkingTreeGateway } from "../../domain/gitWorkingTree";
import {
  AMEND_FOLDER_ROW_MESSAGE,
  AMEND_UNAVAILABLE_REASONS,
  projectGitCommitPort,
  type ProjectGitCommitGateway,
} from "./projectGitCommitPort";

const HEAD = "a".repeat(40);
const TARGET = { repositoryRoot: "/r", worktreePath: null };

function amender(candidate: GitAmendCandidate, calls: string[]) {
  const gateway: Pick<GitWorkingTreeGateway, "getAmendCandidate" | "amendHead"> = {
    getAmendCandidate: async (target) => {
      calls.push(`candidate:${target.repositoryRoot}`);
      return candidate;
    },
    amendHead: async (request) => {
      calls.push(
        `amend:${request.repositoryRoot}:${request.expectedHead}:${request.message}:${request.files.map((file) => `${file.relativePath}=${file.action}`).join(",")}`,
      );
      return { headSha: "b".repeat(40), indexSynced: true };
    },
  };
  return { gateway, target: TARGET };
}

function change(relativePath: string, isStaged = false): GitChangedFile {
  return {
    isStaged,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: `/r/${relativePath}`,
    relativePath,
    status: "modified",
  };
}

function gateway(changes: GitChangedFile[]) {
  const calls: string[] = [];
  const status = (): GitStatus => ({ branch: "main", changes, isRepository: true, rootPath: "/r" });
  const git: ProjectGitCommitGateway = {
    getStatus: async () => status(),
    stageFiles: async (_root, files) => {
      calls.push(`stage:${files.map((file) => file.relativePath).join(",")}`);
      return status();
    },
    commit: async (_root, message, files) => {
      calls.push(`commit:${message}:${files.map((file) => file.relativePath).join(",")}`);
      return status();
    },
    push: async () => {
      calls.push("push");
      return status();
    },
  };
  return { calls, git };
}

describe("projectGitCommitPort", () => {
  it("stages only unstaged selected files, commits them and pushes on request", async () => {
    const fake = gateway([change("a.ts"), change("b.ts", true), change("c.ts")]);
    const port = projectGitCommitPort(fake.git, "/r", null);

    await expect(
      port.commitAndPush("msg", { kind: "paths", relativePaths: ["a.ts", "b.ts"] }),
    ).resolves.toEqual({ kind: "pushed" });
    expect(fake.calls).toEqual(["stage:a.ts", "commit:msg:a.ts,b.ts", "push"]);
  });

  it("returns a failure for stale or empty selections without committing", async () => {
    const fake = gateway([change("a.ts")]);
    const port = projectGitCommitPort(fake.git, "/r", null);
    await expect(
      port.commit("m", { kind: "paths", relativePaths: ["a.ts", "x.ts"] }),
    ).resolves.toEqual({
      kind: "failed",
      message: "The change list changed. Review the selection and commit again.",
    });
    await expect(
      projectGitCommitPort(gateway([]).git, "/r", null).commit("m", { kind: "all" }),
    ).resolves.toEqual({
      kind: "failed",
      message: "Nothing to commit.",
    });
    expect(fake.calls).toEqual([]);
  });

  it("rejects an empty or oversized message before reading the status", async () => {
    const fake = gateway([change("a.ts")]);
    const reads: string[] = [];
    const port = projectGitCommitPort(
      {
        ...fake.git,
        getStatus: async (root) => {
          reads.push(root);
          return fake.git.getStatus(root);
        },
      },
      "/r",
      null,
    );
    await expect(port.commit("   ", { kind: "all" })).resolves.toMatchObject({ kind: "failed" });
    await expect(port.commit("x".repeat(5_000), { kind: "all" })).resolves.toMatchObject({
      kind: "failed",
    });
    expect(reads).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("reports a gateway error as a failure", async () => {
    const fake = gateway([change("a.ts")]);
    const port = projectGitCommitPort(
      { ...fake.git, commit: () => Promise.reject(new Error("hook rejected")) },
      "/r",
      null,
    );
    await expect(port.commit("m", { kind: "all" })).resolves.toEqual({
      kind: "failed",
      message: "hook rejected",
    });
  });

  it("reports a push failure after a successful commit truthfully", async () => {
    const fake = gateway([change("a.ts")]);
    const port = projectGitCommitPort(
      { ...fake.git, push: () => Promise.reject(new Error("no upstream")) },
      "/r",
      null,
    );
    await expect(port.commitAndPush("m", { kind: "all" })).resolves.toEqual({
      kind: "pushFailed",
      message: "Committed, but the push failed: no upstream",
    });
    expect(fake.calls).toEqual(["stage:a.ts", "commit:m:a.ts"]);
  });

  it("offers the last commit message for amend and explains every unavailable state", async () => {
    const fake = gateway([]);
    const ready = projectGitCommitPort(
      fake.git,
      "/r",
      amender({ kind: "ready", headSha: HEAD, message: "feat: first" }, fake.calls),
    );
    await expect(ready.amendCandidate()).resolves.toEqual({
      kind: "ready",
      headSha: HEAD,
      message: "feat: first",
    });
    const reasons = await Promise.all(
      (
        [
          { kind: "noCommit" },
          { kind: "pushed", headSha: HEAD },
          { kind: "messageTooLarge", headSha: HEAD },
          { kind: "operationInProgress" },
        ] as const
      ).map((candidate) =>
        projectGitCommitPort(fake.git, "/r", amender(candidate, fake.calls)).amendCandidate(),
      ),
    );
    expect(reasons).toEqual([
      { kind: "unavailable", reason: AMEND_UNAVAILABLE_REASONS.noCommit },
      { kind: "unavailable", reason: AMEND_UNAVAILABLE_REASONS.pushed },
      { kind: "unavailable", reason: AMEND_UNAVAILABLE_REASONS.messageTooLarge },
      { kind: "unavailable", reason: AMEND_UNAVAILABLE_REASONS.operationInProgress },
    ]);
    await expect(projectGitCommitPort(fake.git, "/r", null).amendCandidate()).resolves.toEqual({
      kind: "unavailable",
      reason: AMEND_UNAVAILABLE_REASONS.unsupported,
    });
  });

  it("amends exactly the head the user saw without staging anything first", async () => {
    const fake = gateway([
      change("a.ts"),
      change("b.ts", true),
      change("c.ts"),
      { ...change("new.ts", true), status: "renamed", oldRelativePath: "old.ts" },
    ]);
    const port = projectGitCommitPort(
      fake.git,
      "/r",
      amender({ kind: "ready", headSha: HEAD, message: "m" }, fake.calls),
    );

    await expect(
      port.amend(HEAD, " feat: amended ", {
        kind: "paths",
        relativePaths: ["a.ts", "b.ts", "new.ts"],
      }),
    ).resolves.toEqual({ kind: "amended" });

    expect(fake.calls).toEqual([
      `amend:/r:${HEAD}:feat: amended:a.ts=stageWorktree,b.ts=stageWorktree,new.ts=stageWorktree,old.ts=stageDeletion`,
    ]);
  });

  it("amends only the message when no file is included", async () => {
    const fake = gateway([change("a.ts")]);
    const port = projectGitCommitPort(
      fake.git,
      "/r",
      amender({ kind: "ready", headSha: HEAD, message: "m" }, fake.calls),
    );
    await expect(
      port.amend(HEAD, "reworded", { kind: "paths", relativePaths: [] }),
    ).resolves.toEqual({ kind: "amended" });
    expect(fake.calls).toEqual([`amend:/r:${HEAD}:reworded:`]);
  });

  it("refuses to amend with an empty message, a stale selection or no amender", async () => {
    const fake = gateway([change("a.ts")]);
    const port = projectGitCommitPort(
      fake.git,
      "/r",
      amender({ kind: "ready", headSha: HEAD, message: "m" }, fake.calls),
    );
    await expect(port.amend(HEAD, "  ", { kind: "all" })).resolves.toMatchObject({
      kind: "failed",
    });
    await expect(
      port.amend(HEAD, "m", { kind: "paths", relativePaths: ["gone.ts"] }),
    ).resolves.toEqual({
      kind: "failed",
      message: "The change list changed. Review the selection and commit again.",
    });
    await expect(
      projectGitCommitPort(fake.git, "/r", null).amend(HEAD, "m", { kind: "all" }),
    ).resolves.toEqual({ kind: "failed", message: AMEND_UNAVAILABLE_REASONS.unsupported });
    expect(fake.calls).toEqual([]);
  });

  it("reports an amend whose index update failed as its own outcome", async () => {
    const fake = gateway([]);
    const port = projectGitCommitPort(fake.git, "/r", {
      target: TARGET,
      gateway: {
        getAmendCandidate: async () => ({ kind: "noCommit" }),
        amendHead: async () => ({ headSha: "b".repeat(40), indexSynced: false }),
      },
    });
    await expect(port.amend(HEAD, "m", { kind: "all" })).resolves.toEqual({
      kind: "amendedIndexStale",
    });
  });

  it("reports an amend rejected by the backend as a failure", async () => {
    const fake = gateway([]);
    const port = projectGitCommitPort(fake.git, "/r", {
      target: TARGET,
      gateway: {
        getAmendCandidate: async () => ({ kind: "noCommit" }),
        amendHead: () => Promise.reject(new Error("The last commit changed.")),
      },
    });
    await expect(port.amend(HEAD, "m", { kind: "all" })).resolves.toEqual({
      kind: "failed",
      message: "The last commit changed.",
    });
  });

  it("amends a staged deletion as a deletion even when the file is back on disk", async () => {
    const deleted = { ...change("secrets.env", true), status: "deleted" as const };
    const untracked = {
      ...change("secrets.env"),
      isUnversioned: true,
      status: "untracked" as const,
    };
    const fake = gateway([deleted, untracked]);
    const port = projectGitCommitPort(
      fake.git,
      "/r",
      amender({ kind: "ready", headSha: HEAD, message: "m" }, fake.calls),
    );

    await expect(
      port.amend(HEAD, "drop secrets", { kind: "rows", rowKeys: ["tracked:secrets.env"] }),
    ).resolves.toEqual({ kind: "amended" });

    expect(fake.calls).toEqual([`amend:/r:${HEAD}:drop secrets:secrets.env=stageDeletion`]);
  });

  it("refuses to amend with a nested repository or folder row included", async () => {
    const nested = { ...change("vendor/lib/"), isUnversioned: true, status: "untracked" as const };
    const fake = gateway([change("a.ts"), nested]);
    const port = projectGitCommitPort(
      fake.git,
      "/r",
      amender({ kind: "ready", headSha: HEAD, message: "m" }, fake.calls),
    );

    await expect(port.amend(HEAD, "m", { kind: "all" })).resolves.toEqual({
      kind: "failed",
      message: AMEND_FOLDER_ROW_MESSAGE,
    });
    expect(fake.calls).toEqual([]);
  });
});
