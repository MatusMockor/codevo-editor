import { describe, expect, it } from "vitest";
import {
  MAX_WORKTREES_PER_REPOSITORY,
  MAX_WORKTREE_BRANCH_BYTES,
  MAX_WORKTREE_PATH_BYTES,
  parseAgentWorktreeReceipt,
  parseGitWorktreeDescriptor,
  parseGitWorktreeDescriptors,
  validateAgentWorktreeTaskId,
  validateGitWorktreePath,
  WORKTREE_BASE_DIR_NAME,
} from "./gitWorktree";

const descriptor = {
  worktreePath: "/repository/.worktrees/agt-1",
  branch: "agent/agt-1",
  head: "0123456789abcdef",
  isPrimary: false,
  locked: false,
  prunable: false,
};

describe("Git worktree domain", () => {
  it("keeps the pinned worktree limits and base directory", () => {
    expect(MAX_WORKTREES_PER_REPOSITORY).toBe(16);
    expect(MAX_WORKTREE_PATH_BYTES).toBe(4_096);
    expect(MAX_WORKTREE_BRANCH_BYTES).toBe(512);
    expect(WORKTREE_BASE_DIR_NAME).toBe(".worktrees");
  });

  it("parses exact descriptors including detached null fields", () => {
    expect(parseGitWorktreeDescriptor(descriptor)).toEqual(descriptor);
    expect(parseGitWorktreeDescriptor({ ...descriptor, branch: null, head: null })).toEqual({
      ...descriptor,
      branch: null,
      head: null,
    });
  });

  it.each([
    null,
    { ...descriptor, extra: true },
    { ...descriptor, locked: 0 },
    { ...descriptor, branch: "" },
    { ...descriptor, head: undefined },
  ])("rejects malformed descriptor %# fail-closed", (value) => {
    expect(() => parseGitWorktreeDescriptor(value)).toThrow(TypeError);
  });

  it("enforces path and branch limits by UTF-8 bytes", () => {
    const validPath = `/${"🙂".repeat((MAX_WORKTREE_PATH_BYTES - 1) / 4)}`;
    const invalidPath = `/${"🙂".repeat((MAX_WORKTREE_PATH_BYTES - 1) / 4 + 1)}`;
    const validBranch = "🙂".repeat(MAX_WORKTREE_BRANCH_BYTES / 4);
    const invalidBranch = `${validBranch}🙂`;
    expect(validateGitWorktreePath(validPath)).toBe(validPath);
    expect(() => validateGitWorktreePath(invalidPath)).toThrow(TypeError);
    expect(parseGitWorktreeDescriptor({ ...descriptor, branch: validBranch }).branch).toBe(
      validBranch,
    );
    expect(() => parseGitWorktreeDescriptor({ ...descriptor, branch: invalidBranch })).toThrow(
      TypeError,
    );
  });

  it("clips oversized descriptor lists and labels the truncation", () => {
    const worktrees = Array.from({ length: MAX_WORKTREES_PER_REPOSITORY + 1 }, (_, index) => ({
      ...descriptor,
      worktreePath: `/repository/.worktrees/agt-${index}`,
    }));
    expect(parseGitWorktreeDescriptors(worktrees)).toEqual({
      worktrees: worktrees.slice(0, MAX_WORKTREES_PER_REPOSITORY),
      truncated: true,
    });
    expect(parseGitWorktreeDescriptors([descriptor])).toEqual({
      worktrees: [descriptor],
      truncated: false,
    });
  });

  it("bounds parsing work to the explicitly clipped list", () => {
    const worktrees = Array.from({ length: MAX_WORKTREES_PER_REPOSITORY }, (_, index) => ({
      ...descriptor,
      worktreePath: `/repository/.worktrees/agt-${index}`,
    }));
    expect(parseGitWorktreeDescriptors([...worktrees, { ...descriptor, extra: true }])).toEqual({
      worktrees,
      truncated: true,
    });
  });

  it("accepts an explicitly untrusted receipt", () => {
    expect(
      parseAgentWorktreeReceipt({
        worktreePath: descriptor.worktreePath,
        branch: descriptor.branch,
        trusted: false,
      }),
    ).toEqual({
      worktreePath: descriptor.worktreePath,
      branch: descriptor.branch,
      trusted: false,
    });
  });

  it.each([
    { worktreePath: descriptor.worktreePath, branch: descriptor.branch },
    { worktreePath: descriptor.worktreePath, branch: null, trusted: false },
    { worktreePath: descriptor.worktreePath, branch: descriptor.branch, trusted: "false" },
  ])("rejects malformed receipt %# fail-closed", (value) => {
    expect(() => parseAgentWorktreeReceipt(value)).toThrow(TypeError);
  });

  it.each(["agt-123-1a2b", "abc", "a-b-c"])("accepts safe task id %s", (taskId) => {
    expect(validateAgentWorktreeTaskId(taskId)).toBe(taskId);
  });

  it.each(["", "ab", "Abc", "-abc", "abc_def", "a--b", "a".repeat(65)])(
    "rejects unsafe task id %#",
    (taskId) => {
      expect(() => validateAgentWorktreeTaskId(taskId)).toThrow(TypeError);
    },
  );
});
