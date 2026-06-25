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
