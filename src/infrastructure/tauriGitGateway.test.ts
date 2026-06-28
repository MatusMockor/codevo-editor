import { describe, expect, it, vi } from "vitest";
import type { GitChangedFile } from "../domain/git";
import { TauriGitGateway } from "./tauriGitGateway";

describe("TauriGitGateway", () => {
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
    await gateway.unstageFiles("/workspace", [change]);
    await gateway.revertFiles("/workspace", [change]);
    await gateway.commit("/workspace", "feat: update user", [change]);
    await gateway.push("/workspace");

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
    expect(invoke).toHaveBeenCalledWith("push_git_changes", {
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
      cursor: undefined,
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
