import { describe, expect, it, vi } from "vitest";
import type { GitChangedFile } from "../domain/git";
import { TauriGitGateway } from "./tauriGitGateway";

describe("TauriGitGateway", () => {
  it("invokes the repository discovery command in Tauri", async () => {
    const invoke = vi.fn(async () => ["", "a/b", "worktrees/feature"]);
    const gateway = new TauriGitGateway(invoke, () => true);

    const repositories = await gateway.detectRepositories("/workspace", 3);

    expect(invoke).toHaveBeenCalledWith("detect_git_repositories", {
      maxDepth: 3,
      rootPath: "/workspace",
    });
    expect(repositories).toEqual(["", "a/b", "worktrees/feature"]);
  });

  it("omits maxDepth when not provided so the backend applies its default", async () => {
    const invoke = vi.fn(async () => [""]);
    const gateway = new TauriGitGateway(invoke, () => true);

    await gateway.detectRepositories("/workspace");

    expect(invoke).toHaveBeenCalledWith("detect_git_repositories", {
      maxDepth: undefined,
      rootPath: "/workspace",
    });
  });

  it("reports repository discovery as unavailable outside Tauri", async () => {
    const gateway = new TauriGitGateway(vi.fn(), () => false);

    await expect(gateway.detectRepositories("/workspace")).resolves.toBeNull();
  });

  it("returns empty status outside Tauri", async () => {
    const gateway = new TauriGitGateway(vi.fn(), () => false);

    await expect(gateway.getStatus("/workspace")).resolves.toEqual({
      branch: null,
      changes: [],
      isRepository: false,
      rootPath: "/workspace",
    });
  });

  it("invokes status and diff commands in Tauri", async () => {
    const change: GitChangedFile = {
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: "/workspace/src/User.php",
      relativePath: "src/User.php",
      status: "modified",
    };
    const invoke = vi.fn(async (command: string) => {
      if (command === "get_git_status") {
        return {
          branch: "main",
          changes: [change],
          isRepository: true,
          rootPath: "/workspace",
        };
      }

      return {
        change,
        language: "php",
        modifiedContent: "<?php changed",
        originalContent: "<?php",
      };
    });
    const gateway = new TauriGitGateway(invoke, () => true);

    await gateway.getStatus("/workspace");
    await gateway.getDiff("/workspace", change);

    expect(invoke).toHaveBeenCalledWith("get_git_status", {
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("get_git_diff", {
      change,
      rootPath: "/workspace",
    });
  });

  it("invokes local Git operation commands in Tauri", async () => {
    const change: GitChangedFile = {
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: "/workspace/src/User.php",
      relativePath: "src/User.php",
      status: "modified",
    };
    const invoke = vi.fn(async () => ({
      branch: "main",
      changes: [],
      isRepository: true,
      rootPath: "/workspace",
    }));
    const gateway = new TauriGitGateway(invoke, () => true);

    await gateway.stageFiles("/workspace", [change]);
    await gateway.commit("/workspace", "feat: update user", [change]);
    await gateway.push("/workspace");
    await gateway.fetch("/workspace");

    expect(invoke).toHaveBeenCalledWith("stage_git_files", {
      changes: [change],
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("commit_git_changes", {
      changes: [change],
      message: "feat: update user",
      rootPath: "/workspace",
    });
    expect(invoke).not.toHaveBeenCalledWith("amend_git_commit", expect.anything());
    expect(invoke).toHaveBeenCalledWith("push_git_changes", {
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("fetch_git_changes", {
      rootPath: "/workspace",
    });
  });

  it("invokes read-only Git log commands in Tauri", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "get_git_commit_log") {
        return [];
      }

      if (command === "get_git_commit_details") {
        return {
          body: "",
          authorEmail: "a@b.com",
          authorName: "A",
          containingBranches: [],
          date: new Date().toISOString(),
          hash: "abc123",
          abbrevHash: "abc",
          labels: ["main"],
          parents: [],
          subject: "Test",
        };
      }

      if (command === "get_git_branches" || command === "get_git_repo_status") {
        return {
          current: "main",
          isRepository: command === "get_git_repo_status" ? false : true,
          local: ["main"],
          remotes: { origin: ["main"] },
          gitAvailable: true,
        };
      }

      if (command === "get_git_commit_files") {
        return [];
      }

      if (command === "get_git_commit_diff") {
        return {
          commitHash: "abc123",
          isRename: false,
          language: "php",
          modifiedContent: "<?php",
          originalContent: "<?php",
          oldPath: null,
          path: "src/User.php",
          status: "M",
        };
      }

      return {
        isRepository: true,
        gitAvailable: true,
      };
    });

    const gateway = new TauriGitGateway(invoke, () => true);

    await gateway.getBranches("/workspace");
    await gateway.getCommitDetails("/workspace", "abc123");
    await gateway.getCommitDiff("/workspace", "abc123", "src/User.php");
    await gateway.getCommitFiles("/workspace", "abc123");
    await gateway.getCommitLog("/workspace", { branch: "main", limit: 20 });
    await gateway.getCommitLog("/workspace", { allBranches: true, limit: 51 });
    await gateway.getRepoStatus("/workspace");

    expect(invoke).toHaveBeenCalledWith("get_git_commit_log", {
      filters: { allBranches: true, limit: 51 },
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("get_git_branches", {
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("get_git_commit_log", {
      filters: { branch: "main", limit: 20 },
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("get_git_commit_details", {
      commitHash: "abc123",
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("get_git_commit_diff", {
      commitHash: "abc123",
      files: undefined,
      oldPath: undefined,
      path: "src/User.php",
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("get_git_commit_files", {
      commitHash: "abc123",
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("get_git_repo_status", {
      rootPath: "/workspace",
    });
  });

  it("returns safe Git history fallbacks outside Tauri", async () => {
    const invoke = vi.fn();
    const gateway = new TauriGitGateway(invoke, () => false);

    await expect(gateway.getCommitDetails("/workspace", "abc123")).rejects.toThrow(
      "Git unavailable.",
    );
    await expect(
      gateway.getCommitDiff("/workspace", "abc123", "src/User.php"),
    ).resolves.toEqual({
      commitHash: "abc123",
      isRename: false,
      language: "plaintext",
      modifiedContent: "",
      oldPath: null,
      originalContent: "",
      path: "src/User.php",
      status: "M",
    });
    await expect(gateway.getCommitFiles("/workspace", "abc123")).resolves.toEqual([]);
    await expect(gateway.getCommitLog("/workspace", { limit: 20 })).resolves.toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("invokes the branch commands in Tauri", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "list_git_branches") {
        return [
          { isCurrent: true, name: "main" },
          { isCurrent: false, name: "feature/login" },
        ];
      }

      if (command === "get_git_current_branch") {
        return "main";
      }

      if (command === "list_git_remote_branches") {
        return [{ isCurrent: false, name: "origin/feature-x" }];
      }

      if (command === "checkout_git_remote_branch") {
        return [
          { isCurrent: true, name: "feature-x" },
          { isCurrent: false, name: "main" },
        ];
      }

      return undefined;
    });
    const gateway = new TauriGitGateway(invoke, () => true);

    const branches = await gateway.branchList("/workspace");
    const current = await gateway.currentBranch("/workspace");
    const remoteBranches = await gateway.remoteBranchList("/workspace");
    await gateway.createBranch("/workspace", "feature/new");
    await gateway.switchBranch("/workspace", "feature/login");
    const checkedOutBranches = await gateway.checkoutRemoteBranch(
      "/workspace",
      "origin/feature-x",
    );
    await gateway.deleteBranch("/workspace", "feature/old", { force: true });

    expect(invoke).toHaveBeenCalledWith("list_git_branches", {
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("get_git_current_branch", {
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("list_git_remote_branches", {
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("create_git_branch", {
      name: "feature/new",
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("switch_git_branch", {
      name: "feature/login",
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("checkout_git_remote_branch", {
      name: "origin/feature-x",
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("delete_git_branch", {
      force: true,
      name: "feature/old",
      rootPath: "/workspace",
    });
    expect(branches).toHaveLength(2);
    expect(branches[0]).toEqual({ isCurrent: true, name: "main" });
    expect(current).toBe("main");
    expect(remoteBranches).toEqual([
      { isCurrent: false, name: "origin/feature-x" },
    ]);
    expect(checkedOutBranches[0]).toEqual({
      isCurrent: true,
      name: "feature-x",
    });
  });

  it("returns no branches and null current outside Tauri", async () => {
    const gateway = new TauriGitGateway(vi.fn(), () => false);

    await expect(gateway.branchList("/workspace")).resolves.toEqual([]);
    await expect(gateway.currentBranch("/workspace")).resolves.toBeNull();
    await expect(gateway.remoteBranchList("/workspace")).resolves.toEqual([]);
    // Safe no-ops that never invoke a command.
    await expect(
      gateway.createBranch("/workspace", "x"),
    ).resolves.toBeUndefined();
    await expect(
      gateway.switchBranch("/workspace", "x"),
    ).resolves.toBeUndefined();
    await expect(
      gateway.checkoutRemoteBranch("/workspace", "origin/x"),
    ).resolves.toEqual([]);
    await expect(
      gateway.deleteBranch("/workspace", "x", { force: false }),
    ).resolves.toBeUndefined();
  });

  it("returns empty status for local Git operations outside Tauri", async () => {
    const change: GitChangedFile = {
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: "/workspace/src/User.php",
      relativePath: "src/User.php",
      status: "modified",
    };
    const gateway = new TauriGitGateway(vi.fn(), () => false);

    await expect(gateway.stageFiles("/workspace", [change])).resolves.toEqual({
      branch: null,
      changes: [],
      isRepository: false,
      rootPath: "/workspace",
    });
    await expect(gateway.commit("/workspace", "message", [change])).resolves.toEqual({
      branch: null,
      changes: [],
      isRepository: false,
      rootPath: "/workspace",
    });
    await expect(gateway.push("/workspace")).resolves.toEqual({
      branch: null,
      changes: [],
      isRepository: false,
      rootPath: "/workspace",
    });
  });
});
