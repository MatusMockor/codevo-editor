import { describe, expect, it } from "vitest";
import { gitBranchPickerItems, validateNewBranchName } from "./gitBranchPicker";

const local = [
  "chore/deps-2026-09",
  "feat/idempotency-keys",
  "feat/order-webhooks",
  "fix/payments-timeout",
  "main",
];
const remote = ["origin/feat/rate-limit", "origin/main", "origin/release/1.4"];

describe("gitBranchPickerItems", () => {
  it("orders current, default, locals, then remotes that have no local twin", () => {
    expect(
      gitBranchPickerItems(
        local,
        remote,
        ["fix/payments-timeout"],
        "feat/idempotency-keys",
        "main",
        "",
      ),
    ).toEqual([
      { name: "feat/idempotency-keys", kind: "local", badge: "current" },
      { name: "main", kind: "local", badge: "default" },
      { name: "chore/deps-2026-09", kind: "local", badge: null },
      { name: "feat/order-webhooks", kind: "local", badge: null },
      { name: "fix/payments-timeout", kind: "local", badge: "worktree" },
      { name: "origin/feat/rate-limit", kind: "remote", badge: "remote" },
      { name: "origin/release/1.4", kind: "remote", badge: "remote" },
    ]);
  });

  it("filters case-insensitively and caps the list", () => {
    expect(
      gitBranchPickerItems(local, remote, [], null, null, "FEAT").map((item) => item.name),
    ).toEqual(["feat/idempotency-keys", "feat/order-webhooks", "origin/feat/rate-limit"]);
    expect(gitBranchPickerItems(local, remote, [], null, null, "", 2)).toHaveLength(2);
    expect(gitBranchPickerItems(local, remote, [], null, null, "", -1)).toEqual([]);
  });

  it("ignores a current or default branch that is not a local branch", () => {
    expect(
      gitBranchPickerItems(["main"], [], [], "detached", "origin/main", "").map(
        (item) => item.name,
      ),
    ).toEqual(["main"]);
  });
});

describe("validateNewBranchName", () => {
  it("accepts ordinary names and trims them", () => {
    expect(validateNewBranchName("  feat/idempotency-ttl ")).toEqual({
      kind: "ok",
      name: "feat/idempotency-ttl",
    });
  });

  it("rejects names git would reject or read as options", () => {
    for (const bad of [
      "",
      "-x",
      "/a",
      "a/",
      "a..b",
      "a b",
      "a~1",
      "a^",
      "a:b",
      "a?",
      "a*",
      "a[",
      "a\\b",
      "x.lock",
      "a//b",
      "a@{1}",
      "a.",
      "@",
      "a/.hidden",
      "x".repeat(201),
    ]) {
      expect(validateNewBranchName(bad).kind, bad).toBe("invalid");
    }
  });
});
