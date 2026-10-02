import { describe, expect, it } from "vitest";
import wireContract from "../../contracts/remote-git-sync-wire.json";
import { HEAD_WORKTREE_BASE, localBranchRef } from "./agentWorktreeBase";
import {
  remoteBranchMatches,
  remoteCheckoutDirty,
  remoteCheckoutUpdateBlock,
  remoteDefaultBase,
  remoteOriginBase,
  remoteOriginBranchOf,
  remoteStartBaseFor,
} from "./remoteDraftGitBase";
import type { RemoteGitBranchList, RemoteGitCheckoutStatus } from "./remoteGitSync";

type Contract = Readonly<{
  sections: Readonly<
    Record<string, Readonly<{ accepted: readonly { name: string; value: unknown }[] }>>
  >;
}>;
const contract = wireContract as unknown as Contract;
const fixture = <T>(section: string, name: string): T =>
  contract.sections[section]!.accepted.find((entry) => entry.name === name)!.value as T;

const branches = fixture<RemoteGitBranchList>("branchList", "typical");
const clean = fixture<RemoteGitCheckoutStatus>("checkoutStatus", "cleanTracking");

describe("remote draft Git base", () => {
  it("maps the composer base to the closed runner start base", () => {
    const origin = remoteOriginBase("feature/checkout-v2")!;
    expect(remoteStartBaseFor("worktree", origin)).toEqual({
      kind: "ready",
      base: { kind: "origin-branch", branch: "feature/checkout-v2" },
    });
    expect(remoteStartBaseFor("worktree", HEAD_WORKTREE_BASE)).toEqual({
      kind: "ready",
      base: { kind: "checkout-head" },
    });
    expect(remoteStartBaseFor("in-place", origin)).toEqual({ kind: "ready", base: undefined });
    expect(remoteStartBaseFor("worktree", undefined)).toEqual({ kind: "ready", base: undefined });
  });

  it("rejects a base that is not an origin branch", () => {
    const local = { kind: "ref", ref: localBranchRef("main")! } as const;
    expect(remoteStartBaseFor("worktree", local)).toEqual({ kind: "invalid" });
    expect(remoteOriginBranchOf(local)).toBeNull();
  });

  it("preselects the origin default branch", () => {
    expect(remoteDefaultBase(branches)).toEqual(remoteOriginBase("main"));
    expect(remoteDefaultBase({ ...branches, defaultBranch: null })).toBeNull();
  });

  it("lists the default branch first and filters case-insensitively", () => {
    const list: RemoteGitBranchList = {
      ...branches,
      branches: [...branches.branches].reverse(),
    };
    expect(remoteBranchMatches(list, "").map((branch) => branch.name)).toEqual([
      "main",
      "feature/checkout-v2",
    ]);
    expect(remoteBranchMatches(list, "CHECKOUT").map((branch) => branch.name)).toEqual([
      "feature/checkout-v2",
    ]);
    expect(remoteBranchMatches(list, "missing")).toEqual([]);
  });

  it.each([
    ["inPlaceTaskActive", { inPlaceTaskActive: true }, "busy"],
    ["operation", { operation: "merge" }, "git_operation_in_progress"],
    ["detached", { branch: null }, "git_detached_head"],
    ["no upstream", { upstream: null }, "git_no_upstream"],
    ["tracked change", { dirty: { tracked: 1, untracked: 0, truncated: false } }, "git_dirty"],
    ["diverged", { upstream: { ref: "origin/main", ahead: 1, behind: 2 } }, "git_diverged"],
  ] as const)("blocks Update from origin when %s", (_, patch, code) => {
    expect(remoteCheckoutUpdateBlock({ ...clean, ...patch } as RemoteGitCheckoutStatus)).toBe(code);
  });

  it("allows Update from origin on a clean tracking checkout with untracked files", () => {
    const untracked = { ...clean, dirty: { tracked: 0, untracked: 3, truncated: false } };
    expect(remoteCheckoutUpdateBlock(clean)).toBeNull();
    expect(remoteCheckoutUpdateBlock(untracked)).toBeNull();
    expect(remoteCheckoutDirty(untracked)).toBe(true);
    expect(remoteCheckoutDirty(clean)).toBe(false);
  });
});
