// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerBranchGateway } from "../../application/useComposerBranchPicker";
import { HEAD_WORKTREE_BASE, type AgentWorktreeBase } from "../../domain/agentWorktreeBase";
import type { GitBranches } from "../../domain/git";
import { AgentComposerBranchPicker } from "./AgentComposerBranchPicker";
import { composerBranchItems, MAX_COMPOSER_BRANCH_ITEMS } from "./composerBranchItems";

const BRANCHES: GitBranches = {
  current: "feat/idempotency-keys",
  local: ["main", "feat/idempotency-keys", "-hostile"],
  remotes: { origin: ["release/2.4"] },
};

function gateway(): ComposerBranchGateway {
  return {
    checkoutRemoteBranch: vi.fn(async () => []),
    createBranch: vi.fn(async () => undefined),
    getBranches: vi.fn(async () => BRANCHES),
    switchBranch: vi.fn(async () => undefined),
  };
}

function typeInto(input: HTMLInputElement | null, value: string): void {
  if (input === null) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function options(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')];
}

function key(target: Element | null, value: string): void {
  target?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: value }));
}

describe("composerBranchItems", () => {
  it("puts the current branch first, drops refs that fail validation and caps the list", () => {
    expect(composerBranchItems(BRANCHES, "").map((item) => item.ref)).toEqual([
      "refs/heads/feat/idempotency-keys",
      "refs/heads/main",
      "refs/remotes/origin/release/2.4",
    ]);
    const many: GitBranches = {
      current: null,
      local: Array.from({ length: 500 }, (_, index) => `b${index}`),
      remotes: {},
    };
    expect(composerBranchItems(many, "")).toHaveLength(MAX_COMPOSER_BRANCH_ITEMS);
    expect(composerBranchItems(BRANCHES, "RELEASE").map((item) => item.name)).toEqual([
      "origin/release/2.4",
    ]);
  });
});

describe("AgentComposerBranchPicker", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function render(
    isolation: "in-place" | "worktree",
    onWorktreeBaseChange = vi.fn(),
    git = gateway(),
    worktreeBase: AgentWorktreeBase = HEAD_WORKTREE_BASE,
  ) {
    const context = {
      disabled: false,
      isolation,
      remote: false,
      locked: false,
      onWorktreeBaseChange,
      repositoryRoot: "/repo",
      worktreeBase,
    };
    act(() =>
      root.render(
        <AgentComposerBranchPicker
          branchCheckout={{ gateway: git, guard: () => null }}
          context={context}
        />,
      ),
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')?.click(),
    );
    return { git, onWorktreeBaseChange };
  }

  function search(): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>('input[aria-label="Search refs"]');
  }

  it("lists local and remote refs with the current branch selected and switches in local checkout mode", async () => {
    const { git } = await render("in-place");
    const rows = options();
    expect(rows.map((node) => node.textContent)).toEqual([
      expect.stringContaining("feat/idempotency-keys"),
      expect.stringContaining("main"),
      expect.stringContaining("origin/release/2.4"),
    ]);
    expect(rows[0]?.getAttribute("aria-selected")).toBe("true");
    await act(async () => rows[1]?.click());
    expect(git.switchBranch).toHaveBeenCalledWith("/repo", "main");
  });

  it("keeps the ready rows visible when the picker is reopened while the list reloads", async () => {
    const git = gateway();
    await render("in-place", vi.fn(), git);
    expect(options()).toHaveLength(3);
    const trigger = host.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]');
    await act(async () => trigger?.click());
    let settle: (branches: GitBranches) => void = () => undefined;
    vi.mocked(git.getBranches).mockImplementation(
      () =>
        new Promise<GitBranches>((resolve) => {
          settle = resolve;
        }),
    );
    await act(async () => trigger?.click());
    expect(options()).toHaveLength(3);
    expect(document.body.textContent).not.toContain("Loading branches");
    await act(async () => settle({ ...BRANCHES, local: ["main"] }));
    expect(options().map((node) => node.textContent)).toEqual([
      expect.stringContaining("main"),
      expect.stringContaining("origin/release/2.4"),
    ]);
  });

  it("offers Create branch for an unknown query in local mode", async () => {
    const { git } = await render("in-place");
    act(() => typeInto(search(), "feat/new-thing"));
    const create = options().find((node) => node.textContent?.startsWith("Create branch"));
    await act(async () => create?.click());
    expect(git.createBranch).toHaveBeenCalledWith("/repo", "feat/new-thing");
    expect(git.switchBranch).toHaveBeenCalledWith("/repo", "feat/new-thing");
  });

  it("refuses to create an option-looking branch", async () => {
    const { git } = await render("in-place");
    act(() => typeInto(search(), "--upload-pack=x"));
    const create = options().find((node) => node.textContent?.startsWith("Create branch"));
    await act(async () => create?.click());
    expect(git.createBranch).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).not.toBe("");
  });

  it("selects a worktree base without touching the checkout in New worktree mode", async () => {
    const { git, onWorktreeBaseChange } = await render("worktree");
    expect(host.textContent).toContain("From feat/idempotency-keys");
    act(() => typeInto(search(), "no-such-branch"));
    expect(options().some((node) => node.textContent?.startsWith("Create branch"))).toBe(false);
    act(() => typeInto(search(), ""));
    const remote = options().find((node) => node.textContent?.includes("origin/release/2.4"));
    await act(async () => remote?.click());
    expect(onWorktreeBaseChange).toHaveBeenCalledWith({
      kind: "ref",
      ref: "refs/remotes/origin/release/2.4",
    });
    expect(git.switchBranch).not.toHaveBeenCalled();
    expect(git.checkoutRemoteBranch).not.toHaveBeenCalled();
  });

  it("labels the trigger with the chosen worktree base and resets to HEAD for the current branch", async () => {
    const { onWorktreeBaseChange } = await render("worktree", vi.fn(), gateway(), {
      kind: "ref",
      ref: "refs/heads/main",
    });
    expect(host.textContent).toContain("From main");
    const main = options().find((node) => node.textContent?.includes("main"));
    expect(main?.getAttribute("aria-selected")).toBe("true");
    await act(async () => options()[0]?.click());
    expect(onWorktreeBaseChange).toHaveBeenCalledWith({ kind: "head" });
  });

  it("supports arrow keys and Enter from the search field", async () => {
    const { git } = await render("in-place");
    act(() => key(search(), "ArrowDown"));
    await act(async () => key(search(), "Enter"));
    expect(git.switchBranch).toHaveBeenCalledWith("/repo", "main");
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    await render("in-place");
    const trigger = host.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]');
    expect(document.activeElement).toBe(search());
    act(() => key(search(), "Escape"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("renders nothing for a locked follow-up, a remote composer or without a repository", () => {
    const base = {
      disabled: false,
      isolation: "in-place" as const,
      remote: false,
      onWorktreeBaseChange: vi.fn(),
      worktreeBase: HEAD_WORKTREE_BASE,
    };
    const checkout = { gateway: gateway(), guard: () => null };
    act(() =>
      root.render(
        <AgentComposerBranchPicker
          branchCheckout={checkout}
          context={{ ...base, locked: true, repositoryRoot: "/repo" }}
        />,
      ),
    );
    expect(host.innerHTML).toBe("");
    act(() =>
      root.render(
        <AgentComposerBranchPicker
          branchCheckout={checkout}
          context={{ ...base, locked: false, repositoryRoot: null }}
        />,
      ),
    );
    expect(host.innerHTML).toBe("");
    act(() =>
      root.render(
        <AgentComposerBranchPicker
          branchCheckout={checkout}
          context={{ ...base, locked: false, remote: true, repositoryRoot: "/repo" }}
        />,
      ),
    );
    expect(host.innerHTML).toBe("");
    expect(checkout.gateway.getBranches).not.toHaveBeenCalled();
  });
});
