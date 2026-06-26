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
