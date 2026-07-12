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

  it("returns no repositories outside Tauri", async () => {
    const gateway = new TauriGitGateway(vi.fn(), () => false);

    await expect(gateway.detectRepositories("/workspace")).resolves.toEqual(
      [],
    );
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

  it("invokes the blame command in Tauri", async () => {
    const invoke = vi.fn(async () => [
      { author: "Alice", lineNumber: 1, sha: "1a2b3c4", timestamp: 1700000000 },
      { author: "Bob", lineNumber: 2, sha: "f0e1d2c", timestamp: 1700100000 },
    ]);
    const gateway = new TauriGitGateway(invoke, () => true);

    const blame = await gateway.blame("/workspace", "src/User.php");

    expect(invoke).toHaveBeenCalledWith("get_git_blame", {
      relativePath: "src/User.php",
      rootPath: "/workspace",
    });
    expect(blame).toHaveLength(2);
    expect(blame[0].author).toBe("Alice");
    expect(blame[0].sha).toBe("1a2b3c4");
    expect(blame[1].lineNumber).toBe(2);
  });

  it("returns no blame lines outside Tauri", async () => {
    const gateway = new TauriGitGateway(vi.fn(), () => false);

    await expect(gateway.blame("/workspace", "src/User.php")).resolves.toEqual(
      [],
    );
  });

  it("invokes the file history command in Tauri", async () => {
    const invoke = vi.fn(async () => [
      {
        author: "Alice",
        sha: "1a2b3c4",
        subject: "Add user model",
        timestamp: 1700000000,
      },
      {
        author: "Bob",
        sha: "f0e1d2c",
        subject: "Refactor user model",
        timestamp: 1700100000,
      },
    ]);
    const gateway = new TauriGitGateway(invoke, () => true);

    const history = await gateway.fileHistory("/workspace", "src/User.php");

    expect(invoke).toHaveBeenCalledWith("get_git_file_history", {
      relativePath: "src/User.php",
      rootPath: "/workspace",
    });
    expect(history).toHaveLength(2);
    expect(history[0].subject).toBe("Add user model");
    expect(history[0].sha).toBe("1a2b3c4");
    expect(history[1].author).toBe("Bob");
  });

  it("returns no file history outside Tauri", async () => {
    const gateway = new TauriGitGateway(vi.fn(), () => false);

    await expect(
      gateway.fileHistory("/workspace", "src/User.php"),
    ).resolves.toEqual([]);
  });

  it("invokes the file commit diff command in Tauri", async () => {
    const invoke = vi.fn(async () => ({
      change: {
        isStaged: false,
        isUnversioned: false,
        oldPath: null,
        oldRelativePath: null,
        path: "/workspace/src/User.php",
        relativePath: "src/User.php",
        status: "modified",
      },
      language: "php",
      modifiedContent: "<?php changed",
      originalContent: "<?php",
    }));
    const gateway = new TauriGitGateway(invoke, () => true);

    const diff = await gateway.fileCommitDiff(
      "/workspace",
      "src/User.php",
      "1a2b3c4",
    );

    expect(invoke).toHaveBeenCalledWith("get_git_file_commit_diff", {
      relativePath: "src/User.php",
      rootPath: "/workspace",
      sha: "1a2b3c4",
    });
    expect(diff.modifiedContent).toBe("<?php changed");
    expect(diff.language).toBe("php");
  });

  it("returns an empty diff for file commit diff outside Tauri", async () => {
    const gateway = new TauriGitGateway(vi.fn(), () => false);

    const diff = await gateway.fileCommitDiff(
      "/workspace",
      "src/User.php",
      "1a2b3c4",
    );

    expect(diff.originalContent).toBe("");
    expect(diff.modifiedContent).toBe("");
    expect(diff.change.relativePath).toBe("src/User.php");
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
    await gateway.unstageFiles("/workspace", [change]);
    await gateway.revertFiles("/workspace", [change]);
    await gateway.commit("/workspace", "feat: update user", [change]);
    await gateway.amend("/workspace", "feat: amended user", [change]);
    await gateway.rewordCommit(
      "/workspace",
      "1111111111111111111111111111111111111111",
      "feat: reworded user",
    );
    await gateway.push("/workspace");
    await gateway.fetch("/workspace");
    await gateway.pull("/workspace");

    expect(invoke).toHaveBeenCalledWith("stage_git_files", {
      changes: [change],
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("unstage_git_files", {
      changes: [change],
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("revert_git_files", {
      changes: [change],
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("commit_git_changes", {
      changes: [change],
      message: "feat: update user",
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("amend_git_commit", {
      changes: [change],
      message: "feat: amended user",
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("reword_git_commit", {
      commitHash: "1111111111111111111111111111111111111111",
      message: "feat: reworded user",
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("push_git_changes", {
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("fetch_git_changes", {
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("pull_git_changes", {
      rootPath: "/workspace",
    });
  });

  it("invokes read-only Git log commands in Tauri", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "get_git_commit_log") {
        return [];
      }

      if (command === "get_git_commit_graph_page") {
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
    await gateway.getCommitGraphPage("/workspace");
    await gateway.getCommitDetails("/workspace", "abc123");
    await gateway.getCommitDiff("/workspace", "abc123", "src/User.php");
    await gateway.getCommitFiles("/workspace", "abc123");
    await gateway.getCommitLog("/workspace", { branch: "main", limit: 20 });
    await gateway.getRepoStatus("/workspace");

    expect(invoke).toHaveBeenCalledWith("get_git_branches", {
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("get_git_commit_graph_page", {
      cursor: null,
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
    await expect(gateway.getCommitGraphPage("/workspace")).resolves.toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("invokes the hunk-level commands in Tauri", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "get_git_file_hunks") {
        return [
          { header: "@@ -1 +1 @@", index: 0, lines: ["-a", "+A"], isStaged: false },
        ];
      }

      return {
        branch: "main",
        changes: [],
        isRepository: true,
        rootPath: "/workspace",
      };
    });
    const gateway = new TauriGitGateway(invoke, () => true);

    const hunks = await gateway.getFileHunks("/workspace", "src/User.php", false);
    await gateway.stageHunk("/workspace", "src/User.php", 0);
    await gateway.unstageHunk("/workspace", "src/User.php", 1);

    expect(hunks).toEqual([
      { header: "@@ -1 +1 @@", index: 0, lines: ["-a", "+A"], isStaged: false },
    ]);
    expect(invoke).toHaveBeenCalledWith("get_git_file_hunks", {
      relativePath: "src/User.php",
      rootPath: "/workspace",
      staged: false,
    });
    expect(invoke).toHaveBeenCalledWith("stage_git_hunk", {
      hunkIndex: 0,
      relativePath: "src/User.php",
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("unstage_git_hunk", {
      hunkIndex: 1,
      relativePath: "src/User.php",
      rootPath: "/workspace",
    });
  });

  it("returns empty hunks and status for hunk operations outside Tauri", async () => {
    const gateway = new TauriGitGateway(vi.fn(), () => false);

    await expect(
      gateway.getFileHunks("/workspace", "src/User.php", false),
    ).resolves.toEqual([]);
    await expect(
      gateway.stageHunk("/workspace", "src/User.php", 0),
    ).resolves.toEqual({
      branch: null,
      changes: [],
      isRepository: false,
      rootPath: "/workspace",
    });
    await expect(
      gateway.unstageHunk("/workspace", "src/User.php", 0),
    ).resolves.toEqual({
      branch: null,
      changes: [],
      isRepository: false,
      rootPath: "/workspace",
    });
  });

  it("invokes the stash commands in Tauri", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "get_git_stash_list") {
        return [
          { branch: "main", index: 0, message: "WIP on main: x", timestamp: 1700000000 },
          { branch: null, index: 1, message: "On feature: y", timestamp: 1700100000 },
        ];
      }

      if (command === "get_git_stash_diff") {
        return "diff --git a/file.txt b/file.txt\n+two";
      }

      return undefined;
    });
    const gateway = new TauriGitGateway(invoke, () => true);

    await gateway.stashSave("/workspace", "work in progress");
    const stashes = await gateway.stashList("/workspace");
    await gateway.stashApply("/workspace", 0);
    await gateway.stashPop("/workspace", 1);
    const diff = await gateway.stashShow("/workspace", 0);
    await gateway.stashDrop("/workspace", 1);

    expect(invoke).toHaveBeenCalledWith("save_git_stash", {
      message: "work in progress",
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("get_git_stash_list", {
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("stash_apply_git", {
      index: "0",
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("stash_pop_git", {
      index: "1",
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("get_git_stash_diff", {
      index: "0",
      rootPath: "/workspace",
    });
    expect(invoke).toHaveBeenCalledWith("stash_drop_git", {
      index: "1",
      rootPath: "/workspace",
    });
    expect(stashes).toHaveLength(2);
    expect(stashes[0].message).toBe("WIP on main: x");
    expect(diff).toContain("+two");
  });

  it("returns no stashes and empty diff outside Tauri", async () => {
    const gateway = new TauriGitGateway(vi.fn(), () => false);

    await expect(gateway.stashList("/workspace")).resolves.toEqual([]);
    await expect(gateway.stashShow("/workspace", 0)).resolves.toBe("");
    // Safe no-ops that never invoke a command.
    await expect(gateway.stashSave("/workspace", "x")).resolves.toBeUndefined();
    await expect(gateway.stashApply("/workspace", 0)).resolves.toBeUndefined();
    await expect(gateway.stashPop("/workspace", 0)).resolves.toBeUndefined();
    await expect(gateway.stashDrop("/workspace", 0)).resolves.toBeUndefined();
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
    await gateway.renameBranch("/workspace", "feature/login", "feature/auth");

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
    expect(invoke).toHaveBeenCalledWith("rename_git_branch", {
      newName: "feature/auth",
      oldName: "feature/login",
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
    await expect(
      gateway.renameBranch("/workspace", "x", "y"),
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
    await expect(gateway.unstageFiles("/workspace", [change])).resolves.toEqual({
      branch: null,
      changes: [],
      isRepository: false,
      rootPath: "/workspace",
    });
    await expect(gateway.revertFiles("/workspace", [change])).resolves.toEqual({
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
