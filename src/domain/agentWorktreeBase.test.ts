import { describe, expect, it } from "vitest";
import {
  agentBranchRefLabel,
  localBranchRef,
  parseAgentBranchRef,
  parseAgentWorktreeBase,
  remoteBranchRef,
} from "./agentWorktreeBase";

describe("parseAgentBranchRef", () => {
  it.each([
    "refs/heads/main",
    "refs/heads/feat/idempotency-keys",
    "refs/remotes/origin/release/2.4",
  ])("accepts %s", (value) => {
    expect(parseAgentBranchRef(value)).toBe(value);
  });

  it.each([
    ["an option", "-b"],
    ["an option-looking branch", "refs/heads/--upload-pack=x"],
    ["a dash segment", "refs/heads/-b"],
    ["a revision expression", "refs/heads/HEAD~1"],
    ["a bare HEAD", "HEAD~1"],
    ["a HEAD segment", "refs/heads/HEAD"],
    ["a range", "refs/heads/a..b"],
    ["a reflog selector", "refs/heads/@{-1}"],
    ["a bare reflog selector", "@{-1}"],
    ["a tag", "refs/tags/v1"],
    ["a bare name", "main"],
    ["a control character", "refs/heads/ma\u0007in"],
    ["a delete character", "refs/heads/ma\u007fin"],
    ["a C1 control character", "refs/heads/ma\u0085in"],
    ["the first C1 control character", "refs/heads/ma\u0080in"],
    ["the last C1 control character", "refs/heads/ma\u009fin"],
    ["whitespace", "refs/heads/my branch"],
    ["a trailing slash", "refs/heads/main/"],
    ["a lock suffix", "refs/heads/main.lock"],
    ["a lock segment", "refs/heads/main.lock/x"],
    ["a trailing dot", "refs/heads/main."],
    ["an empty segment", "refs/heads/a//b"],
    ["a dot segment", "refs/heads/.hidden"],
    ["an empty name", "refs/heads/"],
    ["a lone at sign", "refs/heads/@"],
    ["a colon", "refs/heads/a:b"],
    ["a backslash", "refs/heads/a\\b"],
    ["a glob", "refs/heads/a*"],
    ["an oversized ref", `refs/heads/${"a".repeat(600)}`],
    ["a non-string", 42],
  ])("rejects %s", (_label, value) => {
    expect(parseAgentBranchRef(value)).toBeNull();
  });

  it("accepts a ref at the byte limit and rejects one byte more", () => {
    const prefix = "refs/heads/";
    expect(parseAgentBranchRef(`${prefix}${"a".repeat(256 - prefix.length)}`)).not.toBeNull();
    expect(parseAgentBranchRef(`${prefix}${"a".repeat(257 - prefix.length)}`)).toBeNull();
  });

  it("builds and labels refs", () => {
    expect(localBranchRef("main")).toBe("refs/heads/main");
    expect(remoteBranchRef("origin", "release/2.4")).toBe("refs/remotes/origin/release/2.4");
    expect(agentBranchRefLabel("refs/remotes/origin/release/2.4")).toBe("origin/release/2.4");
    expect(agentBranchRefLabel("refs/heads/feat/a")).toBe("feat/a");
    expect(localBranchRef("-x")).toBeNull();
    expect(remoteBranchRef("-o", "main")).toBeNull();
  });
});

describe("parseAgentWorktreeBase", () => {
  it("accepts head and a validated ref", () => {
    expect(parseAgentWorktreeBase({ kind: "head" })).toEqual({ kind: "head" });
    expect(parseAgentWorktreeBase({ kind: "ref", ref: "refs/heads/main" })).toEqual({
      kind: "ref",
      ref: "refs/heads/main",
    });
  });

  it.each([
    ["a hostile ref", { kind: "ref", ref: "refs/heads/--upload-pack=x" }],
    ["an unknown kind", { kind: "sha", ref: "abc" }],
    ["an extra field on head", { kind: "head", ref: "refs/heads/main" }],
    ["an extra field on ref", { kind: "ref", ref: "refs/heads/main", force: true }],
    ["a missing ref", { kind: "ref" }],
    ["null", null],
    ["a string", "HEAD"],
  ])("rejects %s", (_label, value) => {
    expect(parseAgentWorktreeBase(value)).toBeNull();
  });
});
