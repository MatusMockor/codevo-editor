import { describe, expect, it } from "vitest";
import {
  MAX_GIT_INTEGRATION_BRANCH_BYTES,
  MAX_GIT_INTEGRATION_CHANGE_COUNT,
  MAX_GIT_INTEGRATION_CONFLICT_FILES,
  MAX_GIT_INTEGRATION_COUNT,
  MAX_GIT_INTEGRATION_PATH_BYTES,
  MAX_GIT_INTEGRATION_REMOTE_BYTES,
  MAX_GIT_INTEGRATION_URL_BYTES,
  parseGitIntegrationOutcome,
  parseGitPushReceipt,
  parseGitShipStatus,
  validateGitIntegrationBranch,
  validateGitIntegrationMode,
  validateGitIntegrationRepositoryRoot,
  validateGitIntegrationSha,
  validateGitIntegrationWorktreePath,
  validateGitMergeMessage,
  validateOptionalGitIntegrationWorktreePath,
} from "./gitIntegration";

const WORKTREE_HEAD = "a".repeat(40);
const PRIMARY_HEAD = "b".repeat(40);
const MERGE_SHA = "c".repeat(40);

function shipStatusPayload(): Record<string, unknown> {
  return {
    worktree: { branch: "agent/agt-thread-0001", head: WORKTREE_HEAD, dirty: true, changeCount: 3 },
    primary: { branch: "main", head: PRIMARY_HEAD, dirty: false },
    relation: { aheadOfPrimary: 2, behindPrimary: 0, fastForwardable: true },
    remote: {
      name: "origin",
      upstream: { ahead: 1, behind: 0 },
      compareUrl: "https://github.com/acme/widgets/compare/main...agent/agt-thread-0001?expand=1",
    },
  };
}

describe("parseGitShipStatus", () => {
  it("parses a complete bounded ship status", () => {
    const status = parseGitShipStatus(shipStatusPayload());

    expect(status.worktree.branch).toBe("agent/agt-thread-0001");
    expect(status.worktree.changeCount).toBe(3);
    expect(status.primary.branch).toBe("main");
    expect(status.relation.fastForwardable).toBe(true);
    expect(status.remote?.name).toBe("origin");
    expect(status.remote?.upstream).toEqual({ ahead: 1, behind: 0 });
  });

  it("accepts a detached primary, a missing remote, and a missing upstream", () => {
    const payload = shipStatusPayload();
    payload.primary = { branch: null, head: PRIMARY_HEAD, dirty: true };
    payload.remote = null;

    expect(parseGitShipStatus(payload).primary.branch).toBeNull();
    expect(parseGitShipStatus(payload).remote).toBeNull();

    const withoutUpstream = shipStatusPayload();
    withoutUpstream.remote = { name: "origin", upstream: null, compareUrl: null };

    expect(parseGitShipStatus(withoutUpstream).remote?.upstream).toBeNull();
  });

  it("rejects unknown keys at every depth", () => {
    const extraTopLevel = { ...shipStatusPayload(), extra: 1 };
    const extraNested = shipStatusPayload();
    extraNested.relation = {
      aheadOfPrimary: 0,
      behindPrimary: 0,
      fastForwardable: false,
      extra: 1,
    };

    expect(() => parseGitShipStatus(extraTopLevel)).toThrow(TypeError);
    expect(() => parseGitShipStatus(extraNested)).toThrow(TypeError);
  });

  it("rejects malformed object ids", () => {
    const shortSha = shipStatusPayload();
    shortSha.worktree = { branch: "agent/x", head: "abc", dirty: false, changeCount: 0 };
    const upperSha = shipStatusPayload();
    upperSha.primary = { branch: "main", head: "A".repeat(40), dirty: false };

    expect(() => parseGitShipStatus(shortSha)).toThrow(TypeError);
    expect(() => parseGitShipStatus(upperSha)).toThrow(TypeError);
  });

  it("rejects negative and oversize counts", () => {
    const negative = shipStatusPayload();
    negative.relation = { aheadOfPrimary: -1, behindPrimary: 0, fastForwardable: false };
    const oversize = shipStatusPayload();
    oversize.worktree = {
      branch: "agent/x",
      head: WORKTREE_HEAD,
      dirty: false,
      changeCount: MAX_GIT_INTEGRATION_CHANGE_COUNT + 1,
    };

    expect(() => parseGitShipStatus(negative)).toThrow(TypeError);
    expect(() => parseGitShipStatus(oversize)).toThrow(TypeError);
  });

  it("rejects branch names carrying option or revision syntax", () => {
    for (const branch of ["-force", "main@{1}", "main..other", " main"]) {
      const payload = shipStatusPayload();
      payload.primary = { branch, head: PRIMARY_HEAD, dirty: false };
      expect(() => parseGitShipStatus(payload)).toThrow(TypeError);
    }
  });
});

describe("compare URL validation", () => {
  it("accepts only the closed https host table", () => {
    for (const host of ["github.com", "gitlab.com", "bitbucket.org"]) {
      const receipt = parseGitPushReceipt({
        remote: "origin",
        branch: "agent/agt-thread-0001",
        compareUrl: `https://${host}/acme/widgets/compare`,
      });
      expect(receipt.compareUrl).toBe(`https://${host}/acme/widgets/compare`);
    }
  });

  it("rejects other hosts, other schemes, credentials, and explicit ports", () => {
    const rejected = [
      "https://example.com/acme/widgets/compare",
      "https://evil.github.com/acme/widgets/compare",
      "http://github.com/acme/widgets/compare",
      "ssh://github.com/acme/widgets",
      "https://user:secret@github.com/acme/widgets/compare",
      "https://github.com:8443/acme/widgets/compare",
      "/acme/widgets/compare",
    ];

    for (const compareUrl of rejected) {
      expect(() =>
        parseGitPushReceipt({ remote: "origin", branch: "agent/x", compareUrl }),
      ).toThrow(TypeError);
    }
  });

  it("rejects a compare URL beyond the byte bound", () => {
    const compareUrl = `https://github.com/acme/${"a".repeat(MAX_GIT_INTEGRATION_URL_BYTES)}`;

    expect(() => parseGitPushReceipt({ remote: "origin", branch: "agent/x", compareUrl })).toThrow(
      TypeError,
    );
  });
});

describe("parseGitPushReceipt", () => {
  it("parses a receipt without a compare URL", () => {
    const receipt = parseGitPushReceipt({
      remote: "origin",
      branch: "agent/agt-thread-0001",
      compareUrl: null,
    });

    expect(receipt).toEqual({
      remote: "origin",
      branch: "agent/agt-thread-0001",
      compareUrl: null,
    });
  });

  it("rejects unsafe remote names and unknown keys", () => {
    expect(() =>
      parseGitPushReceipt({ remote: "-origin", branch: "agent/x", compareUrl: null }),
    ).toThrow(TypeError);
    expect(() =>
      parseGitPushReceipt({ remote: "ori gin", branch: "agent/x", compareUrl: null }),
    ).toThrow(TypeError);
    expect(() =>
      parseGitPushReceipt({ remote: "origin", branch: "agent/x", compareUrl: null, extra: 1 }),
    ).toThrow(TypeError);
  });
});

describe("parseGitIntegrationOutcome", () => {
  it("parses every supported outcome", () => {
    expect(
      parseGitIntegrationOutcome({ kind: "integrated", mergeSha: MERGE_SHA, intoBranch: "main" }),
    ).toEqual({ kind: "integrated", mergeSha: MERGE_SHA, intoBranch: "main" });
    expect(
      parseGitIntegrationOutcome({ kind: "conflicted", files: ["src/a.ts"], truncated: false }),
    ).toEqual({ kind: "conflicted", files: ["src/a.ts"], truncated: false });
    expect(parseGitIntegrationOutcome({ kind: "primaryDirty" })).toEqual({ kind: "primaryDirty" });
    expect(parseGitIntegrationOutcome({ kind: "primaryDetached" })).toEqual({
      kind: "primaryDetached",
    });
    expect(parseGitIntegrationOutcome({ kind: "staleExpectation" })).toEqual({
      kind: "staleExpectation",
    });
    expect(parseGitIntegrationOutcome({ kind: "notFastForward" })).toEqual({
      kind: "notFastForward",
    });
    expect(
      parseGitIntegrationOutcome({ kind: "abortFailed", message: "merge --abort failed" }),
    ).toEqual({ kind: "abortFailed", message: "merge --abort failed" });
  });

  it("keeps a multi-line abort message but refuses other control characters", () => {
    expect(
      parseGitIntegrationOutcome({ kind: "abortFailed", message: "line one\nline two" }).kind,
    ).toBe("abortFailed");
    expect(() =>
      parseGitIntegrationOutcome({ kind: "abortFailed", message: "line\u0007one" }),
    ).toThrow(TypeError);
  });

  it("rejects unknown kinds, extra fields, and an oversize conflict list", () => {
    const files = Array.from(
      { length: MAX_GIT_INTEGRATION_CONFLICT_FILES + 1 },
      (_unused, index) => `src/file-${index}.ts`,
    );

    expect(() => parseGitIntegrationOutcome({ kind: "exploded" })).toThrow(TypeError);
    expect(() => parseGitIntegrationOutcome({ kind: "primaryDirty", extra: 1 })).toThrow(TypeError);
    expect(() =>
      parseGitIntegrationOutcome({ kind: "conflicted", files, truncated: true }),
    ).toThrow(TypeError);
  });
});

describe("request validators", () => {
  it("accepts bounded values and refuses unsafe ones", () => {
    expect(validateGitIntegrationRepositoryRoot("/repo")).toBe("/repo");
    expect(validateOptionalGitIntegrationWorktreePath(null)).toBeNull();
    expect(validateOptionalGitIntegrationWorktreePath("/repo/.worktrees/a")).toBe(
      "/repo/.worktrees/a",
    );
    expect(validateGitIntegrationMode("fastForward")).toBe("fastForward");
    expect(validateGitIntegrationMode("merge")).toBe("merge");
    expect(validateGitIntegrationSha(MERGE_SHA)).toBe(MERGE_SHA);
    expect(validateGitMergeMessage("Merge agent/agt-thread-0001 (title)")).toBe(
      "Merge agent/agt-thread-0001 (title)",
    );

    expect(() => validateGitIntegrationRepositoryRoot("   ")).toThrow(TypeError);
    expect(() => validateGitIntegrationMode("rebase")).toThrow(TypeError);
    expect(() => validateGitIntegrationSha("nope")).toThrow(TypeError);
    expect(() => validateGitMergeMessage("   ")).toThrow(TypeError);
    expect(() => validateGitMergeMessage("x".repeat(1_025))).toThrow(TypeError);
  });
});

describe("ship status boundary conditions", () => {
  it("refuses payloads that are not plain objects and payloads missing a field", () => {
    const missingField = shipStatusPayload();
    missingField.primary = { branch: "main", head: PRIMARY_HEAD };

    expect(() => parseGitShipStatus(null)).toThrow(TypeError);
    expect(() => parseGitShipStatus([shipStatusPayload()])).toThrow(TypeError);
    expect(() => parseGitShipStatus("status")).toThrow(TypeError);
    expect(() => parseGitShipStatus(missingField)).toThrow(TypeError);
  });

  it("refuses non-boolean flags", () => {
    const payload = shipStatusPayload();
    payload.worktree = { branch: "agent/x", head: WORKTREE_HEAD, dirty: "yes", changeCount: 0 };

    expect(() => parseGitShipStatus(payload)).toThrow(TypeError);
  });

  it("accepts counts at the cap and refuses fractional counts", () => {
    const atCap = shipStatusPayload();
    atCap.relation = {
      aheadOfPrimary: MAX_GIT_INTEGRATION_COUNT,
      behindPrimary: 0,
      fastForwardable: false,
    };
    const fractional = shipStatusPayload();
    fractional.relation = { aheadOfPrimary: 1.5, behindPrimary: 0, fastForwardable: false };

    expect(parseGitShipStatus(atCap).relation.aheadOfPrimary).toBe(MAX_GIT_INTEGRATION_COUNT);
    expect(() => parseGitShipStatus(fractional)).toThrow(TypeError);
  });

  it("refuses branch names carrying control characters or exceeding the byte bound", () => {
    const control = shipStatusPayload();
    control.primary = { branch: "ma\u0007in", head: PRIMARY_HEAD, dirty: false };
    const oversize = shipStatusPayload();
    oversize.primary = {
      branch: "m".repeat(MAX_GIT_INTEGRATION_BRANCH_BYTES + 1),
      head: PRIMARY_HEAD,
      dirty: false,
    };

    expect(() => parseGitShipStatus(control)).toThrow(TypeError);
    expect(() => parseGitShipStatus(oversize)).toThrow(TypeError);
  });

  it("refuses an unsafe remote name length and accepts the longest allowed one", () => {
    const longest = `o${"a".repeat(MAX_GIT_INTEGRATION_REMOTE_BYTES - 1)}`;
    const tooLong = `o${"a".repeat(MAX_GIT_INTEGRATION_REMOTE_BYTES)}`;

    expect(
      parseGitPushReceipt({ remote: longest, branch: "agent/x", compareUrl: null }).remote,
    ).toBe(longest);
    expect(() =>
      parseGitPushReceipt({ remote: tooLong, branch: "agent/x", compareUrl: null }),
    ).toThrow(TypeError);
  });
});

describe("conflict list bounds", () => {
  it("accepts a list at the cap and refuses non-string or blank entries", () => {
    const files = Array.from(
      { length: MAX_GIT_INTEGRATION_CONFLICT_FILES },
      (_unused, index) => `src/file-${index}.ts`,
    );

    expect(parseGitIntegrationOutcome({ kind: "conflicted", files, truncated: true })).toEqual({
      kind: "conflicted",
      files,
      truncated: true,
    });
    expect(() =>
      parseGitIntegrationOutcome({ kind: "conflicted", files: [1], truncated: false }),
    ).toThrow(TypeError);
    expect(() =>
      parseGitIntegrationOutcome({ kind: "conflicted", files: ["   "], truncated: false }),
    ).toThrow(TypeError);
    expect(() =>
      parseGitIntegrationOutcome({ kind: "conflicted", files: "src/a.ts", truncated: false }),
    ).toThrow(TypeError);
  });
});

describe("branch, path, and message validators", () => {
  it("accepts safe values and refuses option or revision syntax", () => {
    expect(validateGitIntegrationBranch("agent/agt-thread-0001")).toBe("agent/agt-thread-0001");
    expect(validateGitIntegrationWorktreePath("/repo/.worktrees/agt-0001")).toBe(
      "/repo/.worktrees/agt-0001",
    );

    for (const branch of ["--force", "main@{upstream}", "a..b", "", " main "]) {
      expect(() => validateGitIntegrationBranch(branch)).toThrow(TypeError);
    }
    expect(() =>
      validateGitIntegrationWorktreePath("x".repeat(MAX_GIT_INTEGRATION_PATH_BYTES + 1)),
    ).toThrow(TypeError);
    expect(() => validateGitIntegrationWorktreePath(null)).toThrow(TypeError);
  });

  it("keeps a multi-line merge message and refuses other control characters", () => {
    expect(validateGitMergeMessage("Merge agent/x\n\nDetails")).toBe("Merge agent/x\n\nDetails");
    expect(() => validateGitMergeMessage("Merge\u0007agent")).toThrow(TypeError);
    expect(() => validateGitMergeMessage(42)).toThrow(TypeError);
  });
});
