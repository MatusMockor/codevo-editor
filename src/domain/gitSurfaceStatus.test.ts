import { describe, expect, it } from "vitest";
import wireContract from "../../contracts/git-surface-wire.json";
import { parseGitSurfaceStatus } from "./gitSurfaceStatus";

const commit = {
  sha: "a".repeat(40),
  shortSha: "aaaaaaa",
  subject: "test: cover retry",
  authoredAtEpochSeconds: 1_700_000_000,
};

const wire = {
  branch: "feat/x",
  defaultBase: "main",
  hasRemote: true,
  upstream: { name: "origin/feat/x", ahead: 2, behind: 0 },
  unpushed: [commit],
  unpushedTruncated: false,
  lineStats: [{ relativePath: "src/a.ts", added: 3, deleted: null }],
  lineStatsTruncated: false,
  localBranches: ["feat/x", "main"],
  remoteBranches: ["origin/main"],
  worktreeBranches: ["fix/payments"],
  branchesTruncated: false,
};

describe("parseGitSurfaceStatus", () => {
  it("parses the Rust wire shape", () => {
    expect(parseGitSurfaceStatus(wire)).toEqual(wire);
  });

  it("rejects unknown keys, bad shas and oversized lists", () => {
    expect(() => parseGitSurfaceStatus({ ...wire, extra: 1 })).toThrow();
    expect(() =>
      parseGitSurfaceStatus({ ...wire, unpushed: [{ ...commit, sha: "zz" }] }),
    ).toThrow();
    expect(() =>
      parseGitSurfaceStatus({
        ...wire,
        localBranches: Array.from({ length: 201 }, (_, index) => `b${index}`),
      }),
    ).toThrow();
  });

  it("rejects escaping line stat paths and malformed upstreams", () => {
    expect(() =>
      parseGitSurfaceStatus({
        ...wire,
        lineStats: [{ relativePath: "../x", added: 1, deleted: 1 }],
      }),
    ).toThrow();
    expect(() =>
      parseGitSurfaceStatus({ ...wire, upstream: { name: "origin/x", ahead: -1, behind: 0 } }),
    ).toThrow();
  });
});

describe("git surface status timestamps", () => {
  it("accepts pre-1970 and extreme safe-integer authored dates", () => {
    for (const authoredAtEpochSeconds of [
      -86_400,
      Number.MIN_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
    ]) {
      const parsed = parseGitSurfaceStatus({
        ...wire,
        unpushed: [{ ...commit, authoredAtEpochSeconds }],
      });
      expect(parsed.unpushed[0]?.authoredAtEpochSeconds).toBe(authoredAtEpochSeconds);
    }
  });

  it("rejects unsafe or fractional authored dates", () => {
    for (const authoredAtEpochSeconds of [Number.MAX_SAFE_INTEGER + 1, -Infinity, 1.5, "1"]) {
      expect(() =>
        parseGitSurfaceStatus({ ...wire, unpushed: [{ ...commit, authoredAtEpochSeconds }] }),
      ).toThrow();
    }
  });
});

describe("git surface status shared wire contract", () => {
  it("parses the Rust-serialized status fixture exactly", () => {
    const status = parseGitSurfaceStatus(wireContract.gitSurfaceStatus);
    expect(status).toEqual(wireContract.gitSurfaceStatus);
    expect(Object.keys(status).sort()).toEqual(Object.keys(wireContract.gitSurfaceStatus).sort());
    expect(status.lineStatsTruncated).toBe(true);
    expect(status.unpushed[0]?.authoredAtEpochSeconds).toBe(-86_400);
  });

  it("rejects unknown fields on the fixture", () => {
    expect(() => parseGitSurfaceStatus({ ...wireContract.gitSurfaceStatus, extra: 1 })).toThrow();
    const [firstCommit] = wireContract.gitSurfaceStatus.unpushed;
    expect(() =>
      parseGitSurfaceStatus({
        ...wireContract.gitSurfaceStatus,
        unpushed: [{ ...firstCommit, extra: 1 }],
      }),
    ).toThrow();
  });
});
