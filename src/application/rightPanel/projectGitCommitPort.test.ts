import { describe, expect, it } from "vitest";
import type { GitChangedFile, GitStatus } from "../../domain/git";
import { projectGitCommitPort, type ProjectGitCommitGateway } from "./projectGitCommitPort";

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
    const port = projectGitCommitPort(fake.git, "/r");

    await expect(
      port.commitAndPush("msg", { kind: "paths", relativePaths: ["a.ts", "b.ts"] }),
    ).resolves.toEqual({ kind: "pushed" });
    expect(fake.calls).toEqual(["stage:a.ts", "commit:msg:a.ts,b.ts", "push"]);
  });

  it("returns a failure for stale or empty selections without committing", async () => {
    const fake = gateway([change("a.ts")]);
    const port = projectGitCommitPort(fake.git, "/r");
    await expect(
      port.commit("m", { kind: "paths", relativePaths: ["a.ts", "x.ts"] }),
    ).resolves.toEqual({
      kind: "failed",
      message: "The change list changed. Review the selection and commit again.",
    });
    await expect(
      projectGitCommitPort(gateway([]).git, "/r").commit("m", { kind: "all" }),
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
    );
    await expect(port.commitAndPush("m", { kind: "all" })).resolves.toEqual({
      kind: "pushFailed",
      message: "Committed, but the push failed: no upstream",
    });
    expect(fake.calls).toEqual(["stage:a.ts", "commit:m:a.ts"]);
  });
});
