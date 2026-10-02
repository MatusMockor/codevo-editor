import { describe, expect, it } from "vitest";
import wireContract from "../../contracts/remote-git-sync-wire.json";
import {
  REMOTE_GIT_INVALID_RESPONSE,
  isRemoteGitOperationOf,
  parseRemoteGitAdmission,
  parseRemoteGitPoll,
  remoteCompareUrl,
  remoteGitErrorMessage,
  remoteThreadBranchName,
  remoteThreadShipStatus,
  settledRemoteGitOperation,
  type RemoteGitOperation,
  type RemoteThreadGitStatus,
} from "./remoteGitSync";
import { REMOTE_GIT_ERROR_CODES, isRemoteGitCommitResult } from "./remoteGitSyncWire";
import { validateRemoteRunnerValue } from "./remoteRunnerValidation";

type WireCase = Readonly<{ name: string; value: unknown }>;
type Contract = Readonly<{
  sections: Readonly<Record<string, Readonly<{ accepted: WireCase[]; rejected: WireCase[] }>>>;
}>;

const contract = wireContract as unknown as Contract;
const fixture = (section: string, name: string): unknown => {
  const found = contract.sections[section]?.accepted.find((entry) => entry.name === name);
  expect(found).toBeDefined();
  return found?.value;
};
const CONVERSATION = "7389088c-29b8-4cec-9a15-e825e1fb2f66";
const OPERATION = "5f0c1d2e-3a4b-4c5d-9e6f-7a8b9c0d1e2f";
const threadStatus = (name: string) => fixture("threadGitStatus", name) as RemoteThreadGitStatus;

describe("remote git admission", () => {
  it.each(contract.sections.errorBody?.accepted ?? [])("refuses with $name", ({ value }) => {
    expect(parseRemoteGitAdmission(value, isRemoteGitCommitResult)).toEqual({
      kind: "refused",
      error: (value as { error: string }).error,
    });
  });

  it("accepts a validated value and rejects everything else", () => {
    const committed = fixture("commitResult", "committed");
    expect(parseRemoteGitAdmission(committed, isRemoteGitCommitResult)).toEqual({
      kind: "accepted",
      value: committed,
    });
    for (const invalid of [null, { error: "invalid_input" }, { error: "busy", extra: true }, {}]) {
      expect(() => parseRemoteGitAdmission(invalid, isRemoteGitCommitResult)).toThrow(
        REMOTE_GIT_INVALID_RESPONSE,
      );
    }
  });

  it("checks the operation kind of an accepted job", () => {
    const running = { id: OPERATION, kind: "fetch", status: "running", error: null, result: null };
    expect(isRemoteGitOperationOf("fetch")(running)).toBe(true);
    expect(isRemoteGitOperationOf("push")(running)).toBe(false);
  });
});

describe("remote git operation polling", () => {
  it("reports a forgotten operation as unknown", () => {
    expect(parseRemoteGitPoll({ outcome: "unknown" }, OPERATION)).toEqual({ kind: "unknown" });
    expect(() => parseRemoteGitPoll({ outcome: "unknown", id: OPERATION }, OPERATION)).toThrow();
    expect(() => parseRemoteGitPoll({ outcome: "lost" }, OPERATION)).toThrow();
  });

  it("accepts only the polled operation id", () => {
    const pushed = fixture("gitOperation", "pushSucceeded");
    expect(parseRemoteGitPoll(pushed, OPERATION)).toEqual({ kind: "operation", operation: pushed });
    expect(() => parseRemoteGitPoll(pushed, "6a1d2e3f-4b5c-4d6e-8f70-8b9c0d1e2f3a")).toThrow(
      REMOTE_GIT_INVALID_RESPONSE,
    );
  });

  it("settles succeeded and failed jobs and keeps running jobs open", () => {
    const pushed = fixture("gitOperation", "pushSucceeded") as RemoteGitOperation;
    const failed = fixture("gitOperation", "pushFailed") as RemoteGitOperation;
    const running = fixture("gitOperation", "fetchRunning") as RemoteGitOperation;
    expect(settledRemoteGitOperation(pushed)).toEqual({ kind: "succeeded", result: pushed.result });
    expect(settledRemoteGitOperation(failed)).toEqual({
      kind: "failed",
      error: "git_rejected_non_fast_forward",
    });
    expect(settledRemoteGitOperation(running)).toBeNull();
  });
});

describe("remote git error copy", () => {
  it("has distinct copy for every closed error code", () => {
    const messages = REMOTE_GIT_ERROR_CODES.map(remoteGitErrorMessage);
    expect(new Set(messages).size).toBe(REMOTE_GIT_ERROR_CODES.length);
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/git_|fatal:|stderr/u);
    }
  });
});

describe("remote compare URL", () => {
  it.each([
    [
      "github.com/acme/shop",
      "https://github.com/acme/shop/compare/main...codevo/7389088c?expand=1",
    ],
    [
      "gitlab.com/acme/shop",
      "https://gitlab.com/acme/shop/-/merge_requests/new?merge_request[source_branch]=codevo/7389088c&merge_request[target_branch]=main",
    ],
    [
      "bitbucket.org/acme/shop",
      "https://bitbucket.org/acme/shop/pull-requests/new?source=codevo/7389088c&dest=main",
    ],
  ])("builds the %s compare page", (identity, url) => {
    expect(remoteCompareUrl(identity, "main", "codevo/7389088c")).toBe(url);
  });

  it("encodes branch names like the local compare URL", () => {
    expect(remoteCompareUrl("github.com/acme/shop", "release#1", "x")).toBe(
      "https://github.com/acme/shop/compare/release%231...x?expand=1",
    );
    expect(remoteCompareUrl("github.com/acme/shop", "release&1", "feat/ü")).toBe(
      "https://github.com/acme/shop/compare/release%261...feat/%C3%BC?expand=1",
    );
  });

  it.each([
    [null],
    ["example.com/acme/shop"],
    ["github.com:2222/acme/shop"],
    ["gitlab.com/group/sub/shop"],
    ["github.com/acme"],
    ["github.com/acme/.hidden"],
    ["https://github.com/acme/shop"],
  ])("refuses an unsupported identity %s", (identity) => {
    expect(remoteCompareUrl(identity, "main", "codevo/7389088c")).toBeNull();
  });

  it("refuses unsafe branch names", () => {
    expect(remoteCompareUrl("github.com/acme/shop", "main", "+refs/heads/x")).toBeNull();
    expect(remoteCompareUrl("github.com/acme/shop", "HEAD", "codevo/x")).toBeNull();
  });
});

describe("remote thread ship status", () => {
  it("maps a worktree started from origin to branch, base relation and published state", () => {
    const status = threadStatus("worktreeFromOrigin");
    const ship = remoteThreadShipStatus(status, CONVERSATION, "github.com/acme/shop");
    expect(ship.worktree.branch).toBe("codevo/7389088c");
    expect(ship.worktree.head).toBe(status.headSha);
    expect(ship.primary).toEqual({
      branch: `origin/${status.base?.branch}`,
      head: status.base?.sha,
      dirty: false,
    });
    expect(ship.relation).toEqual({
      aheadOfPrimary: status.base?.ahead,
      behindPrimary: status.base?.behind,
      fastForwardable: status.base?.behind === 0,
    });
    expect(ship.remote?.name).toBe("origin");
    expect(ship.remote?.upstream).toEqual({
      ahead: status.published?.ahead,
      behind: status.published?.behind,
    });
    expect(ship.remote?.compareUrl).toBe(
      "https://github.com/acme/shop/compare/main...codevo/7389088c?expand=1",
    );
  });

  it("publishes a legacy detached worktree under the conversation branch without compare", () => {
    const status = threadStatus("legacyDetachedWorktree");
    expect(remoteThreadBranchName(status, CONVERSATION)).toBe("codevo/7389088c");
    const ship = remoteThreadShipStatus(status, CONVERSATION, "github.com/acme/shop");
    expect(ship.primary.branch).toBeNull();
    expect(ship.relation.fastForwardable).toBe(false);
    expect(ship.remote).toEqual({ name: "origin", upstream: null, compareUrl: null });
  });

  it("keeps the server checkout branch for in-place threads", () => {
    const status = threadStatus("inPlace");
    const ship = remoteThreadShipStatus(status, CONVERSATION, null);
    expect(ship.worktree.branch).toBe("main");
    expect(remoteThreadBranchName({ ...status, branch: null }, CONVERSATION)).toBe("HEAD");
  });

  it("bounds the change count at the integration limit", () => {
    const status: RemoteThreadGitStatus = {
      ...threadStatus("inPlace"),
      dirty: { tracked: 10_000, untracked: 10_000, truncated: true },
    };
    const ship = remoteThreadShipStatus(status, CONVERSATION, null);
    expect(ship.worktree.changeCount).toBe(10_000);
    expect(ship.worktree.dirty).toBe(true);
  });
});

describe("remote start request", () => {
  const start = { serverId: "linux", taskId: CONVERSATION, projectId: "storefront" };

  it("accepts the legacy body and every closed base", () => {
    for (const request of [
      start,
      { ...start, base: { kind: "checkout-head" } },
      { ...start, base: { kind: "origin-branch", branch: "feature/x" } },
    ]) {
      expect(() => validateRemoteRunnerValue("startTask", "request", request)).not.toThrow();
    }
  });

  it.each([
    null,
    { kind: "origin-branch", branch: "+refs/heads/main" },
    { kind: "origin-branch" },
    { kind: "checkout-head", branch: "main" },
    { kind: "sha", sha: "abc" },
  ])("rejects base %j", (base) => {
    expect(() => validateRemoteRunnerValue("startTask", "request", { ...start, base })).toThrow(
      "Invalid remote runner startTask request.",
    );
  });
});
