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
});
