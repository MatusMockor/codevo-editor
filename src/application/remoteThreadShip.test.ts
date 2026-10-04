import { describe, expect, it } from "vitest";
import wireContract from "../../contracts/remote-git-sync-wire.json";
import { REMOTE_GIT_ERROR_CODES } from "../domain/remoteGitSyncWire";
import type { RemoteThreadGitStatus } from "../domain/remoteGitSync";
import {
  REMOTE_SHIP_PUSH_UNCONFIRMED,
  remoteCommitFailure,
  remoteCommitMessage,
  remotePushFailure,
  remotePushSettlement,
  remoteStepFailure,
  sameRemoteShipTarget,
  type RemoteShipTarget,
} from "./remoteThreadShip";

type WireCase = Readonly<{ name: string; value: unknown }>;
type Contract = Readonly<{
  sections: Readonly<Record<string, Readonly<{ accepted: WireCase[] }>>>;
}>;
const status = (wireContract as unknown as Contract).sections.threadGitStatus?.accepted.find(
  (entry) => entry.name === "worktreeFromOrigin",
)?.value as RemoteThreadGitStatus;

const target: RemoteShipTarget = {
  threadId: "remote-thread:linux:linux-runner:7389088c-29b8-4cec-9a15-e825e1fb2f66",
  serverId: "linux",
  runnerId: "linux-runner",
  conversationId: "7389088c-29b8-4cec-9a15-e825e1fb2f66",
  repositoryKey: "github.com/acme/shop",
  running: false,
};
const pushed = (remoteRef: string) =>
  ({
    kind: "succeeded",
    result: { kind: "push", remoteRef, pushedSha: status.headSha, created: false },
  }) as const;

describe("remote thread ship policy", () => {
  it("identifies the exact owner but ignores the running flag and the compare key", () => {
    expect(sameRemoteShipTarget({ ...target, running: true }, target)).toBe(true);
    expect(sameRemoteShipTarget({ ...target, repositoryKey: null }, target)).toBe(true);
    expect(
      sameRemoteShipTarget({ ...target, repositoryKey: "github.com/acme/other" }, target),
    ).toBe(true);
    for (const change of [
      { threadId: "remote-thread:linux:linux-runner:other" },
      { serverId: "other" },
      { runnerId: "other" },
      { conversationId: "00000000-0000-4000-8000-000000000001" },
    ]) {
      expect(sameRemoteShipTarget({ ...target, ...change }, target)).toBe(false);
    }
    expect(sameRemoteShipTarget(null, target)).toBe(false);
  });

  it("trims commit messages and rejects ones the runner would refuse", () => {
    expect(remoteCommitMessage("  Fix totals\n\nBody  ")).toBe("Fix totals\n\nBody");
    expect(remoteCommitMessage("   ")).toBeNull();
    expect(remoteCommitMessage("tab\there")).toBeNull();
    expect(remoteCommitMessage("x".repeat(4097))).toBeNull();
    expect(remoteCommitMessage("é".repeat(2048))).toBe("é".repeat(2048));
  });

  it("maps every refusal code to a bounded commit and push failure", () => {
    for (const code of REMOTE_GIT_ERROR_CODES) {
      expect(remoteCommitFailure(code).step).toBe("commit");
      expect(remotePushFailure(code).step).toBe("push");
    }
    expect(remoteCommitFailure("git_dirty")).toMatchObject({ reason: "gitError" });
  });

  it("strips control characters from transport failures", () => {
    expect(remoteStepFailure("push", "\u0007")).toEqual({
      step: "push",
      reason: "gitError",
      message: "Git failed.",
    });
    expect(remoteStepFailure("commit", "bad\u001b[31m")).toMatchObject({ message: "bad[31m" });
  });

  it("builds a receipt with compare URL for a thread branch push", () => {
    expect(
      remotePushSettlement(pushed("refs/heads/codevo/7389088c"), target, status, "thread-branch"),
    ).toEqual({
      kind: "pushed",
      receipt: {
        remote: "origin",
        branch: "codevo/7389088c",
        compareUrl: "https://github.com/acme/shop/compare/main...codevo/7389088c?expand=1",
      },
    });
  });

  it("does not offer a compare page after pushing to the base branch", () => {
    const settlement = remotePushSettlement(
      pushed("refs/heads/main"),
      target,
      status,
      "base-branch",
    );
    expect(settlement).toEqual({
      kind: "pushed",
      receipt: { remote: "origin", branch: "main", compareUrl: null },
    });
  });

  it("never reports an unconfirmed or mismatched job as pushed", () => {
    const unconfirmed = {
      kind: "failed",
      failure: { step: "push", reason: "gitError", message: REMOTE_SHIP_PUSH_UNCONFIRMED },
    };
    for (const outcome of [
      { kind: "unknown" },
      { kind: "timedOut" },
      { kind: "aborted" },
      { kind: "succeeded", result: { kind: "fetch", fetchedAt: "2026-10-02T09:15:00Z" } },
    ] as const) {
      expect(remotePushSettlement(outcome, target, status, "thread-branch")).toEqual(unconfirmed);
    }
    for (const [ref, pushTarget, known] of [
      ["refs/heads/main", "thread-branch", status],
      ["refs/heads/codevo/7389088c", "base-branch", status],
      ["refs/heads/codevo/7389088c", "thread-branch", null],
      ["refs/heads/main", "base-branch", { ...status, base: null }],
    ] as const) {
      expect(remotePushSettlement(pushed(ref), target, known, pushTarget)).toEqual(unconfirmed);
    }
  });
});
