// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitBranches } from "../domain/git";
import {
  BRANCH_OPERATION_IN_FLIGHT_ERROR,
  useComposerBranchPicker,
  type ComposerBranchGateway,
  type ComposerBranchItem,
  type ComposerBranchPicker,
} from "./useComposerBranchPicker";

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const branchesA: GitBranches = {
  current: "main",
  local: ["main", "feat/a"],
  remotes: { origin: ["main"] },
};
const branchesB: GitBranches = { current: "develop", local: ["develop"], remotes: {} };
const featA: ComposerBranchItem = {
  current: false,
  kind: "local",
  name: "feat/a",
  ref: "refs/heads/feat/a",
};

describe("useComposerBranchPicker", () => {
  let host: HTMLDivElement;
  let root: Root;
  let picker: ComposerBranchPicker | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    picker = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function Harness(props: {
    gateway: ComposerBranchGateway;
    repositoryRoot: string;
    guard?: () => string | null;
  }) {
    picker = useComposerBranchPicker({
      gateway: props.gateway,
      guard: props.guard ?? (() => null),
      target: { ownerKey: props.repositoryRoot, repositoryRoot: props.repositoryRoot },
    });
    return null;
  }

  function gateway(overrides: Partial<ComposerBranchGateway> = {}): ComposerBranchGateway {
    return {
      checkoutRemoteBranch: vi.fn(async () => []),
      createBranch: vi.fn(async () => undefined),
      getBranches: vi.fn(async (path: string) => (path === "/a" ? branchesA : branchesB)),
      switchBranch: vi.fn(async () => undefined),
      ...overrides,
    };
  }

  it("drops a branch list that settles after the repository changed (A -> B -> A)", async () => {
    const lateA = deferred<GitBranches>();
    const git = gateway({
      getBranches: vi.fn((path: string) =>
        path === "/a" ? lateA.promise : Promise.resolve(branchesB),
      ),
    });
    act(() => root.render(<Harness gateway={git} repositoryRoot="/a" />));
    act(() => picker?.load());
    expect(picker?.list).toEqual({ kind: "loading" });
    act(() => root.render(<Harness gateway={git} repositoryRoot="/b" />));
    await act(async () => picker?.load());
    expect(picker?.list).toEqual({ kind: "ready", branches: branchesB });
    await act(async () => lateA.resolve(branchesA));
    expect(picker?.list).toEqual({ kind: "ready", branches: branchesB });
    act(() => root.render(<Harness gateway={git} repositoryRoot="/a" />));
    expect(picker?.list).toEqual({ kind: "idle" });
  });

  it("drops a switch result that settles after the repository changed", async () => {
    const lateSwitch = deferred<void>();
    const git = gateway({ switchBranch: vi.fn(() => lateSwitch.promise) });
    act(() => root.render(<Harness gateway={git} repositoryRoot="/a" />));
    await act(async () => picker?.load());
    let switching: Promise<boolean> | undefined;
    act(() => {
      switching = picker?.switchTo(featA);
    });
    expect(picker?.pending).toBe(true);
    act(() => root.render(<Harness gateway={git} repositoryRoot="/b" />));
    expect(picker?.pending).toBe(false);
    await act(async () => picker?.load());
    await act(async () => {
      lateSwitch.resolve();
      await switching;
    });
    expect(picker?.pending).toBe(false);
    expect(picker?.list).toEqual({ kind: "ready", branches: branchesB });
    expect(git.getBranches).toHaveBeenCalledTimes(2);
  });

  it("never switches a repository to a branch listed for another repository", async () => {
    const git = gateway();
    act(() => root.render(<Harness gateway={git} repositoryRoot="/a" />));
    await act(async () => picker?.load());
    const staleSwitch = picker?.switchTo;
    act(() => root.render(<Harness gateway={git} repositoryRoot="/b" />));
    await act(async () => picker?.load());
    await act(async () => staleSwitch?.(featA));
    await act(async () => picker?.switchTo(featA));
    expect(git.switchBranch).not.toHaveBeenCalled();
    expect(picker?.error).toBe("This branch is no longer available. Refresh the branch list.");
  });

  it("refuses to switch when the guard blocks and never calls git", async () => {
    const git = gateway();
    act(() =>
      root.render(
        <Harness gateway={git} guard={() => "A thread is running here."} repositoryRoot="/a" />,
      ),
    );
    await act(async () => picker?.load());
    await act(async () => picker?.switchTo(featA));
    expect(git.switchBranch).not.toHaveBeenCalled();
    expect(picker?.error).toBe("A thread is running here.");
  });

  it("creates then switches to a valid new branch and rejects an option-looking name", async () => {
    const git = gateway();
    act(() => root.render(<Harness gateway={git} repositoryRoot="/a" />));
    await act(async () => picker?.load());
    await act(async () => picker?.create("--upload-pack=x"));
    expect(git.createBranch).not.toHaveBeenCalled();
    expect(picker?.error).not.toBeNull();
    await act(async () => picker?.create("feat/new"));
    expect(git.createBranch).toHaveBeenCalledWith("/a", "feat/new");
    expect(git.switchBranch).toHaveBeenCalledWith("/a", "feat/new");
    expect(picker?.error).toBeNull();
  });

  it("switches a remote branch through checkoutRemoteBranch with remote/name", async () => {
    const git = gateway();
    act(() => root.render(<Harness gateway={git} repositoryRoot="/a" />));
    await act(async () => picker?.load());
    await act(async () =>
      picker?.switchTo({
        current: false,
        kind: "remote",
        name: "origin/main",
        ref: "refs/remotes/origin/main",
      }),
    );
    expect(git.checkoutRemoteBranch).toHaveBeenCalledWith("/a", "origin/main");
  });

  it("refuses a second concurrent switch for a repository after A -> B -> A while the first is pending", async () => {
    const firstSwitch = deferred<void>();
    const git = gateway({ switchBranch: vi.fn(() => firstSwitch.promise) });
    act(() => root.render(<Harness gateway={git} repositoryRoot="/a" />));
    await act(async () => picker?.load());
    let first: Promise<boolean> | undefined;
    act(() => {
      first = picker?.switchTo(featA);
    });
    act(() => root.render(<Harness gateway={git} repositoryRoot="/b" />));
    act(() => root.render(<Harness gateway={git} repositoryRoot="/a" />));
    await act(async () => picker?.load());
    let second: boolean | undefined;
    await act(async () => {
      second = await picker?.switchTo(featA);
    });
    expect(second).toBe(false);
    expect(git.switchBranch).toHaveBeenCalledTimes(1);
    expect(picker?.error).toBe(BRANCH_OPERATION_IN_FLIGHT_ERROR);
    await act(async () => {
      firstSwitch.resolve();
      await first;
    });
    await act(async () => picker?.switchTo(featA));
    expect(git.switchBranch).toHaveBeenCalledTimes(2);
  });

  it("refreshes the branch list when switching to a just-created branch fails", async () => {
    const created: GitBranches = { ...branchesA, local: [...branchesA.local, "feat/new"] };
    const getBranches = vi.fn(async () => branchesA);
    const git = gateway({
      getBranches,
      createBranch: vi.fn(async () => {
        getBranches.mockImplementation(async () => created);
      }),
      switchBranch: vi.fn(async () => Promise.reject(new Error("checkout failed"))),
    });
    act(() => root.render(<Harness gateway={git} repositoryRoot="/a" />));
    await act(async () => picker?.load());
    let result: boolean | undefined;
    await act(async () => {
      result = await picker?.create("feat/new");
    });
    expect(result).toBe(false);
    expect(picker?.error).toBe("checkout failed");
    expect(picker?.list).toEqual({ kind: "ready", branches: created });
  });

  it("does not publish a failure refresh after the repository changed", async () => {
    const failedSwitch = deferred<void>();
    const getBranches = vi.fn(async (path: string) => (path === "/a" ? branchesA : branchesB));
    const git = gateway({
      getBranches,
      switchBranch: vi.fn(async () => {
        await failedSwitch.promise;
        throw new Error("checkout failed");
      }),
    });
    act(() => root.render(<Harness gateway={git} repositoryRoot="/a" />));
    await act(async () => picker?.load());
    let creating: Promise<boolean> | undefined;
    act(() => {
      creating = picker?.create("feat/new");
    });
    act(() => root.render(<Harness gateway={git} repositoryRoot="/b" />));
    await act(async () => {
      failedSwitch.resolve();
      await creating;
    });
    expect(getBranches).toHaveBeenCalledTimes(1);
    expect(picker?.list).toEqual({ kind: "idle" });
    expect(picker?.error).toBeNull();
  });

  it("keeps a ready list visible while reloading and replaces it only with the same owner's result", async () => {
    const reload = deferred<GitBranches>();
    const reloaded: GitBranches = { ...branchesA, current: "feat/a" };
    const getBranches = vi.fn(async () => branchesA);
    const git = gateway({ getBranches });
    act(() => root.render(<Harness gateway={git} repositoryRoot="/a" />));
    await act(async () => picker?.load());
    getBranches.mockImplementation(() => reload.promise);
    act(() => picker?.load());
    expect(picker?.list).toEqual({ kind: "ready", branches: branchesA });
    await act(async () => reload.resolve(reloaded));
    expect(picker?.list).toEqual({ kind: "ready", branches: reloaded });
  });

  it("publishes only the latest reload when reloads settle out of order", async () => {
    const older = deferred<GitBranches>();
    const newer = deferred<GitBranches>();
    const stale: GitBranches = { ...branchesA, current: "stale" };
    const git = gateway({
      getBranches: vi
        .fn<(path: string) => Promise<GitBranches>>()
        .mockImplementationOnce(() => older.promise)
        .mockImplementationOnce(() => newer.promise),
    });
    act(() => root.render(<Harness gateway={git} repositoryRoot="/a" />));
    act(() => picker?.load());
    act(() => picker?.load());
    await act(async () => newer.resolve(branchesA));
    await act(async () => older.resolve(stale));
    expect(picker?.list).toEqual({ kind: "ready", branches: branchesA });
  });

  it("reports a bounded single-line failure", async () => {
    const git = gateway({
      switchBranch: vi.fn(async () => Promise.reject(new Error(`bad\u0007\n${"x".repeat(900)}`))),
    });
    act(() => root.render(<Harness gateway={git} repositoryRoot="/a" />));
    await act(async () => picker?.load());
    await act(async () => picker?.switchTo(featA));
    expect(picker?.pending).toBe(false);
    expect(picker?.error?.startsWith("bad")).toBe(true);
    expect(picker?.error).not.toMatch(/[\u0000-\u001f]/u);
    expect(picker?.error?.length).toBeLessThanOrEqual(500);
  });
});
