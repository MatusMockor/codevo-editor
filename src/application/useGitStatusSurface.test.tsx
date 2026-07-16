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
import { useGitOperationCurrency } from "./useGitOperationCurrency";
import type { GitOperationCurrency } from "./useGitOperationCurrency";

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
  currency: () => GitOperationCurrency;
  reconcileSelectedGitDiffPreviewForRepository: ReturnType<typeof vi.fn>;
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
  const capturedCurrency: { currency: GitOperationCurrency | null } = {
    currency: null,
  };
  const reconcileSelectedGitDiffPreviewForRepository = vi.fn();
  const reportError = vi.fn();
  const deps: Omit<GitStatusSurfaceDependencies, "gitOperationCurrency"> = {
    activeDocument: null,
    activePath: null,
    reconcileSelectedGitDiffPreviewForRepository,
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
    setMessage: vi.fn(),
    workspaceRoot: ROOT,
  };

  function HookHarness() {
    const gitOperationCurrency = useGitOperationCurrency(deps.workspaceRoot);
    capturedCurrency.currency = gitOperationCurrency;
    captured.surface = useGitStatusSurface({ ...deps, gitOperationCurrency });
    return null;
  }

  act(() => {
    root.render(<HookHarness />);
  });

  return {
    currency: () => {
      if (!capturedCurrency.currency) {
        throw new Error("currency not mounted");
      }

      return capturedCurrency.currency;
    },
    reconcileSelectedGitDiffPreviewForRepository,
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
  it("drops a refresh issued before a later mutation reservation", async () => {
    const pending = createDeferred<GitStatus>();
    const harness = renderSurface(() => pending.promise);
    let refresh!: Promise<void>;

    act(() => {
      refresh = harness.surface().refreshGitStatus();
    });
    let mutation!: ReturnType<GitOperationCurrency["reserveOperation"]>;
    act(() => {
      mutation = harness.currency().reserveOperation([ROOT]);
    });

    await act(async () => {
      pending.resolve(status("stale-refresh"));
      await refresh;
    });

    expect(harness.surface().gitStatus.branch).toBeNull();
    expect(harness.surface().gitRepositoryStatuses).toEqual([]);
    act(() => harness.currency().releaseOperation(mutation));
    harness.unmount();
  });

  it("lets a refresh issued after a mutation become the newest status publication", async () => {
    const pending = createDeferred<GitStatus>();
    const harness = renderSurface(() => pending.promise);
    let mutation!: ReturnType<GitOperationCurrency["reserveOperation"]>;
    act(() => {
      mutation = harness.currency().reserveOperation([ROOT]);
    });
    let refresh!: Promise<void>;

    act(() => {
      refresh = harness.surface().refreshGitStatus();
    });
    expect(harness.currency().isRepositoryCurrent(mutation, ROOT)).toBe(false);

    await act(async () => {
      pending.resolve(status("newer-refresh"));
      await refresh;
      harness.currency().releaseOperation(mutation);
    });

    expect(harness.surface().gitStatus.branch).toBe("newer-refresh");
    harness.unmount();
  });

  it("does not let a stale refresh rejection clear a later mutation status", async () => {
    const pending = createDeferred<GitStatus>();
    const harness = renderSurface(() => pending.promise);
    let refresh!: Promise<void>;

    act(() => {
      refresh = harness.surface().refreshGitStatus();
    });
    let mutation!: ReturnType<GitOperationCurrency["reserveOperation"]>;
    act(() => {
      mutation = harness.currency().reserveOperation([ROOT]);
    });
    act(() => {
      harness.surface().applyGitOperationStatuses([
        {
          mapping: { rootRelativePath: "" },
          root: ROOT,
          status: status("mutation-wins"),
          failed: false,
        },
      ]);
    });

    await act(async () => {
      pending.reject(new Error("stale refresh failure"));
      await refresh;
      harness.currency().releaseOperation(mutation);
    });

    expect(harness.surface().gitStatus.branch).toBe("mutation-wins");
    expect(harness.reportError).not.toHaveBeenCalled();
    harness.unmount();
  });

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
    expect(
      harness.reconcileSelectedGitDiffPreviewForRepository,
    ).toHaveBeenCalledWith(ROOT, [selectedChange]);

    await act(async () => {
      first.resolve(status("old"));
      await firstRefresh;
    });

    expect(harness.surface().gitStatus.branch).toBe("new");
    expect(harness.surface().gitRepositoryStatuses[0]?.status.branch).toBe(
      "new",
    );
    expect(harness.reconcileSelectedGitDiffPreviewForRepository).toHaveBeenCalledTimes(1);
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
    expect(harness.reconcileSelectedGitDiffPreviewForRepository).not.toHaveBeenCalled();
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
    expect(
      harness.reconcileSelectedGitDiffPreviewForRepository,
    ).toHaveBeenCalledWith(nestedRoot, [selectedChange]);
    harness.unmount();
  });

  it("applies a nested mutation status only to the diff owned by that repository", () => {
    const nestedRoot = `${ROOT}/packages/nested`;
    const selectedChange = {
      ...changedFile("packages/nested/src/App.php"),
      path: `${nestedRoot}/src/App.php`,
      relativePath: "src/App.php",
    };
    const refreshedChange = { ...selectedChange, status: "renamed" as const };
    const harness = renderSurface(async () => status("primary"), selectedChange, nestedRoot);

    act(() => {
      harness.surface().applyGitOperationStatuses([
        {
          mapping: { rootRelativePath: "packages/nested" },
          root: nestedRoot,
          status: { ...status("nested", [refreshedChange]), rootPath: nestedRoot },
          failed: false,
        },
      ]);
    });

    expect(harness.surface().gitStatus.branch).toBeNull();
    expect(
      harness.reconcileSelectedGitDiffPreviewForRepository,
    ).toHaveBeenCalledWith(nestedRoot, [refreshedChange]);
    harness.unmount();
  });
});
