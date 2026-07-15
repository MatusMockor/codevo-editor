// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { GitChangedFile, GitGateway, GitStatus } from "../domain/git";
import { defaultWorkspaceSettings } from "../domain/settings";
import {
  useGitStatusSurface,
  type GitStatusSurfaceDependencies,
} from "./useGitStatusSurface";
import { gitDiffDocumentPath } from "./useGitDiffWorkspace";

const ROOT = "/workspace";

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    reject = promiseReject;
    resolve = promiseResolve;
  });

  return { promise, reject, resolve };
}

function changedFile(name: string): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: `${ROOT}/${name}`,
    relativePath: name,
    status: "modified",
  };
}

function status(branch: string, changes: GitChangedFile[] = []): GitStatus {
  return {
    branch,
    changes,
    isRepository: true,
    rootPath: ROOT,
  };
}

type GitStatusSurface = ReturnType<typeof useGitStatusSurface>;

interface Harness {
  closeSelectedGitDiffPreviewForChanges: ReturnType<typeof vi.fn>;
  reportError: ReturnType<typeof vi.fn>;
  surface: () => GitStatusSurface;
  unmount: () => void;
}

function renderSurface(
  getStatus: (rootPath: string) => Promise<GitStatus>,
  selectedGitChange: GitChangedFile | null = null,
  selectedRepositoryRoot = ROOT,
): Harness {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { surface: GitStatusSurface | null } = { surface: null };
  const closeSelectedGitDiffPreviewForChanges = vi.fn();
  const reportError = vi.fn();
  const deps: GitStatusSurfaceDependencies = {
    activeDocument: null,
    activePath: null,
    closeGitDiffPreview: vi.fn(),
    closeSelectedGitDiffPreviewForChanges,
    getSelectedGitDiffDocument: () => selectedGitChange
      ? {
          change: selectedGitChange,
          diff: null,
          documentPath: gitDiffDocumentPath(selectedGitChange),
          isLoading: false,
          repositoryRoot: selectedRepositoryRoot,
        }
      : null,
    currentWorkspaceRootRef: { current: ROOT },
    editorGitBaselineRequestTokenRef: { current: 0 },
    gitGateway: { getStatus } as GitGateway,
    gitRepositoryDiscoveryRequestTokenRef: { current: 0 },
    reportError,
    reportErrorForActiveWorkspaceRoot: vi.fn(),
    selectedGitChange,
    setMessage: vi.fn(),
    workspaceRoot: ROOT,
  };

  function HookHarness() {
    captured.surface = useGitStatusSurface(deps);
    return null;
  }

  act(() => {
    root.render(<HookHarness />);
  });

  return {
    closeSelectedGitDiffPreviewForChanges,
    reportError,
    surface: () => {
      if (!captured.surface) {
        throw new Error("surface not mounted");
      }

      return captured.surface;
    },
    unmount: () => {
      act(() => root.unmount());
    },
  };
}

describe("useGitStatusSurface", () => {
  it("keeps the newest same-root status and diff reconciliation when the older request resolves last", async () => {
    const first = createDeferred<GitStatus>();
    const second = createDeferred<GitStatus>();
    const selectedChange = changedFile("selected.php");
    const getStatus = vi
      .fn<(rootPath: string) => Promise<GitStatus>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const harness = renderSurface(getStatus, selectedChange);

    let firstRefresh!: Promise<void>;
    let secondRefresh!: Promise<void>;
    act(() => {
      firstRefresh = harness.surface().refreshGitStatus();
      secondRefresh = harness.surface().refreshGitStatus();
    });

    await act(async () => {
      second.resolve(status("new", [selectedChange]));
      await secondRefresh;
    });

    expect(harness.surface().gitStatus.branch).toBe("new");
    expect(harness.surface().gitLoading).toBe(false);
    expect(harness.closeSelectedGitDiffPreviewForChanges).toHaveBeenCalledWith([
      selectedChange,
    ]);

    await act(async () => {
      first.resolve(status("old"));
      await firstRefresh;
    });

    expect(harness.surface().gitStatus.branch).toBe("new");
    expect(harness.surface().gitRepositoryStatuses[0]?.status.branch).toBe(
      "new",
    );
    expect(harness.closeSelectedGitDiffPreviewForChanges).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("does not let an older same-root rejection clear loading or report while the newest request is pending", async () => {
    const first = createDeferred<GitStatus>();
    const second = createDeferred<GitStatus>();
    const getStatus = vi
      .fn<(rootPath: string) => Promise<GitStatus>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const harness = renderSurface(getStatus);

    let firstRefresh!: Promise<void>;
    let secondRefresh!: Promise<void>;
    act(() => {
      firstRefresh = harness.surface().refreshGitStatus();
      secondRefresh = harness.surface().refreshGitStatus();
    });

    await act(async () => {
      first.reject(new Error("stale failure"));
      await firstRefresh;
    });

    expect(harness.surface().gitLoading).toBe(true);
    expect(harness.reportError).not.toHaveBeenCalled();

    await act(async () => {
      second.resolve(status("new"));
      await secondRefresh;
    });

    expect(harness.surface().gitStatus.branch).toBe("new");
    expect(harness.surface().gitLoading).toBe(false);
    harness.unmount();
  });

  it("isolates request generations between hook owners", async () => {
    const firstOwnerRequest = createDeferred<GitStatus>();
    const secondOwnerRequest = createDeferred<GitStatus>();
    const firstOwner = renderSurface(() => firstOwnerRequest.promise);
    const secondOwner = renderSurface(() => secondOwnerRequest.promise);

    let firstRefresh!: Promise<void>;
    let secondRefresh!: Promise<void>;
    act(() => {
      firstRefresh = firstOwner.surface().refreshGitStatus();
      secondRefresh = secondOwner.surface().refreshGitStatus();
    });

    await act(async () => {
      secondOwnerRequest.resolve(status("second-owner"));
      await secondRefresh;
      firstOwnerRequest.resolve(status("first-owner"));
      await firstRefresh;
    });

    expect(firstOwner.surface().gitStatus.branch).toBe("first-owner");
    expect(secondOwner.surface().gitStatus.branch).toBe("second-owner");
    firstOwner.unmount();
    secondOwner.unmount();
  });

  it("invalidates an in-flight refresh when status state resets", async () => {
    const pending = createDeferred<GitStatus>();
    const selectedChange = changedFile("selected.php");
    const harness = renderSurface(() => pending.promise, selectedChange);
    let refresh!: Promise<void>;

    act(() => {
      refresh = harness.surface().refreshGitStatus();
      harness.surface().resetGitStatusSurface(ROOT);
    });

    await act(async () => {
      pending.resolve(status("stale", [selectedChange]));
      await refresh;
    });

    expect(harness.surface().gitStatus.branch).toBeNull();
    expect(harness.surface().gitRepositoryStatuses).toEqual([]);
    expect(harness.surface().gitLoading).toBe(false);
    expect(harness.closeSelectedGitDiffPreviewForChanges).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("reconciles a selected nested diff against its own repository status", async () => {
    const nestedRoot = `${ROOT}/packages/nested`;
    const selectedChange = {
      ...changedFile("packages/nested/src/App.php"),
      path: `${nestedRoot}/src/App.php`,
      relativePath: "src/App.php",
    };
    const getStatus = vi.fn(async (rootPath: string) => {
      if (rootPath === nestedRoot) {
        return { ...status("nested", [selectedChange]), rootPath };
      }

      return status("primary", []);
    });
    const harness = renderSurface(
      getStatus,
      selectedChange,
      nestedRoot,
    );

    await act(async () => {
      await harness.surface().runGitRepositoryDiscovery(ROOT, {
        ...defaultWorkspaceSettings(),
        gitDirectoryMappings: ["packages/nested"],
        gitDirectoryMappingsAuto: false,
      });
    });
    await act(async () => {
      await harness.surface().refreshGitStatus();
    });

    expect(getStatus).toHaveBeenCalledWith(ROOT);
    expect(getStatus).toHaveBeenCalledWith(nestedRoot);
    expect(harness.surface().gitStatus.branch).toBe("primary");
    expect(harness.closeSelectedGitDiffPreviewForChanges).toHaveBeenCalledWith([
      selectedChange,
    ]);
    harness.unmount();
  });
});
