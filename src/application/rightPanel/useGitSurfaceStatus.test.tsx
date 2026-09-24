// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  GitSurfaceStatus,
  GitSurfaceStatusGateway,
  GitSurfaceTarget,
} from "../../domain/gitSurfaceStatus";
import { waitForReact } from "../../test/reactTestLifecycle";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import {
  gitSurfaceStatusValue,
  useGitSurfaceStatus,
  type GitSurfaceStatusSnapshot,
} from "./useGitSurfaceStatus";

let ui: MountedUi | null = null;
const box: { current: GitSurfaceStatusSnapshot | null } = { current: null };

afterEach(() => {
  ui?.unmount();
  ui = null;
  box.current = null;
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function status(branch: string): GitSurfaceStatus {
  return {
    branch,
    defaultBase: "main",
    hasRemote: false,
    upstream: null,
    unpushed: [],
    unpushedTruncated: false,
    lineStats: [],
    lineStatsTruncated: false,
    localBranches: [branch, "main"],
    remoteBranches: [],
    worktreeBranches: [],
    branchesTruncated: false,
  };
}

interface ScriptedGateway extends GitSurfaceStatusGateway {
  readonly calls: GitSurfaceTarget[];
  readonly pending: Deferred<GitSurfaceStatus>[];
}

function scriptedGateway(): ScriptedGateway {
  const calls: GitSurfaceTarget[] = [];
  const pending: Deferred<GitSurfaceStatus>[] = [];
  return {
    calls,
    pending,
    getSurfaceStatus(target) {
      calls.push(target);
      const next = deferred<GitSurfaceStatus>();
      pending.push(next);
      return next.promise;
    },
  };
}

function Probe(props: {
  readonly gateway: GitSurfaceStatusGateway | null;
  readonly target: GitSurfaceTarget | null;
  readonly enabled: boolean;
}) {
  box.current = useGitSurfaceStatus(props);
  return null;
}

function render(
  gateway: GitSurfaceStatusGateway | null,
  target: GitSurfaceTarget | null,
  enabled = true,
): void {
  ui = ui ?? mountUi();
  ui.render(<Probe enabled={enabled} gateway={gateway} target={target} />);
}

const repoA: GitSurfaceTarget = { repositoryRoot: "/a", worktreePath: null };
const repoB: GitSurfaceTarget = { repositoryRoot: "/b", worktreePath: "/b/.worktrees/t" };

describe("useGitSurfaceStatus", () => {
  it("stays idle and never calls the gateway while disabled", () => {
    const gateway = scriptedGateway();
    render(gateway, repoA, false);

    expect(box.current?.load).toEqual({ kind: "idle" });
    expect(gateway.calls).toEqual([]);
  });

  it("resolves a load to ready", async () => {
    const gateway = scriptedGateway();
    render(gateway, repoA);
    expect(box.current?.load).toEqual({ kind: "loading", previous: null });

    await act(async () => gateway.pending[0]?.resolve(status("feat/a")));

    expect(box.current?.load).toEqual({ kind: "ready", status: status("feat/a") });
    expect(gateway.calls).toEqual([repoA]);
  });

  it("shows only the latest target's result when the target switches mid-flight", async () => {
    const gateway = scriptedGateway();
    render(gateway, repoA);
    render(gateway, { ...repoB });

    await act(async () => gateway.pending[1]?.resolve(status("feat/b")));
    await act(async () => gateway.pending[0]?.resolve(status("feat/a")));

    expect(gateway.calls).toEqual([repoA, repoB]);
    expect(box.current?.load).toEqual({ kind: "ready", status: status("feat/b") });
  });

  it("does not show a previous target's status while the next target loads", async () => {
    const gateway = scriptedGateway();
    render(gateway, repoA);
    await act(async () => gateway.pending[0]?.resolve(status("feat/a")));
    render(gateway, repoB);

    expect(box.current?.load).toEqual({ kind: "loading", previous: null });
  });

  it("keeps the previous value visible while refreshing", async () => {
    const gateway = scriptedGateway();
    render(gateway, repoA);
    await act(async () => gateway.pending[0]?.resolve(status("feat/a")));

    await act(async () => box.current?.refresh());

    expect(gateway.calls).toHaveLength(2);
    expect(box.current?.load.kind).toBe("loading");
    const load = box.current?.load ?? { kind: "idle" };
    expect(gitSurfaceStatusValue(load)).toEqual(status("feat/a"));
    await act(async () => gateway.pending[1]?.resolve(status("feat/a2")));
    await waitForReact(() =>
      expect(box.current?.load).toEqual({ kind: "ready", status: status("feat/a2") }),
    );
  });

  it("reports a rejected load as failed with its message", async () => {
    const gateway = scriptedGateway();
    render(gateway, repoA);

    await act(async () => gateway.pending[0]?.reject(new Error("Git is not available.")));

    expect(box.current?.load).toEqual({
      kind: "failed",
      message: "Git is not available.",
      previous: null,
    });
  });
});
