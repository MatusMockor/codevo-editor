// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { BranchWorktreeReceipt, BranchWorktreeRequest } from "../../../../domain/gitWorktree";
import { waitForReact } from "../../../../test/reactTestLifecycle";
import { mountUi, type MountedUi } from "../../../../ui/foundation/foundationTestSupport";
import {
  WORKTREE_THREAD_SWITCH_REASON,
  useAgentGitBranchActions,
  type AgentGitBranchActions,
  type AgentGitBranchActionsInput,
} from "./useAgentGitBranchActions";

let ui: MountedUi | null = null;
const box: { current: AgentGitBranchActions | null } = { current: null };

afterEach(() => {
  ui?.unmount();
  ui = null;
  box.current = null;
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function boundary() {
  const calls: string[] = [];
  const pendingWorktrees: Deferred<BranchWorktreeReceipt>[] = [];
  let guardResult: string | null = null;
  let changed = 0;
  const input = (
    overrides: Partial<AgentGitBranchActionsInput> = {},
  ): AgentGitBranchActionsInput => ({
    ownerKey: "thread-a",
    rootPath: "/repo",
    repositoryRoot: "/repo",
    currentBranch: "feat/idempotency-keys",
    isolation: "in-place",
    git: {
      createBranch: async (root, name) => {
        calls.push(`create:${root}:${name}`);
      },
    },
    checkout: {
      gateway: {
        switchBranch: async (root, name) => {
          calls.push(`switch:${root}:${name}`);
        },
        checkoutRemoteBranch: async (root, name) => {
          calls.push(`remote:${root}:${name}`);
          return [];
        },
      },
      guard: (target) => {
        calls.push(`guard:${target.rootPath}:${target.ownerKey}`);
        return guardResult;
      },
    },
    historyTarget: { rootPath: "/repo", ownerKey: "owner-a" },
    worktrees: {
      addBranchWorktree: (request: BranchWorktreeRequest) => {
        calls.push(`worktree:${request.repositoryRoot}:${request.branch}:${request.startPoint}`);
        const next = deferred<BranchWorktreeReceipt>();
        pendingWorktrees.push(next);
        return next.promise;
      },
    },
    onChanged: () => {
      changed += 1;
    },
    ...overrides,
  });
  return {
    calls,
    pendingWorktrees,
    input,
    block: (reason: string | null) => {
      guardResult = reason;
    },
    changed: () => changed,
  };
}

function Probe(props: { readonly input: AgentGitBranchActionsInput }) {
  box.current = useAgentGitBranchActions(props.input);
  return null;
}

function render(input: AgentGitBranchActionsInput): void {
  ui = ui ?? mountUi();
  ui.render(<Probe input={input} />);
}

function actions(): AgentGitBranchActions {
  expect(box.current).not.toBeNull();
  return box.current as AgentGitBranchActions;
}

describe("useAgentGitBranchActions", () => {
  it("asks the checkout guard first and reports a block without switching", async () => {
    const fake = boundary();
    fake.block("This checkout has uncommitted changes.");
    render(fake.input());

    await act(async () => actions().switchTo({ name: "main", kind: "local", badge: "default" }));

    expect(fake.calls).toEqual(["guard:/repo:owner-a"]);
    expect(actions().notice).toEqual({
      kind: "error",
      text: "This checkout has uncommitted changes.",
    });
  });

  it("switches local branches and checks out remote branches", async () => {
    const fake = boundary();
    render(fake.input());

    await act(async () => actions().switchTo({ name: "main", kind: "local", badge: "default" }));
    await act(async () =>
      actions().switchTo({ name: "origin/release/1.4", kind: "remote", badge: "remote" }),
    );

    expect(fake.calls).toEqual([
      "guard:/repo:owner-a",
      "switch:/repo:main",
      "guard:/repo:owner-a",
      "remote:/repo:origin/release/1.4",
    ]);
    expect(fake.changed()).toBe(2);
    expect(actions().notice).toBeNull();
  });

  it("reports a repository that cannot check out remote branches", async () => {
    const fake = boundary();
    const base = fake.input();
    render({
      ...base,
      checkout:
        base.checkout === null
          ? null
          : { ...base.checkout, gateway: { switchBranch: base.checkout.gateway.switchBranch } },
    });

    await act(async () =>
      actions().switchTo({ name: "origin/x", kind: "remote", badge: "remote" }),
    );

    expect(actions().notice).toEqual({
      kind: "error",
      text: "This repository cannot check out remote branches here.",
    });
  });

  it("creates a branch and switches to it through the guard", async () => {
    const fake = boundary();
    render(fake.input());

    await act(async () => actions().create("  feat/idempotency-ttl ", { worktree: false }));

    expect(fake.calls).toEqual([
      "guard:/repo:owner-a",
      "create:/repo:feat/idempotency-ttl",
      "guard:/repo:owner-a",
      "switch:/repo:feat/idempotency-ttl",
    ]);
  });

  it("asks the checkout guard before creating a branch", async () => {
    const fake = boundary();
    fake.block("A turn is running in this checkout.");
    render(fake.input());

    await act(async () => actions().create("feat/blocked", { worktree: false }));

    expect(fake.calls).toEqual(["guard:/repo:owner-a"]);
    expect(actions().notice).toEqual({
      kind: "error",
      text: "A turn is running in this checkout.",
    });
    expect(fake.changed()).toBe(0);
  });

  it("never switches the previous owner when the owner changed while the branch was created", async () => {
    const fake = boundary();
    const created = deferred<void>();
    const git = {
      createBranch: (root: string, name: string) => {
        fake.calls.push(`create:${root}:${name}`);
        return created.promise;
      },
    };
    render(fake.input({ git }));
    act(() => {
      void actions().create("feat/a", { worktree: false });
    });

    render(fake.input({ git, ownerKey: "thread-b" }));
    await act(async () => created.resolve());

    expect(fake.calls).toEqual(["guard:/repo:owner-a", "create:/repo:feat/a"]);
    expect(actions().notice).toBeNull();
    expect(fake.changed()).toBe(0);
  });

  it("refreshes the branch list when the created branch could not be switched to", async () => {
    const fake = boundary();
    const base = fake.input();
    const checkout = base.checkout;
    expect(checkout).not.toBeNull();
    render({
      ...base,
      checkout:
        checkout === null
          ? null
          : {
              ...checkout,
              gateway: {
                switchBranch: () => Promise.reject(new Error("checkout would overwrite files")),
              },
            },
    });

    await act(async () => actions().create("feat/x", { worktree: false }));

    expect(actions().notice).toEqual({ kind: "error", text: "checkout would overwrite files" });
    expect(fake.changed()).toBe(1);
  });

  it("keeps a worktree thread on its own branch", async () => {
    const fake = boundary();
    render(fake.input({ isolation: "worktree" }));

    await act(async () => actions().switchTo({ name: "main", kind: "local", badge: "default" }));
    expect(actions().notice).toEqual({ kind: "error", text: WORKTREE_THREAD_SWITCH_REASON });

    await act(async () => actions().create("feat/in-place", { worktree: false }));
    expect(actions().notice).toEqual({ kind: "error", text: WORKTREE_THREAD_SWITCH_REASON });
    expect(fake.calls).toEqual([]);
    expect(fake.changed()).toBe(0);

    act(() => {
      void actions().create("feat/side", { worktree: true });
    });
    expect(fake.calls).toEqual(["worktree:/repo:feat/side:feat/idempotency-keys"]);
  });

  it("rejects an invalid branch name before touching git", async () => {
    const fake = boundary();
    render(fake.input());

    await act(async () => actions().create("--help", { worktree: true }));

    expect(fake.calls).toEqual([]);
    expect(actions().notice?.kind).toBe("error");
  });

  it("creates a branch in a new worktree and offers its path", async () => {
    const fake = boundary();
    render(fake.input());

    act(() => {
      void actions().create("feat/idempotency-ttl", { worktree: true });
    });
    expect(actions().busy).toBe(true);
    await act(async () =>
      fake.pendingWorktrees[0]?.resolve({
        worktreePath: "/repo/.worktrees/feat-idempotency-ttl",
        branch: "feat/idempotency-ttl",
        trusted: false,
      }),
    );

    expect(fake.calls).toEqual(["worktree:/repo:feat/idempotency-ttl:feat/idempotency-keys"]);
    expect(actions().notice).toEqual({
      kind: "worktree",
      text: "Created a worktree at /repo/.worktrees/feat-idempotency-ttl",
      path: "/repo/.worktrees/feat-idempotency-ttl",
      trusted: false,
    });
    expect(actions().busy).toBe(false);
    expect(fake.changed()).toBe(1);
  });

  it("drops a pending result after the owner switched", async () => {
    const fake = boundary();
    render(fake.input());
    act(() => {
      void actions().create("feat/a", { worktree: true });
    });

    render(fake.input({ ownerKey: "thread-b" }));
    render(fake.input({ ownerKey: "thread-a" }));
    await act(async () =>
      fake.pendingWorktrees[0]?.resolve({
        worktreePath: "/repo/.worktrees/a",
        branch: "feat/a",
        trusted: true,
      }),
    );

    await waitForReact(() => expect(actions().busy).toBe(false));
    expect(actions().notice).toBeNull();
    expect(fake.changed()).toBe(0);
  });

  it("reports a gateway error", async () => {
    const fake = boundary();
    render(
      fake.input({
        git: { createBranch: () => Promise.reject(new Error("branch already exists")) },
      }),
    );

    await act(async () => actions().create("feat/x", { worktree: false }));

    expect(actions().notice).toEqual({ kind: "error", text: "branch already exists" });
  });
});
