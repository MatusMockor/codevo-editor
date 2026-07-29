// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  emptyGitStatus,
  gitChangeKey,
  type GitChangedFile,
  type GitGateway,
} from "../../domain/git";
import type { IndexProgressGateway, MetadataScanCompletionEvent } from "../../domain/indexProgress";
import type { SmartModeGateway } from "../../domain/intelligence";
import { defaultKeymapSettings } from "../../domain/keymap";
import type {
  LanguageServerGateway,
  LanguageServerPlan,
  PhpLanguageServerPlanOptions,
} from "../../domain/languageServer";
import {
  emptyLanguageServerCapabilities,
  type LanguageServerRuntimeGateway,
  type LanguageServerRuntimeStatus,
} from "../../domain/languageServerRuntime";
import { defaultAppSettings, defaultWorkspaceSettings } from "../../domain/settings";
import type { WorkspaceTrustGateway } from "../../domain/trust";
import type { WorkspaceFileChangeEvent } from "../../domain/workspaceFileChange";
import { waitForReact } from "../../test/reactTestLifecycle";
import {
  flushAsyncTurns,
  javaScriptTypeScriptWorkspaceDescriptor,
  setupWorkbenchControllerTestHarness,
} from "../../test/workbenchControllerTestHarness";
import { type WorkbenchWorkspaceGateways } from "../useWorkbenchController";
import {
  createDeferred,
  createManagedPhpactorInstallHarness,
  defaultPhpLanguageServerOptions,
  fileEntry,
  fileHistoryGitGateway,
  flushWorkspaceDirectoryRefresh,
  gitChangedFile,
  phpWorkspaceDescriptor,
  phpactorLanguageServerPlan,
  readyJavaScriptTypeScriptPlan,
} from "./testSupport";

describe("useWorkbenchController Git operations and workspace editor behavior", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();

  it("loads the Git original content for active editor change markers", async () => {
    const file = fileEntry("/workspace/src/User.php", "User.php");
    const change = {
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: file.path,
      relativePath: "src/User.php",
      status: "modified" as const,
    };
    const gitGateway: GitGateway = {
      blame: vi.fn(async () => []),
      fileHistory: vi.fn(async () => []),
      fileCommitDiff: vi.fn(async (_rootPath, relativePath) => ({
        change: {
          isStaged: false,
          isUnversioned: false,
          oldPath: null,
          oldRelativePath: null,
          path: relativePath,
          relativePath,
          status: "modified" as const,
        },
        language: "plaintext",
        modifiedContent: "",
        originalContent: "",
      })),
      commit: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      push: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      getDiff: vi.fn(async (_rootPath, requestedChange) => ({
        change: requestedChange,
        language: "php",
        modifiedContent: "<?php\nfinal class User {}\n",
        originalContent: "<?php\nfinal class OriginalUser {}\n",
      })),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [change],
        isRepository: true,
        rootPath,
      })),
      getFileHunks: vi.fn(async () => []),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stashSave: vi.fn(async () => undefined),
      stashList: vi.fn(async () => []),
      stashApply: vi.fn(async () => undefined),
      stashPop: vi.fn(async () => undefined),
      stashShow: vi.fn(async () => ""),
      stashDrop: vi.fn(async () => undefined),
      branchList: vi.fn(async () => []),
      currentBranch: vi.fn(async () => null),
      createBranch: vi.fn(async () => undefined),
      switchBranch: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
      readTextFile: vi.fn(async () => "<?php\nfinal class User {}\n"),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openFile(file);
    });
    await flushAsyncTurns();

    expect(gitGateway.getDiff).toHaveBeenCalledWith("/workspace", change);
    expect(getWorkbench().activeDocumentGitBaseline).toBe("<?php\nfinal class OriginalUser {}\n");
  });
  it("stages Git changes through the gateway and applies the refreshed status", async () => {
    const change = gitChangedFile("src/User.php", false);
    const stagedChange = { ...change, isStaged: true };
    const gitGateway: GitGateway = {
      blame: vi.fn(async () => []),
      fileHistory: vi.fn(async () => []),
      fileCommitDiff: vi.fn(async (_rootPath, relativePath) => ({
        change: {
          isStaged: false,
          isUnversioned: false,
          oldPath: null,
          oldRelativePath: null,
          path: relativePath,
          relativePath,
          status: "modified" as const,
        },
        language: "plaintext",
        modifiedContent: "",
        originalContent: "",
      })),
      commit: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      push: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      getDiff: vi.fn(async (_rootPath, requestedChange) => ({
        change: requestedChange,
        language: "php",
        modifiedContent: "",
        originalContent: "",
      })),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [change],
        isRepository: true,
        rootPath,
      })),
      getFileHunks: vi.fn(async () => []),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [stagedChange],
        isRepository: true,
        rootPath,
      })),
      stageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stashSave: vi.fn(async () => undefined),
      stashList: vi.fn(async () => []),
      stashApply: vi.fn(async () => undefined),
      stashPop: vi.fn(async () => undefined),
      stashShow: vi.fn(async () => ""),
      stashDrop: vi.fn(async () => undefined),
      branchList: vi.fn(async () => []),
      currentBranch: vi.fn(async () => null),
      createBranch: vi.fn(async () => undefined),
      switchBranch: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().stageGitChanges([change]);
    });

    expect(gitGateway.stageFiles).toHaveBeenCalledWith("/workspace", [change]);
    expect(getWorkbench().gitStatus.changes).toEqual([stagedChange]);
  });
  it("stages a single hunk through the gateway and applies the refreshed status", async () => {
    const change = gitChangedFile("src/User.php", false);
    const stagedChange = { ...change, isStaged: true };
    const gitGateway = fileHistoryGitGateway({});
    gitGateway.stageHunk = vi.fn(async (rootPath) => ({
      branch: "main",
      changes: [stagedChange],
      isRepository: true,
      rootPath,
    }));
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().stageGitHunk(change, 1, "expected-stage-hunk");
    });

    expect(gitGateway.stageHunk).toHaveBeenCalledWith(
      "/workspace",
      "src/User.php",
      1,
      "expected-stage-hunk",
    );
    expect(getWorkbench().gitStatus.changes).toEqual([stagedChange]);
  });
  it("unstages a single hunk through the gateway and applies the refreshed status", async () => {
    const change = gitChangedFile("src/User.php", true);
    const unstagedChange = { ...change, isStaged: false };
    const gitGateway = fileHistoryGitGateway({});
    gitGateway.unstageHunk = vi.fn(async (rootPath) => ({
      branch: "main",
      changes: [unstagedChange],
      isRepository: true,
      rootPath,
    }));
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().unstageGitHunk(change, 0, "expected-unstage-hunk");
    });

    expect(gitGateway.unstageHunk).toHaveBeenCalledWith(
      "/workspace",
      "src/User.php",
      0,
      "expected-unstage-hunk",
    );
    expect(getWorkbench().gitStatus.changes).toEqual([unstagedChange]);
  });
  it("surfaces hunk-staging gateway failures without throwing (safe no-op)", async () => {
    const gitGateway = fileHistoryGitGateway({});
    gitGateway.stageHunk = vi.fn(async () => {
      throw new Error("patch does not apply");
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().stageGitHunk(
        gitChangedFile("src/User.php", false),
        0,
        "expected-rejected-hunk",
      );
    });

    expect(gitGateway.stageHunk).toHaveBeenCalledWith(
      "/workspace",
      "src/User.php",
      0,
      "expected-rejected-hunk",
    );
    // A rejected patch must not leave the operation spinner stuck.
    expect(getWorkbench().gitOperationLoading).toBe(false);
  });
  it("loads a file's hunks through the gateway for the active workspace", async () => {
    const hunks = [
      {
        header: "@@ -1 +1 @@",
        identity: "@@ -1 +1 @@\n-a\n+A",
        index: 0,
        lines: ["-a", "+A"],
        isStaged: false,
        modifiedCount: 1,
        modifiedStart: 1,
        originalCount: 1,
        originalStart: 1,
      },
    ];
    const gitGateway = fileHistoryGitGateway({});
    gitGateway.getFileHunks = vi.fn(async () => hunks);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    let loaded: typeof hunks = [];
    await act(async () => {
      loaded = await getWorkbench().loadGitFileHunks(gitChangedFile("src/User.php", false), false);
    });

    expect(gitGateway.getFileHunks).toHaveBeenCalledWith("/workspace", "src/User.php", false);
    expect(loaded).toEqual(hunks);
  });
  it("commits staged Git changes and clears the commit message", async () => {
    const change = gitChangedFile("src/User.php", true);
    const gitGateway: GitGateway = {
      blame: vi.fn(async () => []),
      fileHistory: vi.fn(async () => []),
      fileCommitDiff: vi.fn(async (_rootPath, relativePath) => ({
        change: {
          isStaged: false,
          isUnversioned: false,
          oldPath: null,
          oldRelativePath: null,
          path: relativePath,
          relativePath,
          status: "modified" as const,
        },
        language: "plaintext",
        modifiedContent: "",
        originalContent: "",
      })),
      commit: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [],
        isRepository: true,
        rootPath,
      })),
      push: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      getDiff: vi.fn(async (_rootPath, requestedChange) => ({
        change: requestedChange,
        language: "php",
        modifiedContent: "",
        originalContent: "",
      })),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [change],
        isRepository: true,
        rootPath,
      })),
      getFileHunks: vi.fn(async () => []),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stashSave: vi.fn(async () => undefined),
      stashList: vi.fn(async () => []),
      stashApply: vi.fn(async () => undefined),
      stashPop: vi.fn(async () => undefined),
      stashShow: vi.fn(async () => ""),
      stashDrop: vi.fn(async () => undefined),
      branchList: vi.fn(async () => []),
      currentBranch: vi.fn(async () => null),
      createBranch: vi.fn(async () => undefined),
      switchBranch: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setSidebarView("git");
    });
    await flushAsyncTurns();
    act(() => {
      getWorkbench().setGitCommitMessage("feat: update git panel");
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().commitGitChanges();
    });

    expect(gitGateway.commit).toHaveBeenCalledWith("/workspace", "feat: update git panel", [
      change,
    ]);
    expect(getWorkbench().gitCommitMessage).toBe("");
    expect(getWorkbench().gitStatus.changes).toEqual([]);
  });
  it("commits staged Git changes from the primary keymap shortcut", async () => {
    const change = gitChangedFile("src/User.php", true);
    const gitGateway = fileHistoryGitGateway({
      commit: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [change],
        isRepository: true,
        rootPath,
      })),
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        keymap: defaultKeymapSettings("linux"),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setSidebarView("git");
    });
    await flushAsyncTurns();
    act(() => {
      getWorkbench().setGitCommitMessage("feat: keymap commit");
    });
    await flushAsyncTurns();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          ctrlKey: true,
          key: "Enter",
        }),
      );
      await flushAsyncTurns();
    });

    expect(gitGateway.commit).toHaveBeenCalledWith("/workspace", "feat: keymap commit", [change]);
  });
  it("does not commit a staged file that was excluded from the commit selection", async () => {
    const included = gitChangedFile("src/User.php", true);
    const excluded = gitChangedFile("test.txt", true);
    const gitGateway: GitGateway = {
      blame: vi.fn(async () => []),
      fileHistory: vi.fn(async () => []),
      fileCommitDiff: vi.fn(async (_rootPath, relativePath) => ({
        change: {
          isStaged: false,
          isUnversioned: false,
          oldPath: null,
          oldRelativePath: null,
          path: relativePath,
          relativePath,
          status: "modified" as const,
        },
        language: "plaintext",
        modifiedContent: "",
        originalContent: "",
      })),
      commit: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [excluded],
        isRepository: true,
        rootPath,
      })),
      push: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      getDiff: vi.fn(async (_rootPath, requestedChange) => ({
        change: requestedChange,
        language: "php",
        modifiedContent: "",
        originalContent: "",
      })),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [included, excluded],
        isRepository: true,
        rootPath,
      })),
      getFileHunks: vi.fn(async () => []),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stashSave: vi.fn(async () => undefined),
      stashList: vi.fn(async () => []),
      stashApply: vi.fn(async () => undefined),
      stashPop: vi.fn(async () => undefined),
      stashShow: vi.fn(async () => ""),
      stashDrop: vi.fn(async () => undefined),
      branchList: vi.fn(async () => []),
      currentBranch: vi.fn(async () => null),
      createBranch: vi.fn(async () => undefined),
      switchBranch: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setSidebarView("git");
    });
    await flushAsyncTurns();
    act(() => {
      getWorkbench().toggleGitChangeIncluded(excluded);
      getWorkbench().setGitCommitMessage("feat: selected only");
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().commitGitChanges();
    });

    expect(gitGateway.commit).toHaveBeenCalledWith("/workspace", "feat: selected only", [included]);
  });
  it("keeps staged and unstaged commit selection separate for the same file", async () => {
    const staged = gitChangedFile("src/User.php", true);
    const unstaged = gitChangedFile("src/User.php", false);
    const gitGateway: GitGateway = {
      blame: vi.fn(async () => []),
      fileHistory: vi.fn(async () => []),
      fileCommitDiff: vi.fn(async (_rootPath, relativePath) => ({
        change: {
          isStaged: false,
          isUnversioned: false,
          oldPath: null,
          oldRelativePath: null,
          path: relativePath,
          relativePath,
          status: "modified" as const,
        },
        language: "plaintext",
        modifiedContent: "",
        originalContent: "",
      })),
      commit: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      push: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      getDiff: vi.fn(async (_rootPath, requestedChange) => ({
        change: requestedChange,
        language: "php",
        modifiedContent: "",
        originalContent: "",
      })),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [staged, unstaged],
        isRepository: true,
        rootPath,
      })),
      getFileHunks: vi.fn(async () => []),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stashSave: vi.fn(async () => undefined),
      stashList: vi.fn(async () => []),
      stashApply: vi.fn(async () => undefined),
      stashPop: vi.fn(async () => undefined),
      stashShow: vi.fn(async () => ""),
      stashDrop: vi.fn(async () => undefined),
      branchList: vi.fn(async () => []),
      currentBranch: vi.fn(async () => null),
      createBranch: vi.fn(async () => undefined),
      switchBranch: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setSidebarView("git");
    });
    await flushAsyncTurns();

    expect(getWorkbench().includedGitChangePaths.has(gitChangeKey(staged))).toBe(true);
    expect(getWorkbench().includedGitChangePaths.has(gitChangeKey(unstaged))).toBe(false);

    act(() => {
      getWorkbench().toggleGitChangeIncluded(unstaged);
      getWorkbench().setGitCommitMessage("feat: selected side");
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().commitGitChanges();
    });

    expect(gitGateway.commit).toHaveBeenCalledWith("/workspace", "feat: selected side", [
      staged,
      unstaged,
    ]);
  });
  it("stages included unversioned files before committing them", async () => {
    const unversioned = {
      ...gitChangedFile("docs/new-note.md", false),
      isUnversioned: true,
      status: "untracked" as const,
    };
    const gitGateway: GitGateway = {
      blame: vi.fn(async () => []),
      fileHistory: vi.fn(async () => []),
      fileCommitDiff: vi.fn(async (_rootPath, relativePath) => ({
        change: {
          isStaged: false,
          isUnversioned: false,
          oldPath: null,
          oldRelativePath: null,
          path: relativePath,
          relativePath,
          status: "modified" as const,
        },
        language: "plaintext",
        modifiedContent: "",
        originalContent: "",
      })),
      commit: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      push: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      getDiff: vi.fn(async (_rootPath, requestedChange) => ({
        change: requestedChange,
        language: "markdown",
        modifiedContent: "",
        originalContent: "",
      })),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [unversioned],
        isRepository: true,
        rootPath,
      })),
      getFileHunks: vi.fn(async () => []),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stashSave: vi.fn(async () => undefined),
      stashList: vi.fn(async () => []),
      stashApply: vi.fn(async () => undefined),
      stashPop: vi.fn(async () => undefined),
      stashShow: vi.fn(async () => ""),
      stashDrop: vi.fn(async () => undefined),
      branchList: vi.fn(async () => []),
      currentBranch: vi.fn(async () => null),
      createBranch: vi.fn(async () => undefined),
      switchBranch: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setSidebarView("git");
    });
    await flushAsyncTurns();
    act(() => {
      getWorkbench().toggleGitChangeIncluded(unversioned);
      getWorkbench().setGitCommitMessage("docs: add note");
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().commitGitChanges();
    });

    expect(gitGateway.stageFiles).toHaveBeenCalledWith("/workspace", [unversioned]);
    expect(gitGateway.commit).toHaveBeenCalledWith("/workspace", "docs: add note", [unversioned]);
    expect(getWorkbench().gitCommitMessage).toBe("");
  });
  it("commits included files and pushes the branch", async () => {
    const change = gitChangedFile("src/User.php", true);
    const gitGateway: GitGateway = {
      blame: vi.fn(async () => []),
      fileHistory: vi.fn(async () => []),
      fileCommitDiff: vi.fn(async (_rootPath, relativePath) => ({
        change: {
          isStaged: false,
          isUnversioned: false,
          oldPath: null,
          oldRelativePath: null,
          path: relativePath,
          relativePath,
          status: "modified" as const,
        },
        language: "plaintext",
        modifiedContent: "",
        originalContent: "",
      })),
      commit: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [],
        isRepository: true,
        rootPath,
      })),
      getDiff: vi.fn(async (_rootPath, requestedChange) => ({
        change: requestedChange,
        language: "php",
        modifiedContent: "",
        originalContent: "",
      })),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [change],
        isRepository: true,
        rootPath,
      })),
      push: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [],
        isRepository: true,
        rootPath,
      })),
      getFileHunks: vi.fn(async () => []),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stashSave: vi.fn(async () => undefined),
      stashList: vi.fn(async () => []),
      stashApply: vi.fn(async () => undefined),
      stashPop: vi.fn(async () => undefined),
      stashShow: vi.fn(async () => ""),
      stashDrop: vi.fn(async () => undefined),
      branchList: vi.fn(async () => []),
      currentBranch: vi.fn(async () => null),
      createBranch: vi.fn(async () => undefined),
      switchBranch: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setSidebarView("git");
    });
    await flushAsyncTurns();
    act(() => {
      getWorkbench().setGitCommitMessage("feat: push flow");
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().commitAndPushGitChanges();
    });

    expect(gitGateway.stageFiles).not.toHaveBeenCalled();
    expect(gitGateway.commit).toHaveBeenCalledWith("/workspace", "feat: push flow", [change]);
    expect(gitGateway.push).toHaveBeenCalledWith("/workspace");
    expect(getWorkbench().gitCommitMessage).toBe("");
  });
  it("resets Git operation UI state when switching workspaces", async () => {
    const change = gitChangedFile("src/User.php", true);
    const gitGateway: GitGateway = {
      blame: vi.fn(async () => []),
      fileHistory: vi.fn(async () => []),
      fileCommitDiff: vi.fn(async (_rootPath, relativePath) => ({
        change: {
          isStaged: false,
          isUnversioned: false,
          oldPath: null,
          oldRelativePath: null,
          path: relativePath,
          relativePath,
          status: "modified" as const,
        },
        language: "plaintext",
        modifiedContent: "",
        originalContent: "",
      })),
      commit: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      push: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      getDiff: vi.fn(async (_rootPath, requestedChange) => ({
        change: requestedChange,
        language: "php",
        modifiedContent: "",
        originalContent: "",
      })),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: rootPath === "/workspace-a" ? [change] : [],
        isRepository: true,
        rootPath,
      })),
      getFileHunks: vi.fn(async () => []),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stashSave: vi.fn(async () => undefined),
      stashList: vi.fn(async () => []),
      stashApply: vi.fn(async () => undefined),
      stashPop: vi.fn(async () => undefined),
      stashShow: vi.fn(async () => ""),
      stashDrop: vi.fn(async () => undefined),
      branchList: vi.fn(async () => []),
      currentBranch: vi.fn(async () => null),
      createBranch: vi.fn(async () => undefined),
      switchBranch: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      gitGateway,
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setSidebarView("git");
    });
    await flushAsyncTurns();
    act(() => {
      getWorkbench().setGitCommitMessage("feat: workspace a");
    });
    await flushAsyncTurns();

    expect(getWorkbench().includedGitChangePaths.has(gitChangeKey(change))).toBe(true);
    expect(getWorkbench().gitCommitMessage).toBe("feat: workspace a");

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(getWorkbench().gitOperationLoading).toBe(false);
    expect(getWorkbench().gitCommitMessage).toBe("");
    expect(getWorkbench().includedGitChangePaths.size).toBe(0);
  });
  it("drops delayed Git status results after switching workspaces", async () => {
    const workspaceAStatus = createDeferred<ReturnType<typeof emptyGitStatus>>();
    const workspaceAChange: GitChangedFile = {
      ...gitChangedFile("src/WorkspaceA.php", false),
      path: "/workspace-a/src/WorkspaceA.php",
    };
    const workspaceBChange: GitChangedFile = {
      ...gitChangedFile("src/WorkspaceB.php", false),
      path: "/workspace-b/src/WorkspaceB.php",
    };
    const workspaceBStatus = {
      branch: "workspace-b",
      changes: [workspaceBChange],
      isRepository: true,
      rootPath: "/workspace-b",
    };
    const gitGateway = fileHistoryGitGateway({});
    gitGateway.getStatus = vi.fn((rootPath) => {
      if (rootPath === "/workspace-a") {
        return workspaceAStatus.promise;
      }

      return Promise.resolve(workspaceBStatus);
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-b",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      gitGateway,
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setSidebarView("git");
    });
    await waitForReact(() => {
      expect(gitGateway.getStatus).toHaveBeenCalledWith("/workspace-b");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().gitStatus.branch).toBe("workspace-b");
    expect(getWorkbench().gitStatus.changes).toEqual([workspaceBChange]);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns(24);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");

    await act(async () => {
      void getWorkbench().refreshGitStatus();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(gitGateway.getStatus).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().gitStatus.branch).toBe("workspace-b");
    expect(getWorkbench().gitStatus.changes).toEqual([workspaceBChange]);

    workspaceAStatus.resolve({
      branch: "workspace-a",
      changes: [workspaceAChange],
      isRepository: true,
      rootPath: "/workspace-a",
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().gitStatus.branch).toBe("workspace-b");
    expect(getWorkbench().gitStatus.changes).toEqual([workspaceBChange]);
    expect(getWorkbench().gitStatus.branch).not.toBe("workspace-a");
    expect(getWorkbench().gitStatus.changes).not.toContainEqual(workspaceAChange);
  });
  it("keeps post-commit status visible and reports when push fails", async () => {
    const change = gitChangedFile("src/User.php", true);
    const gitGateway: GitGateway = {
      blame: vi.fn(async () => []),
      fileHistory: vi.fn(async () => []),
      fileCommitDiff: vi.fn(async (_rootPath, relativePath) => ({
        change: {
          isStaged: false,
          isUnversioned: false,
          oldPath: null,
          oldRelativePath: null,
          path: relativePath,
          relativePath,
          status: "modified" as const,
        },
        language: "plaintext",
        modifiedContent: "",
        originalContent: "",
      })),
      commit: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [],
        isRepository: true,
        rootPath,
      })),
      getDiff: vi.fn(async (_rootPath, requestedChange) => ({
        change: requestedChange,
        language: "php",
        modifiedContent: "",
        originalContent: "",
      })),
      getStatus: vi.fn(async (rootPath) => ({
        branch: "main",
        changes: [change],
        isRepository: true,
        rootPath,
      })),
      push: vi.fn(async () => {
        throw new Error("no upstream configured");
      }),
      getFileHunks: vi.fn(async () => []),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stashSave: vi.fn(async () => undefined),
      stashList: vi.fn(async () => []),
      stashApply: vi.fn(async () => undefined),
      stashPop: vi.fn(async () => undefined),
      stashShow: vi.fn(async () => ""),
      stashDrop: vi.fn(async () => undefined),
      branchList: vi.fn(async () => []),
      currentBranch: vi.fn(async () => null),
      createBranch: vi.fn(async () => undefined),
      switchBranch: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setSidebarView("git");
    });
    await flushAsyncTurns();
    act(() => {
      getWorkbench().setGitCommitMessage("feat: push feedback");
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().commitAndPushGitChanges();
    });

    expect(getWorkbench().gitStatus.changes).toEqual([]);
    expect(getWorkbench().gitCommitMessage).toBe("");
    expect(getWorkbench().notices[0]).toEqual(
      expect.objectContaining({
        message: "Error: no upstream configured",
        source: "Git Push",
      }),
    );
  });
  it("refreshes Git status after external deletes so stale unversioned files disappear", async () => {
    let publishFileChange: ((event: WorkspaceFileChangeEvent) => void) | null = null;
    let filesDeleted = false;
    const firstUnversioned = {
      ...gitChangedFile("tmp/first.txt", false),
      isUnversioned: true,
      status: "untracked" as const,
    };
    const secondUnversioned = {
      ...gitChangedFile("tmp/second.txt", false),
      isUnversioned: true,
      status: "untracked" as const,
    };
    const gitGateway = fileHistoryGitGateway({});
    gitGateway.getStatus = vi.fn(async (rootPath) => ({
      branch: "main",
      changes: filesDeleted ? [] : [firstUnversioned, secondUnversioned],
      isRepository: true,
      rootPath,
    }));
    const workspaceFileChangeGateway: WorkbenchWorkspaceGateways["fileChanges"] = {
      startWatching: vi.fn(async () => undefined),
      subscribeFileChanges: vi.fn(async (listener) => {
        publishFileChange = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      gitGateway,
      workspaceFileChangeGateway,
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setSidebarView("git");
    });
    await flushAsyncTurns();

    expect(getWorkbench().gitStatus.changes).toEqual([firstUnversioned, secondUnversioned]);

    filesDeleted = true;
    await act(async () => {
      publishFileChange?.({
        kind: "deleted",
        path: "/workspace/tmp/first.txt",
        relativePath: "tmp/first.txt",
        rootPath: "/workspace",
      });
      publishFileChange?.({
        kind: "deleted",
        path: "/workspace/tmp/second.txt",
        relativePath: "tmp/second.txt",
        rootPath: "/workspace",
      });
      await flushAsyncTurns();
    });

    await flushWorkspaceDirectoryRefresh();

    expect(gitGateway.getStatus).toHaveBeenCalledTimes(2);
    expect(getWorkbench().gitStatus.changes).toEqual([]);
  });
  it("lists, switches, and creates branches only in the active workspace", async () => {
    const branchList = vi.fn(async (rootPath: string) =>
      rootPath === "/workspace-b"
        ? [
            { isCurrent: true, name: "main" },
            { isCurrent: false, name: "feature/login" },
          ]
        : [{ isCurrent: true, name: "workspace-a-only" }],
    );
    const createBranch = vi.fn(async () => undefined);
    const switchBranch = vi.fn(async () => undefined);
    const gitGateway = fileHistoryGitGateway({});
    gitGateway.branchList = branchList;
    gitGateway.createBranch = createBranch;
    gitGateway.switchBranch = switchBranch;
    const prompt = vi.fn(() => "  feature/retry  ");
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-b",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      gitGateway,
      prompter: { confirm: vi.fn(() => true), prompt },
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openGitBranchPanel();
    });

    expect(getWorkbench().gitBranchPanelOpen).toBe(true);
    expect(getWorkbench().gitBranchEntries.map((branch) => branch.name)).toEqual([
      "main",
      "feature/login",
    ]);
    expect(branchList).toHaveBeenCalledWith("/workspace-b");
    expect(branchList).not.toHaveBeenCalledWith("/workspace-a");

    await act(async () => {
      await getWorkbench().switchGitBranch(" feature/login ");
    });

    expect(switchBranch).toHaveBeenCalledWith("/workspace-b", "feature/login");
    expect(getWorkbench().gitBranchPanelOpen).toBe(false);
    expect(getWorkbench().gitBranchLoading).toBe(false);

    await act(async () => {
      await getWorkbench().createGitBranch();
    });

    expect(prompt).toHaveBeenCalledWith("New branch name", "feature/");
    expect(createBranch).toHaveBeenCalledWith("/workspace-b", "feature/retry");
    expect(branchList).toHaveBeenLastCalledWith("/workspace-b");
    expect(getWorkbench().gitBranchLoading).toBe(false);
    expect(getWorkbench().message).toBe("Created branch feature/retry");
  });
  it("toggles blame and provides blame for the active workspace file only", async () => {
    const blame = vi.fn(async () => [
      {
        author: "Alice",
        lineNumber: 1,
        sha: "abc123",
        summary: "Add user",
        timestamp: 1700000000,
      },
    ]);
    const gitGateway = fileHistoryGitGateway({});
    gitGateway.blame = blame;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-b",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      gitGateway,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry("/workspace-b/src/User.php", "User.php"));
    });
    act(() => {
      getWorkbench().toggleGitBlame();
    });

    expect(getWorkbench().isActiveDocumentGitBlameEnabled).toBe(true);

    const blameLines = await getWorkbench().provideGitBlame("/workspace-b/src/User.php");
    const outsideWorkspace = await getWorkbench().provideGitBlame("/workspace-a/src/User.php");

    expect(blame).toHaveBeenCalledWith("/workspace-b", "src/User.php");
    expect(blame).not.toHaveBeenCalledWith("/workspace-a", "src/User.php");
    expect(blameLines).toHaveLength(1);
    expect(outsideWorkspace).toEqual([]);
  });
  it("reuses a clean preview tab for search result opens", async () => {
    const { getWorkbench } = renderController();
    const firstFile = fileEntry("/workspace/src/First.php", "First.php");
    const secondFile = fileEntry("/workspace/src/Second.php", "Second.php");

    await act(async () => {
      await getWorkbench().previewFile(firstFile);
    });
    await act(async () => {
      await getWorkbench().openSearchResult({
        name: secondFile.name,
        path: secondFile.path,
        relativePath: "src/Second.php",
      });
    });

    expect(getWorkbench().activePath).toBe(secondFile.path);
    expect(getWorkbench().previewPath).toBe(secondFile.path);
    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([
      secondFile.path,
    ]);
  });
  it("keeps a dirty editor tab when opening another file", async () => {
    const { getWorkbench } = renderController();
    const dirtyFile = fileEntry("/workspace/src/Dirty.php", "Dirty.php");
    const nextFile = fileEntry("/workspace/src/Next.php", "Next.php");

    await act(async () => {
      await getWorkbench().previewFile(dirtyFile);
    });
    act(() => {
      getWorkbench().updateActiveDocument("<?php\nfinal class DirtyChanged {}\n");
    });
    await act(async () => {
      await getWorkbench().openSearchResult({
        name: nextFile.name,
        path: nextFile.path,
        relativePath: "src/Next.php",
      });
    });

    expect(getWorkbench().activePath).toBe(nextFile.path);
    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([
      dirtyFile.path,
      nextFile.path,
    ]);
    expect(getWorkbench().dirtyCount).toBe(1);
  });
  it("keeps a double-click pinned tab when another file opens", async () => {
    const { getWorkbench } = renderController();
    const pinnedFile = fileEntry("/workspace/src/Pinned.php", "Pinned.php");
    const nextFile = fileEntry("/workspace/src/Next.php", "Next.php");

    await act(async () => {
      await getWorkbench().openPinnedFile(pinnedFile);
    });
    await act(async () => {
      await getWorkbench().openSearchResult({
        name: nextFile.name,
        path: nextFile.path,
        relativePath: "src/Next.php",
      });
    });

    expect(getWorkbench().activePath).toBe(nextFile.path);
    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([
      pinnedFile.path,
      nextFile.path,
    ]);
  });
  it("syncs preview documents with the language server", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 1,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      runtimeStatus: runningStatus,
    });
    const previewFile = fileEntry("/workspace/src/Preview.php", "Preview.php");

    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().previewFile(previewFile);
    });
    await flushAsyncTurns();

    expect(dependencies.documentSyncGateway.didOpen).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({ path: previewFile.path }),
      1,
    );
  });
  it("keeps restored workspaces lightweight in editor mode", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
    });
    await flushAsyncTurns();

    expect(getWorkbench().intelligenceMode).toBe("basic");
    expect(dependencies.indexProgressGateway.startInitialMetadataScan).not.toHaveBeenCalled();
    expect(dependencies.languageServerRuntimeGateway.start).not.toHaveBeenCalled();
  });
  it("does not restore the terminal bottom panel on startup", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        session: {
          activePath: null,
          bottomPanelView: "terminal",
          openPaths: [],
          sidebarView: "files",
        },
      },
    });
    await flushAsyncTurns();

    expect(getWorkbench().bottomPanelVisible).toBe(false);
    expect(getWorkbench().bottomPanelView).toBe("problems");
  });
  it("starts indexing when a restored workspace is already in IDE mode", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns();

    expect(getWorkbench().intelligenceMode).toBe("fullSmart");
    expect(dependencies.indexProgressGateway.startInitialMetadataScan).toHaveBeenCalledWith(
      "/workspace",
    );
  });
  it("does not restart a completed index scan when returning to a cached project tab", async () => {
    let publishMetadataScanCompletion: ((event: MetadataScanCompletionEvent) => void) | null = null;
    const indexProgressGateway: IndexProgressGateway = {
      clearWorkspaceIndex: vi.fn(async (rootPath) => ({
        databasePath: "/tmp/index.sqlite",
        rootPath,
        status: "cleared" as const,
      })),
      startInitialMetadataScan: vi.fn(async (rootPath) => ({
        databasePath: `/tmp/${rootPath.replace(/\W+/g, "-")}.sqlite`,
        rootPath,
        status: "started" as const,
      })),
      startReindex: vi.fn(async (rootPath) => ({
        databasePath: `/tmp/${rootPath.replace(/\W+/g, "-")}.sqlite`,
        rootPath,
        status: "started" as const,
      })),
      subscribeIndexProgress: vi.fn(async () => () => undefined),
      subscribeMetadataScanCompletion: vi.fn(async (listener) => {
        publishMetadataScanCompletion = listener;
        return () => undefined;
      }),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      indexProgressGateway,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns();

    expect(dependencies.indexProgressGateway.startInitialMetadataScan).toHaveBeenCalledWith(
      "/workspace-a",
    );
    act(() => {
      publishMetadataScanCompletion?.({
        databasePath: "/tmp/workspace-a.sqlite",
        message: null,
        report: {
          changedFiles: 0,
          errorDetails: [],
          erroredEntries: 0,
          indexedFiles: 42,
          parsedFiles: 42,
          removedFiles: 0,
          skippedDetails: [],
          skippedEntries: 0,
          symbolsIndexed: 84,
        },
        rootPath: "/workspace-a",
        status: "completed",
      });
    });
    await flushAsyncTurns();
    expect(getWorkbench().indexProgress.status).toBe("completed");

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns();

    const initialScanCalls = vi.mocked(dependencies.indexProgressGateway.startInitialMetadataScan)
      .mock.calls;
    expect(initialScanCalls.filter(([rootPath]) => rootPath === "/workspace-a")).toHaveLength(1);
    expect(getWorkbench().indexProgress).toEqual(
      expect.objectContaining({
        indexedFiles: 42,
        rootPath: "/workspace-a",
        status: "completed",
      }),
    );
  });
  it("refreshes the PHP tree for index progress roots that only differ by a trailing slash", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await act(async () => {
      getWorkbench().setSidebarView("php");
    });
    await flushAsyncTurns();
    vi.mocked(dependencies.phpTreeGateway.getPhpTree).mockClear();
    vi.mocked(dependencies.indexProgressGateway.startInitialMetadataScan).mockResolvedValueOnce({
      databasePath: "/tmp/index.sqlite",
      rootPath: "/workspace/",
      status: "started",
    });

    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns();

    expect(dependencies.indexProgressGateway.startInitialMetadataScan).toHaveBeenCalledWith(
      "/workspace",
    );
    expect(dependencies.phpTreeGateway.getPhpTree).toHaveBeenCalledWith("/workspace");
  });
  it("ignores index start responses that belong to another workspace root", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    vi.mocked(dependencies.indexProgressGateway.startInitialMetadataScan).mockResolvedValueOnce({
      databasePath: "/tmp/index.sqlite",
      rootPath: "/other",
      status: "started",
    });

    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns();

    expect(dependencies.indexProgressGateway.startInitialMetadataScan).toHaveBeenCalledWith(
      "/workspace",
    );
    expect(getWorkbench().indexProgress).toEqual(
      expect.objectContaining({
        rootPath: null,
        status: "idle",
      }),
    );
    expect(getWorkbench().message).not.toBe("Indexing workspace.");
  });
  it("ignores reindex start responses that belong to another workspace root", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns();
    expect(getWorkbench().indexProgress).toEqual(
      expect.objectContaining({
        rootPath: "/workspace",
        status: "scanning",
      }),
    );
    vi.mocked(dependencies.indexProgressGateway.startReindex).mockResolvedValueOnce({
      databasePath: "/tmp/index.sqlite",
      rootPath: "/other",
      status: "started",
    });

    await act(async () => {
      await getWorkbench().startIndexScan();
    });
    await flushAsyncTurns();

    expect(dependencies.indexProgressGateway.startReindex).toHaveBeenCalledWith(
      "/workspace",
      "soft",
      undefined,
    );
    expect(getWorkbench().indexProgress).toEqual(
      expect.objectContaining({
        rootPath: "/workspace",
        status: "scanning",
      }),
    );
    expect(getWorkbench().message).not.toBe("Soft reindex started.");
  });
  it("applies incremental index progress for the active workspace and drops cross-root events", async () => {
    let publishIndexProgress:
      ((event: import("../../domain/indexProgress").IndexProgressEvent) => void) | null = null;
    const indexProgressGateway: IndexProgressGateway = {
      clearWorkspaceIndex: vi.fn(async (rootPath) => ({
        databasePath: "/tmp/index.sqlite",
        rootPath,
        status: "cleared" as const,
      })),
      startInitialMetadataScan: vi.fn(async (rootPath) => ({
        databasePath: "/tmp/index.sqlite",
        rootPath,
        status: "started" as const,
      })),
      startReindex: vi.fn(async (rootPath) => ({
        databasePath: "/tmp/index.sqlite",
        rootPath,
        status: "started" as const,
      })),
      subscribeIndexProgress: vi.fn(async (listener) => {
        publishIndexProgress = listener;
        return () => undefined;
      }),
      subscribeMetadataScanCompletion: vi.fn(async () => () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      indexProgressGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns();

    expect(getWorkbench().indexProgress).toEqual(
      expect.objectContaining({ rootPath: "/workspace", status: "scanning" }),
    );

    act(() => {
      publishIndexProgress?.({
        phase: "parsing",
        processedFiles: 500,
        rootPath: "/workspace",
        totalFiles: 1200,
      });
    });

    expect(getWorkbench().indexProgress).toEqual(
      expect.objectContaining({
        processedFiles: 500,
        rootPath: "/workspace",
        status: "scanning",
        totalFiles: 1200,
      }),
    );

    // A progress event for a different workspace root must never touch the active workspace's state.
    act(() => {
      publishIndexProgress?.({
        phase: "parsing",
        processedFiles: 9999,
        rootPath: "/other-workspace",
        totalFiles: 9999,
      });
    });

    expect(getWorkbench().indexProgress).toEqual(
      expect.objectContaining({
        processedFiles: 500,
        rootPath: "/workspace",
        totalFiles: 1200,
      }),
    );
  });
  it("ignores stale smart mode completions after switching project tabs", async () => {
    const smartModeUpdate = createDeferred<Awaited<ReturnType<SmartModeGateway["setMode"]>>>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    vi.mocked(dependencies.smartModeGateway.setMode).mockImplementationOnce(
      async () => smartModeUpdate.promise,
    );

    let modePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      modePromise = getWorkbench().setSmartMode("fullSmart");
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.smartModeGateway.setMode).toHaveBeenCalledWith(
        "/workspace-a",
        "fullSmart",
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      smartModeUpdate.resolve({
        message: "Workspace A mode ready",
        mode: "fullSmart",
        status: "ready",
      });
      await modePromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().intelligenceMode).toBe("basic");
    expect(getWorkbench().workspaceSettings.intelligenceMode).toBe("basic");
    expect(getWorkbench().message).not.toBe("Workspace A mode ready");
  });
  it("ignores stale smart mode errors after switching project tabs", async () => {
    const smartModeUpdate = createDeferred<Awaited<ReturnType<SmartModeGateway["setMode"]>>>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    vi.mocked(dependencies.smartModeGateway.setMode).mockImplementationOnce(
      async () => smartModeUpdate.promise,
    );

    let modePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      modePromise = getWorkbench().setSmartMode("fullSmart");
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.smartModeGateway.setMode).toHaveBeenCalledWith(
        "/workspace-a",
        "fullSmart",
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      smartModeUpdate.reject(new Error("stale smart mode"));
      await modePromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) => notice.source === "IDE Mode" && notice.message.includes("stale smart mode"),
      ),
    ).toBe(false);
  });
  it("ignores stale workspace-open smart mode errors after switching project tabs", async () => {
    const workspaceASmartMode = createDeferred<Awaited<ReturnType<SmartModeGateway["setMode"]>>>();
    let setModeCalls = 0;
    const smartModeGateway: SmartModeGateway = {
      getState: vi.fn(async () => ({
        message: "Basic",
        mode: "basic" as const,
        status: "off" as const,
      })),
      setMode: vi.fn(async (_rootPath, mode) => {
        setModeCalls += 1;

        if (setModeCalls === 1) {
          return workspaceASmartMode.promise;
        }

        return {
          message: "Updated",
          mode,
          status: "ready" as const,
        };
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      smartModeGateway,
    });
    await waitForReact(() => {
      expect(smartModeGateway.setMode).toHaveBeenCalledWith("/workspace-a", "basic");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
      expect(smartModeGateway.setMode).toHaveBeenCalledTimes(2);
      expect(smartModeGateway.setMode).toHaveBeenLastCalledWith("/workspace-b", "basic");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");

    await act(async () => {
      workspaceASmartMode.reject(new Error("stale workspace-open smart mode"));
      await Promise.resolve();
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "IDE Mode" &&
          notice.message.includes("stale workspace-open smart mode"),
      ),
    ).toBe(false);
  });
  it("ignores index clear errors after switching project tabs", async () => {
    const indexClear =
      createDeferred<Awaited<ReturnType<IndexProgressGateway["clearWorkspaceIndex"]>>>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns();
    vi.mocked(dependencies.indexProgressGateway.clearWorkspaceIndex).mockImplementationOnce(
      async () => indexClear.promise,
    );

    let modePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      modePromise = getWorkbench().setSmartMode("basic");
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.indexProgressGateway.clearWorkspaceIndex).toHaveBeenCalledWith(
        "/workspace-a",
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      indexClear.reject(new Error("stale clear"));
      await modePromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) => notice.source === "Index" && notice.message.includes("stale clear"),
      ),
    ).toBe(false);
  });
  it("ignores index clear success messages after switching project tabs", async () => {
    const indexClear =
      createDeferred<Awaited<ReturnType<IndexProgressGateway["clearWorkspaceIndex"]>>>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns();
    vi.mocked(dependencies.indexProgressGateway.clearWorkspaceIndex).mockImplementationOnce(
      async () => indexClear.promise,
    );

    let modePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      modePromise = getWorkbench().setSmartMode("basic");
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.indexProgressGateway.clearWorkspaceIndex).toHaveBeenCalledWith(
        "/workspace-a",
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      indexClear.resolve({
        databasePath: "/tmp/index.sqlite",
        rootPath: "/workspace-a",
        status: "cleared",
      });
      await modePromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Updated");
  });
  it("ignores metadata scan clear errors after switching project tabs", async () => {
    let publishMetadataScanCompletion: ((event: MetadataScanCompletionEvent) => void) | null = null;
    const indexClear =
      createDeferred<Awaited<ReturnType<IndexProgressGateway["clearWorkspaceIndex"]>>>();
    const indexProgressGateway: IndexProgressGateway = {
      clearWorkspaceIndex: vi.fn(async () => indexClear.promise),
      startInitialMetadataScan: vi.fn(async (rootPath) => ({
        databasePath: "/tmp/index.sqlite",
        rootPath,
        status: "started" as const,
      })),
      startReindex: vi.fn(async (rootPath) => ({
        databasePath: "/tmp/index.sqlite",
        rootPath,
        status: "started" as const,
      })),
      subscribeIndexProgress: vi.fn(async () => () => undefined),
      subscribeMetadataScanCompletion: vi.fn(async (listener) => {
        publishMetadataScanCompletion = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      indexProgressGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    act(() => {
      publishMetadataScanCompletion?.({
        databasePath: "/tmp/index.sqlite",
        message: null,
        report: null,
        rootPath: "/workspace-a",
        status: "completed",
      });
    });
    await waitForReact(() => {
      expect(indexProgressGateway.clearWorkspaceIndex).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      indexClear.reject(new Error("stale metadata clear"));
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) => notice.source === "Index" && notice.message.includes("stale metadata clear"),
      ),
    ).toBe(false);
  });
  it("ignores stale metadata scan subscription errors after switching project tabs", async () => {
    const subscription = createDeferred<() => void>();
    const indexProgressGateway: IndexProgressGateway = {
      clearWorkspaceIndex: vi.fn(async (rootPath) => ({
        databasePath: "/tmp/index.sqlite",
        rootPath,
        status: "cleared" as const,
      })),
      startInitialMetadataScan: vi.fn(async (rootPath) => ({
        databasePath: "/tmp/index.sqlite",
        rootPath,
        status: "started" as const,
      })),
      startReindex: vi.fn(async (rootPath) => ({
        databasePath: "/tmp/index.sqlite",
        rootPath,
        status: "started" as const,
      })),
      subscribeIndexProgress: vi.fn(async () => () => undefined),
      subscribeMetadataScanCompletion: vi
        .fn()
        .mockImplementationOnce(async () => subscription.promise)
        .mockImplementation(async () => () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      indexProgressGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    act(() => {
      subscription.reject(new Error("stale metadata subscription"));
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Error: stale metadata subscription");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Index" && notice.message.includes("stale metadata subscription"),
      ),
    ).toBe(false);
  });
  it("ignores stale PHP language server plan results after switching project tabs", async () => {
    const workspaceAPlan = createDeferred<LanguageServerPlan>();
    const workspaceBPlan: LanguageServerPlan = {
      ...phpactorLanguageServerPlan(),
      message: "PHPactor B ready",
    };
    const languageServerGateway: LanguageServerGateway = {
      planJavaScriptTypeScriptLanguageServer: vi.fn(
        async () =>
          ({
            command: null,
            initializeRequest: null,
            message: "JavaScript/TypeScript language server unavailable in test.",
            provider: "typeScriptLanguageServer" as const,
            status: "unavailable" as const,
          }) satisfies LanguageServerPlan,
      ),
      planPhpLanguageServer: vi.fn(async (rootPath) => {
        if (rootPath === "/workspace-a") {
          return workspaceAPlan.promise;
        }

        return workspaceBPlan;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      // IDE mode keeps the open-time PHP plan refresh active so the
      // stale-switch isolation guard is exercised (deferred in basic mode).
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await waitForReact(() => {
      expect(languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
        "/workspace-a",
        defaultPhpLanguageServerOptions(),
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
      expect(languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
        "/workspace-b",
        defaultPhpLanguageServerOptions(),
      );
    });

    await act(async () => {
      workspaceAPlan.resolve({
        ...phpactorLanguageServerPlan(),
        message: "PHPactor A ready",
      });
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().languageServerPlan?.message).toBe("PHPactor B ready");
  });
  it("ignores stale PHP language server plan errors after switching project tabs", async () => {
    const workspaceAPlan = createDeferred<LanguageServerPlan>();
    const workspaceBPlan: LanguageServerPlan = {
      ...phpactorLanguageServerPlan(),
      message: "PHPactor B ready",
    };
    const languageServerGateway: LanguageServerGateway = {
      planJavaScriptTypeScriptLanguageServer: vi.fn(
        async () =>
          ({
            command: null,
            initializeRequest: null,
            message: "JavaScript/TypeScript language server unavailable in test.",
            provider: "typeScriptLanguageServer" as const,
            status: "unavailable" as const,
          }) satisfies LanguageServerPlan,
      ),
      planPhpLanguageServer: vi.fn(async (rootPath) => {
        if (rootPath === "/workspace-a") {
          return workspaceAPlan.promise;
        }

        return workspaceBPlan;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      // IDE mode keeps the open-time PHP plan refresh active so the
      // stale-switch isolation guard is exercised (deferred in basic mode).
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await waitForReact(() => {
      expect(languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
        "/workspace-a",
        defaultPhpLanguageServerOptions(),
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
      expect(languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
        "/workspace-b",
        defaultPhpLanguageServerOptions(),
      );
    });

    await act(async () => {
      workspaceAPlan.reject(new Error("stale PHP plan"));
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().languageServerPlan?.message).toBe("PHPactor B ready");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" && notice.message.includes("stale PHP plan"),
      ),
    ).toBe(false);
  });
  it("starts the managed PHPactor install without blocking on completion", async () => {
    const { phpTools, emitCompletion } = createManagedPhpactorInstallHarness({
      installManagedPhpactor: vi.fn(async () => undefined),
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: {
          executable: "phpactor",
          path: "/managed/vendor/bin/phpactor",
          source: "managed" as const,
        },
      })),
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      phpToolGateway: phpTools,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    let installPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      installPromise = getWorkbench().installManagedPhpactor();
    });

    // The install invoke resolves immediately (work is scheduled on a
    // background thread) and the indicator stays busy while we wait for the
    // completion event.
    await act(async () => {
      await installPromise;
    });
    expect(phpTools.installManagedPhpactor).toHaveBeenCalledWith("/workspace");
    expect(getWorkbench().installingManagedPhpactor).toBe(true);

    // Re-detection only happens once the background install reports completion.
    vi.mocked(phpTools.detectPhpTools).mockClear();

    await act(async () => {
      emitCompletion({ root: "/workspace", error: null });
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(phpTools.detectPhpTools).toHaveBeenCalledWith("/workspace");
    expect(getWorkbench().installingManagedPhpactor).toBe(false);
    expect(getWorkbench().message).toBe("Installed managed PHP IDE engine.");
  });
  it("ignores managed PHPactor install completion after switching project tabs", async () => {
    const { phpTools, emitCompletion } = createManagedPhpactorInstallHarness();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      phpToolGateway: phpTools,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().installManagedPhpactor();
    });
    await waitForReact(() => {
      expect(phpTools.installManagedPhpactor).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();
    expect(getWorkbench().installingManagedPhpactor).toBe(false);

    vi.mocked(phpTools.detectPhpTools).mockClear();

    await act(async () => {
      emitCompletion({ root: "/workspace-a", error: null });
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Installed managed PHP IDE engine.");
    // The stale completion never triggers re-detection for the abandoned root.
    expect(phpTools.detectPhpTools).not.toHaveBeenCalledWith("/workspace-a");
  });
  it("ignores managed PHPactor install errors after switching project tabs", async () => {
    const { phpTools, emitCompletion } = createManagedPhpactorInstallHarness();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      phpToolGateway: phpTools,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().installManagedPhpactor();
    });
    await waitForReact(() => {
      expect(phpTools.installManagedPhpactor).toHaveBeenCalledOnce();
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(getWorkbench().installingManagedPhpactor).toBe(false);

    await act(async () => {
      emitCompletion({ root: "/workspace-a", error: "stale managed install" });
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" && notice.message.includes("stale managed install"),
      ),
    ).toBe(false);
  });
  it("reports managed PHPactor install failures for the active workspace", async () => {
    const { phpTools, emitCompletion } = createManagedPhpactorInstallHarness();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      phpToolGateway: phpTools,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().installManagedPhpactor();
    });
    await waitForReact(() => {
      expect(getWorkbench().installingManagedPhpactor).toBe(true);
    });

    // A failed install must not run re-detection for the workspace.
    vi.mocked(phpTools.detectPhpTools).mockClear();

    await act(async () => {
      emitCompletion({
        root: "/workspace",
        error: "composer require failed",
      });
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().installingManagedPhpactor).toBe(false);
    expect(phpTools.detectPhpTools).not.toHaveBeenCalled();
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" && notice.message.includes("composer require failed"),
      ),
    ).toBe(true);
  });
  it("clears managed PHPactor install loading when the last project tab closes", async () => {
    const { phpTools, emitCompletion } = createManagedPhpactorInstallHarness();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      phpToolGateway: phpTools,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().installManagedPhpactor();
    });
    await waitForReact(() => {
      expect(phpTools.installManagedPhpactor).toHaveBeenCalledOnce();
      expect(getWorkbench().installingManagedPhpactor).toBe(true);
    });

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBeNull();
    expect(getWorkbench().installingManagedPhpactor).toBe(false);

    await act(async () => {
      emitCompletion({ root: "/workspace", error: null });
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBeNull();
    expect(getWorkbench().message).toBeNull();
    expect(getWorkbench().installingManagedPhpactor).toBe(false);
  });
  it("ignores manual PHP language server start errors after switching project tabs", async () => {
    const languageServerStart = createDeferred<LanguageServerRuntimeStatus>();
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      openLog: vi.fn(async () => null),
      start: vi.fn(async () => languageServerStart.promise),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerRuntimeGateway,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns();

    let startPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      startPromise = getWorkbench().startLanguageServer();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(languageServerRuntimeGateway.start).toHaveBeenCalledWith(
        "/workspace-a",
        defaultPhpLanguageServerOptions(),
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      languageServerStart.reject(new Error("stale PHP start"));
      await startPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" && notice.message.includes("stale PHP start"),
      ),
    ).toBe(false);
  });
  it("ignores manual PHP language server stop errors after switching project tabs", async () => {
    const languageServerStop = createDeferred<LanguageServerRuntimeStatus>();
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => ({
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running" as const,
        rootPath,
        sessionId: 42,
      })),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => ({
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running" as const,
        rootPath,
        sessionId: 42,
      })),
      stop: vi.fn(async () => languageServerStop.promise),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerRuntimeGateway,
    });
    await flushAsyncTurns();

    let stopPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      stopPromise = getWorkbench().stopLanguageServer();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(languageServerRuntimeGateway.stop).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      languageServerStop.reject(new Error("stale PHP stop"));
      await stopPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" && notice.message.includes("stale PHP stop"),
      ),
    ).toBe(false);
  });
  it("ignores stale PHP language server status errors after switching project tabs", async () => {
    const workspaceAStatus = createDeferred<LanguageServerRuntimeStatus>();
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => {
        if (rootPath === "/workspace-a") {
          return workspaceAStatus.promise;
        }

        return {
          kind: "stopped" as const,
          rootPath,
        };
      }),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => ({
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running" as const,
        rootPath,
        sessionId: 43,
      })),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerRuntimeGateway,
    });
    await waitForReact(() => {
      expect(languageServerRuntimeGateway.getStatus).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
      expect(languageServerRuntimeGateway.getStatus).toHaveBeenCalledWith("/workspace-b");
    });

    await act(async () => {
      workspaceAStatus.reject(new Error("stale PHP status"));
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" && notice.message.includes("stale PHP status"),
      ),
    ).toBe(false);
  });
  it("starts IDE services when a restored PHP workspace is already in IDE mode", async () => {
    const languageServerPlan: LanguageServerPlan = {
      command: {
        args: ["language-server"],
        executable: "phpactor",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "PHPactor is ready.",
      provider: "phpactor",
      status: "ready",
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerPlan,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns();

    expect(getWorkbench().intelligenceMode).toBe("fullSmart");
    expect(dependencies.indexProgressGateway.startInitialMetadataScan).toHaveBeenCalledWith(
      "/workspace",
    );
    expect(dependencies.languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
      "/workspace",
      defaultPhpLanguageServerOptions(),
    );
    expect(dependencies.languageServerRuntimeGateway.start).toHaveBeenCalledWith(
      "/workspace",
      defaultPhpLanguageServerOptions(),
    );
  });
  it("passes workspace PHP language server settings to plan and autostart", async () => {
    const phpOptions: PhpLanguageServerPlanOptions = {
      intelephensePath: "/tools/intelephense",
      phpBackend: "phpactor",
      phpactorPath: "/tools/phpactor",
    };
    const { dependencies } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerPlan: phpactorLanguageServerPlan(),
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
        ...phpOptions,
      },
    });
    await flushAsyncTurns(24);

    expect(dependencies.languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
      "/workspace",
      phpOptions,
    );
    expect(dependencies.languageServerRuntimeGateway.start).toHaveBeenCalledWith(
      "/workspace",
      phpOptions,
    );
  });
  it("retries restored PHP IDE service autostart when startup rejects once", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 89,
    };
    const start = vi.fn<LanguageServerRuntimeGateway["start"]>(async () => runningStatus);
    start.mockRejectedValueOnce(new Error("PHPactor boot race"));
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      openLog: vi.fn(async () => null),
      start,
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerPlan: phpactorLanguageServerPlan(),
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(36);

    expect(dependencies.languageServerRuntimeGateway.start).toHaveBeenCalledTimes(2);
    expect(getWorkbench().languageServerRuntimeStatus).toEqual(
      expect.objectContaining({
        kind: "running",
        rootPath: "/workspace",
        sessionId: 89,
      }),
    );
  });
  it("ignores stale PHP IDE service autostart errors after switching project tabs", async () => {
    const workspaceAStart = createDeferred<LanguageServerRuntimeStatus>();
    const workspaceBStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace-b",
      sessionId: 91,
    };
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) =>
        rootPath === "/workspace-a" ? workspaceAStart.promise : workspaceBStatus,
      ),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerPlan: phpactorLanguageServerPlan(),
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await waitForReact(() => {
      expect(dependencies.languageServerRuntimeGateway.start).toHaveBeenCalledWith(
        "/workspace-a",
        defaultPhpLanguageServerOptions(),
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    act(() => {
      workspaceAStart.reject(new Error("stale PHP autostart"));
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Error: stale PHP autostart");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" && notice.message.includes("stale PHP autostart"),
      ),
    ).toBe(false);
  });
  it("retries restored PHP IDE service autostart when startup crashes once", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 90,
    };
    const start = vi
      .fn<LanguageServerRuntimeGateway["start"]>(async () => runningStatus)
      .mockResolvedValueOnce({
        kind: "crashed" as const,
        message: "PHPactor startup race",
        rootPath: "/workspace",
      });
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      openLog: vi.fn(async () => null),
      start,
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerPlan: phpactorLanguageServerPlan(),
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(36);

    expect(dependencies.languageServerRuntimeGateway.start).toHaveBeenCalledTimes(2);
    expect(getWorkbench().languageServerRuntimeStatus).toEqual(
      expect.objectContaining({
        kind: "running",
        rootPath: "/workspace",
        sessionId: 90,
      }),
    );
  });
  it("retries restored PHP IDE service autostart after a rootless running response", async () => {
    const rootlessRunningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      sessionId: 91,
    };
    const rootedRunningStatus: LanguageServerRuntimeStatus = {
      ...rootlessRunningStatus,
      rootPath: "/workspace",
      sessionId: 92,
    };
    const start = vi
      .fn<LanguageServerRuntimeGateway["start"]>(async () => rootedRunningStatus)
      .mockResolvedValueOnce(rootlessRunningStatus);
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      openLog: vi.fn(async () => null),
      start,
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerPlan: phpactorLanguageServerPlan(),
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(36);

    expect(dependencies.languageServerRuntimeGateway.start).toHaveBeenCalledTimes(2);
    expect(getWorkbench().languageServerRuntimeStatus).toEqual(
      expect.objectContaining({
        kind: "running",
        rootPath: "/workspace",
        sessionId: 92,
      }),
    );
  });
  it("auto-starts PHP IDE services while initial runtime status is still unknown", async () => {
    const languageServerPlan: LanguageServerPlan = {
      command: {
        args: ["language-server"],
        executable: "phpactor",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "PHPactor is ready.",
      provider: "phpactor",
      status: "ready",
    };
    const pendingStatus = createDeferred<LanguageServerRuntimeStatus>();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 88,
    };
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => pendingStatus.promise),
      openLog: vi.fn(async () => null),
      start: vi.fn(async () => runningStatus),
      stop: vi.fn(async () => ({ kind: "stopped" as const })),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      languageServerPlan,
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().intelligenceMode).toBe("fullSmart");
    expect(dependencies.languageServerRuntimeGateway.start).toHaveBeenCalledWith(
      "/workspace",
      defaultPhpLanguageServerOptions(),
    );

    await act(async () => {
      pendingStatus.resolve(runningStatus);
      await Promise.resolve();
    });
  });
  it("starts JavaScript and TypeScript language service in Basic mode", async () => {
    const javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan = {
      command: {
        args: ["--stdio"],
        executable: "typescript-language-server",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "TypeScript language server is ready.",
      provider: "typeScriptLanguageServer",
      status: "ready",
    };
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
        definition: true,
        hover: true,
        inlayHint: true,
      },
      kind: "running",
      sessionId: 12,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
      },
      javaScriptTypeScriptLanguageServerPlan,
      javaScriptTypeScriptRuntimeStatus,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await flushAsyncTurns(24);
    });

    expect(getWorkbench().intelligenceMode).toBe("basic");
    expect(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
      validationEnabled: true,
    });
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
      validationEnabled: true,
    });
    expect(dependencies.languageServerRuntimeGateway.start).not.toHaveBeenCalled();
  });
  it("starts only the trusted project's JavaScript and TypeScript service after trust is granted", async () => {
    const trustedRoots = new Set<string>();
    const workspaceTrustGateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath) => ({
        rootPath,
        trusted: trustedRoots.has(rootPath),
      })),
      setTrust: vi.fn(async (rootPath, trusted) => {
        if (trusted) {
          trustedRoots.add(rootPath);
        }

        if (!trusted) {
          trustedRoots.delete(rootPath);
        }

        return { rootPath, trusted };
      }),
    };
    const languageServerGateway: LanguageServerGateway = {
      planJavaScriptTypeScriptLanguageServer: vi.fn(async (rootPath) =>
        trustedRoots.has(rootPath)
          ? readyJavaScriptTypeScriptPlan(rootPath)
          : {
              command: null,
              initializeRequest: null,
              message: "Trust this workspace to start TypeScript.",
              provider: "typeScriptLanguageServer" as const,
              status: "unavailable" as const,
            },
      ),
      planPhpLanguageServer: vi.fn(),
    };
    const workspaceDetectionGateway: WorkbenchWorkspaceGateways["detection"] = {
      detectWorkspace: vi.fn(async (rootPath) => ({
        ...javaScriptTypeScriptWorkspaceDescriptor(),
        rootPath,
      })),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptRuntimeStatus: {
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running",
        sessionId: 41,
      },
      languageServerGateway,
      workspaceDetectionGateway,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
        javaScriptTypeScriptService: "auto",
      },
      workspaceTrustGateway,
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceTrust).toEqual({
        rootPath: "/workspace-a",
        trusted: false,
      });
    });
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).not.toHaveBeenCalled();

    await act(async () => {
      await getWorkbench().toggleWorkspaceTrust();
    });
    await waitForReact(() => {
      expect(
        dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
      ).toHaveBeenCalledWith("/workspace-a", expect.any(Object));
    });

    expect(
      vi
        .mocked(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start)
        .mock.calls.map(([rootPath]) => rootPath),
    ).toEqual(["/workspace-a"]);
    expect(
      vi
        .mocked(languageServerGateway.planJavaScriptTypeScriptLanguageServer)
        .mock.calls.some(([rootPath]) => rootPath === "/workspace-b"),
    ).toBe(false);
    expect(dependencies.languageServerRuntimeGateway.start).not.toHaveBeenCalled();
  });
  it("stops both current project language runtimes when settings revoke trust", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceTrust?.trusted).toBe(true);
    });
    vi.mocked(dependencies.languageServerRuntimeGateway.stop).mockClear();
    vi.mocked(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).mockClear();

    await act(async () => {
      await getWorkbench().saveWorkbenchSettings(
        getWorkbench().appSettings,
        getWorkbench().workspaceSettings,
        false,
      );
    });

    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledWith("/workspace-a");
    expect(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalledWith("/workspace-b");
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).not.toHaveBeenCalledWith("/workspace-b");
  });
  it("deduplicates overlapping trust and settings grants before TypeScript autostart", async () => {
    const trustedRoots = new Set<string>();
    const trustedPlan = createDeferred<LanguageServerPlan>();
    const appSettings = {
      ...defaultAppSettings(),
      recentWorkspacePath: "/workspace",
    };
    const workspaceSettings = {
      ...defaultWorkspaceSettings(),
      intelligenceMode: "basic" as const,
      javaScriptTypeScriptService: "auto" as const,
    };
    const languageServerGateway: LanguageServerGateway = {
      planJavaScriptTypeScriptLanguageServer: vi.fn(async (rootPath) => {
        if (!trustedRoots.has(rootPath)) {
          return {
            command: null,
            initializeRequest: null,
            message: "Trust this workspace to start TypeScript.",
            provider: "typeScriptLanguageServer" as const,
            status: "unavailable" as const,
          };
        }

        return trustedPlan.promise;
      }),
      planPhpLanguageServer: vi.fn(),
    };
    const workspaceTrustGateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath) => ({ rootPath, trusted: false })),
      setTrust: vi.fn(async (rootPath, trusted) => {
        if (trusted) {
          trustedRoots.add(rootPath);
        }

        return { rootPath, trusted };
      }),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings,
      languageServerGateway,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      workspaceSettings,
      workspaceTrustGateway,
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceTrust?.trusted).toBe(false);
    });
    vi.mocked(languageServerGateway.planJavaScriptTypeScriptLanguageServer).mockClear();

    let togglePromise: Promise<void> | null = null;
    let settingsPromise: Promise<void> | null = null;
    await act(async () => {
      togglePromise = getWorkbench().toggleWorkspaceTrust();
      settingsPromise = getWorkbench().saveWorkbenchSettings(appSettings, workspaceSettings, true);
      await flushAsyncTurns(24);
    });

    expect(languageServerGateway.planJavaScriptTypeScriptLanguageServer).toHaveBeenCalledTimes(1);

    await act(async () => {
      trustedPlan.resolve(readyJavaScriptTypeScriptPlan("/workspace"));
      await Promise.all([togglePromise, settingsPromise]);
      await flushAsyncTurns(24);
    });

    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledTimes(1);
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", expect.any(Object));
  });
  it("keeps the latest TypeScript preference when trust plans overlap", async () => {
    const bundledPlan = createDeferred<LanguageServerPlan>();
    const workspacePlan = createDeferred<LanguageServerPlan>();
    const trustedRoots = new Set<string>();
    let workspacePlanRequests = 0;
    const appSettings = {
      ...defaultAppSettings(),
      recentWorkspacePath: "/workspace",
    };
    const bundledSettings = {
      ...defaultWorkspaceSettings(),
      intelligenceMode: "basic" as const,
      javaScriptTypeScriptService: "auto" as const,
      javaScriptTypeScriptVersion: "bundled" as const,
    };
    const workspaceSettings = {
      ...bundledSettings,
      javaScriptTypeScriptVersion: "workspace" as const,
    };
    const languageServerGateway: LanguageServerGateway = {
      planJavaScriptTypeScriptLanguageServer: vi.fn(async (rootPath, options) => {
        if (!trustedRoots.has(rootPath)) {
          return {
            command: null,
            initializeRequest: null,
            message: "Trust this workspace to start TypeScript.",
            provider: "typeScriptLanguageServer" as const,
            status: "unavailable" as const,
          };
        }

        if (options.typeScriptVersionPreference === "bundled") {
          return bundledPlan.promise;
        }

        workspacePlanRequests += 1;
        if (workspacePlanRequests === 1) {
          return workspacePlan.promise;
        }

        return {
          ...readyJavaScriptTypeScriptPlan(rootPath),
          message: "Workspace TypeScript plan.",
        };
      }),
      planPhpLanguageServer: vi.fn(),
    };
    const workspaceTrustGateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath) => ({ rootPath, trusted: false })),
      setTrust: vi.fn(async (rootPath, trusted) => {
        if (trusted) {
          trustedRoots.add(rootPath);
        }

        return { rootPath, trusted };
      }),
    };
    const { getWorkbench } = renderController({
      appSettings,
      languageServerGateway,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      workspaceSettings: bundledSettings,
      workspaceTrustGateway,
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceTrust?.trusted).toBe(false);
    });
    vi.mocked(languageServerGateway.planJavaScriptTypeScriptLanguageServer).mockClear();

    let togglePromise: Promise<void> | null = null;
    let settingsPromise: Promise<void> | null = null;
    await act(async () => {
      togglePromise = getWorkbench().toggleWorkspaceTrust();
      await flushAsyncTurns(12);
      settingsPromise = getWorkbench().saveWorkbenchSettings(appSettings, workspaceSettings, true);
      await flushAsyncTurns(24);
    });

    expect(
      vi
        .mocked(languageServerGateway.planJavaScriptTypeScriptLanguageServer)
        .mock.calls.map(([, options]) => options?.typeScriptVersionPreference),
    ).toEqual(["bundled", "workspace"]);

    await act(async () => {
      workspacePlan.resolve({
        ...readyJavaScriptTypeScriptPlan("/workspace"),
        message: "Workspace TypeScript plan.",
      });
      await flushAsyncTurns(24);
      bundledPlan.resolve({
        ...readyJavaScriptTypeScriptPlan("/workspace"),
        message: "Bundled TypeScript plan.",
      });
      await Promise.all([togglePromise, settingsPromise]);
      await flushAsyncTurns(24);
    });

    expect(getWorkbench().javaScriptTypeScriptLanguageServerPlan?.message).toBe(
      "Workspace TypeScript plan.",
    );
    expect(
      vi.mocked(languageServerGateway.planJavaScriptTypeScriptLanguageServer).mock.calls[
        vi.mocked(languageServerGateway.planJavaScriptTypeScriptLanguageServer).mock.calls.length -
          1
      ]?.[1]?.typeScriptVersionPreference,
    ).toBe("workspace");
  });
});
