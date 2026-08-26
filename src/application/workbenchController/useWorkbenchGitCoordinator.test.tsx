import { describe, expect, it, vi } from "vitest";
import { refreshGitStatusAfterCommitEvent } from "./useWorkbenchGitCoordinator";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function commitEvent(rootPath: unknown, subject: unknown): Event {
  return new CustomEvent("mockor-git-commit-reworded", {
    detail: { rootPath, subject },
  });
}

describe("refreshGitStatusAfterCommitEvent", () => {
  it("drops a reword completion after an A to B to A workspace replacement", async () => {
    const refresh = deferred();
    const currentWorkspaceRootRef = { current: "/workspace/one" };
    const workspaceRequestTokenRef = { current: 1 };
    const refreshGitStatus = vi.fn(() => refresh.promise);
    const setMessage = vi.fn();

    const completion = refreshGitStatusAfterCommitEvent(
      commitEvent("/workspace/one", "Rename commit"),
      "Reworded",
      { currentWorkspaceRootRef, refreshGitStatus, setMessage, workspaceRequestTokenRef },
    );
    expect(refreshGitStatus).toHaveBeenCalledOnce();

    currentWorkspaceRootRef.current = "/workspace/two";
    workspaceRequestTokenRef.current = 2;
    currentWorkspaceRootRef.current = "/workspace/one";
    workspaceRequestTokenRef.current = 3;
    refresh.resolve();
    await completion;

    expect(setMessage).not.toHaveBeenCalled();
  });

  it("rejects malformed and stale events before refreshing", async () => {
    const currentWorkspaceRootRef = { current: "/workspace/two" };
    const workspaceRequestTokenRef = { current: 1 };
    const refreshGitStatus = vi.fn(async () => {});
    const setMessage = vi.fn();

    await refreshGitStatusAfterCommitEvent(
      commitEvent("/workspace/one", "Rename commit"),
      "Reworded",
      { currentWorkspaceRootRef, refreshGitStatus, setMessage, workspaceRequestTokenRef },
    );
    await refreshGitStatusAfterCommitEvent(commitEvent(42, null), "Reworded", {
      currentWorkspaceRootRef,
      refreshGitStatus,
      setMessage,
      workspaceRequestTokenRef,
    });

    expect(refreshGitStatus).not.toHaveBeenCalled();
    expect(setMessage).not.toHaveBeenCalled();
  });

  it("publishes the commit result for the retained workspace owner", async () => {
    const currentWorkspaceRootRef = { current: "/workspace/one" };
    const workspaceRequestTokenRef = { current: 1 };
    const refreshGitStatus = vi.fn(async () => {});
    const setMessage = vi.fn();

    await refreshGitStatusAfterCommitEvent(
      commitEvent("/workspace/one", "Rename commit"),
      "Reworded",
      { currentWorkspaceRootRef, refreshGitStatus, setMessage, workspaceRequestTokenRef },
    );

    expect(refreshGitStatus).toHaveBeenCalledOnce();
    expect(setMessage).toHaveBeenCalledWith("Reworded commit: Rename commit");
  });
});
